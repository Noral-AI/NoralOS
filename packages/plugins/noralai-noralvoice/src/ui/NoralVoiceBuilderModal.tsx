/**
 * NoralVoiceBuilderModal — full-screen iframed wrapper around NoralVoice's
 * React-Flow workflow editor.
 *
 * Lifecycle:
 *   1. Parent mounts the modal with `workflowUuid`. The modal calls
 *      `POST /api/plugins/noralai.noralvoice/api/workflows/:uuid/embed-token`
 *      to mint a one-shot exchange token via NV's
 *      `POST /api/v1/embed/exchange-token` (Phase 1A).
 *   2. Modal renders the iframe with `src=<embed_url>` returned by NV.
 *      The iframe lands at NV's `/embed-login`, which validates +
 *      consumes the token, sets a session cookie, then 302s to
 *      `/workflow/<uuid>`. The user is now authenticated in the
 *      embedded NV.
 *   3. Child posts `noralvoice:ready`; parent responds with theme
 *      tokens (`noralvoice:theme`).
 *   4. As the operator edits, child posts `noralvoice:unsaved-changes`
 *      whenever its dirty-state flips. Parent caches it for the close
 *      handler.
 *   5. Save inside NV triggers `noralvoice:saved`. Parent fires the
 *      `onSaved` callback so the workflow list refetches.
 *   6. Close attempts (user clicks the X or hits Esc): if hasUnsaved,
 *      show a confirmation; else close immediately. The child can also
 *      request close via `noralvoice:request-close`.
 *
 * postMessage origin gate: every event MUST come from the configured
 * NoralVoice base URL's origin. We resolve that from a `noralvoiceBaseUrl`
 * prop (passed by the parent who knows the plugin config). Defends
 * against a hostile iframe injection that tries to spoof the protocol.
 */

import { useEffect, useRef, useState } from "react";
import type { PluginPageProps } from "@noralos/plugin-sdk/ui";

import { PLUGIN_ID } from "../constants.js";

export interface NoralVoiceBuilderModalProps {
  workflowUuid: string;
  workflowName?: string;
  noralvoiceBaseUrl: string;
  companyId: string;
  themeMode: "dark" | "light";
  /** Tokens forwarded to NV via `noralvoice:theme`. Free-form. */
  themeTokens?: Record<string, string>;
  onClose: () => void;
  onSaved?: (workflowUuid: string) => void;
}

type LoadState =
  | { kind: "minting" }
  | { kind: "ready"; embedUrl: string }
  | { kind: "error"; message: string };

type ChildMessage =
  | { type: "noralvoice:ready" }
  | { type: "noralvoice:unsaved-changes"; hasUnsaved: boolean }
  | { type: "noralvoice:saved"; workflowUuid: string }
  | { type: "noralvoice:request-close" };

function isChildMessage(value: unknown): value is ChildMessage {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  return (
    t === "noralvoice:ready" ||
    t === "noralvoice:unsaved-changes" ||
    t === "noralvoice:saved" ||
    t === "noralvoice:request-close"
  );
}

export function NoralVoiceBuilderModal({
  workflowUuid,
  workflowName,
  noralvoiceBaseUrl,
  companyId,
  themeMode,
  themeTokens,
  onClose,
  onSaved,
}: NoralVoiceBuilderModalProps) {
  const [state, setState] = useState<LoadState>({ kind: "minting" });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hasUnsavedRef = useRef(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  // Compute the iframe origin for the postMessage gate. Trailing slash
  // normalised; URL parse failures fall through to a permissive empty
  // string which we never match against (effectively blocks all
  // messages, surfacing as a stuck modal — safer than overpermissive).
  const expectedOrigin = (() => {
    try {
      return new URL(noralvoiceBaseUrl).origin;
    } catch {
      return "";
    }
  })();

  // 1. Mint the embed token on mount.
  useEffect(() => {
    let cancelled = false;
    const mintUrl =
      `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api/workflows/${encodeURIComponent(workflowUuid)}/embed-token` +
      `?companyId=${encodeURIComponent(companyId)}`;
    fetch(mintUrl, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (resp) => {
        const body = (await resp.json().catch(() => ({}))) as { embedUrl?: string; message?: string; error?: string };
        if (cancelled) return;
        if (!resp.ok) {
          setState({
            kind: "error",
            message: body.message ?? body.error ?? `HTTP ${resp.status}`,
          });
          return;
        }
        if (!body.embedUrl) {
          setState({ kind: "error", message: "NoralVoice returned no embed URL" });
          return;
        }
        setState({ kind: "ready", embedUrl: body.embedUrl });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "error", message: "Could not mint a NoralVoice embed token" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, workflowUuid]);

  function requestClose() {
    if (hasUnsavedRef.current) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }

  // 2. postMessage handler.
  useEffect(() => {
    function handler(event: MessageEvent) {
      if (!expectedOrigin || event.origin !== expectedOrigin) return;
      if (!isChildMessage(event.data)) return;
      const msg = event.data;
      if (msg.type === "noralvoice:ready") {
        const target = iframeRef.current?.contentWindow;
        if (target) {
          target.postMessage(
            { type: "noralvoice:theme", mode: themeMode, tokens: themeTokens ?? {} },
            expectedOrigin,
          );
        }
        return;
      }
      if (msg.type === "noralvoice:unsaved-changes") {
        hasUnsavedRef.current = !!msg.hasUnsaved;
        return;
      }
      if (msg.type === "noralvoice:saved") {
        hasUnsavedRef.current = false;
        onSaved?.(msg.workflowUuid);
        return;
      }
      if (msg.type === "noralvoice:request-close") {
        requestClose();
        return;
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedOrigin, themeMode, themeTokens]);

  // 3. Esc-to-close (with unsaved-changes guard).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit voice workflow${workflowName ? ` — ${workflowName}` : ""}`}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {workflowName ? `Editing: ${workflowName}` : "Workflow editor"}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            voice.noral.ai/workflow/{workflowUuid.slice(0, 8)}…
          </span>
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close workflow editor"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-sm hover:bg-accent"
        >
          ✕
        </button>
      </header>

      <main className="relative flex-1">
        {state.kind === "minting" ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Opening NoralVoice editor…
          </div>
        ) : state.kind === "error" ? (
          <div className="mx-auto mt-12 max-w-md rounded-lg border border-border/60 bg-card p-4 text-sm">
            <p className="font-medium text-destructive">Could not open the workflow editor</p>
            <p className="mt-1 text-muted-foreground">{state.message}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent"
            >
              Close
            </button>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={state.embedUrl}
            title={`NoralVoice workflow ${workflowUuid}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="h-full w-full border-0"
          />
        )}
      </main>

      {confirmingClose ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
        >
          <div className="rounded-lg border border-border/60 bg-card p-4 text-sm shadow-lg">
            <p className="font-medium">Discard unsaved changes?</p>
            <p className="mt-1 text-muted-foreground">
              You have edits the NoralVoice editor hasn't saved yet.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingClose(false);
                  hasUnsavedRef.current = false;
                  onClose();
                }}
                className="inline-flex items-center rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                Discard + close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Feature flag — Phase 4 ships the modal off-by-default in prod.
 * Operators flip `features.embeddedVoiceBuilder` on the plugin instance
 * config to enable. The plugin SDK doesn't surface instanceConfig to UI
 * bundles directly, so for the bundled UI we read a global flag the
 * NoralOS host can set (env-driven) until a proper feature-flag service
 * lands. Recommended prod default: **false** until B5 smoke is live.
 */
export function isEmbeddedVoiceBuilderEnabled(_props: PluginPageProps): boolean {
  if (typeof globalThis !== "undefined") {
    const flag = (globalThis as { ENABLE_NORALVOICE_BUILDER?: unknown }).ENABLE_NORALVOICE_BUILDER;
    if (typeof flag === "boolean") return flag;
  }
  return false;
}
