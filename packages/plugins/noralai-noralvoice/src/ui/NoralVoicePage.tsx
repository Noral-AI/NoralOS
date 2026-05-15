/**
 * NoralVoice plugin page.
 *
 * Three states:
 *   A. No API key configured       → "Connect NoralVoice." CTA to Integrations.
 *   B. API key set, no Voice Director yet → "Create your first Voice Director."
 *   C. Voice Director(s) exist     → List them with last activity, link to detail.
 *
 * Phase 4 builds out the deep dashboards (runs, recordings, KB, campaigns,
 * telephony, settings) — this is the Phase 1B surface only.
 */

import { useEffect, useState } from "react";
import type { PluginPageProps } from "@noralos/plugin-sdk/ui";

import { PLUGIN_ID } from "../constants.js";

interface VoiceDirector {
  id: string;
  name: string;
  status?: string;
  lastActivityAt?: string | null;
}

interface ListResponse {
  workflows?: unknown[];
  voiceDirectors?: VoiceDirector[];
  error?: string;
  notConfigured?: boolean;
}

type Status =
  | { kind: "loading" }
  | { kind: "not-configured" }
  | { kind: "no-director"; canCreate: boolean }
  | { kind: "ready"; directors: VoiceDirector[] }
  | { kind: "error"; message: string };

const cardClass = "rounded-lg border border-border/60 bg-card p-4 shadow-sm";
const headingClass = "text-2xl font-semibold tracking-tight";
const subduedClass = "text-sm text-muted-foreground";

export function NoralVoicePage({ context }: PluginPageProps) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const companyId = context.companyId;

  useEffect(() => {
    if (!companyId) {
      setStatus({ kind: "loading" });
      return;
    }
    let cancelled = false;
    // Phase 1B: probe /workflows to determine configure-me vs not. The
    // Voice-Director listing comes from a host endpoint that exposes
    // agents created from the voice-director template; the plugin
    // doesn't own that data, so we hit the host's agents API for the
    // company filtered by `templateId=voice-director`.
    const workflowsUrl =
      `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api/workflows` +
      `?companyId=${encodeURIComponent(companyId)}`;
    fetch(workflowsUrl, { credentials: "include", headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ListResponse;
        if (cancelled) return;
        if (response.status === 400 || body.notConfigured) {
          setStatus({ kind: "not-configured" });
          return;
        }
        if (!response.ok) {
          setStatus({ kind: "error", message: body.error ?? `HTTP ${response.status}` });
          return;
        }
        // Optimistic: with workflows reachable, defer to the host
        // agents-listing in a sibling call.
        const agentsUrl = `/api/companies/${encodeURIComponent(companyId)}/agents?templateId=voice-director`;
        fetch(agentsUrl, { credentials: "include", headers: { Accept: "application/json" } })
          .then(async (resp2) => {
            if (cancelled) return;
            if (!resp2.ok) {
              setStatus({ kind: "no-director", canCreate: true });
              return;
            }
            const body2 = (await resp2.json().catch(() => ({}))) as { agents?: VoiceDirector[] };
            const directors = body2.agents ?? [];
            if (directors.length === 0) setStatus({ kind: "no-director", canCreate: true });
            else setStatus({ kind: "ready", directors });
          })
          .catch(() => setStatus({ kind: "no-director", canCreate: true }));
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ kind: "error", message: "Could not reach the NoralVoice plugin API." });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function createVoiceDirector() {
    if (!companyId) return;
    setStatus({ kind: "loading" });
    const url =
      `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api/voice-directors` +
      `?companyId=${encodeURIComponent(companyId)}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setStatus({ kind: "error", message: body.error ?? `HTTP ${resp.status}` });
        return;
      }
      // Re-fetch the list.
      const body = (await resp.json().catch(() => ({}))) as { agent?: VoiceDirector };
      const created = body.agent;
      if (created) setStatus({ kind: "ready", directors: [created] });
    } catch (err) {
      setStatus({ kind: "error", message: "Could not create Voice Director." });
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className={headingClass}>NoralVoice</h1>
        <p className={subduedClass}>
          Voice-AI workflow runtime. Voice Directors own voice operations for this company —
          they design voice agents, run outbound calls, and surface outcomes to the CEO.
        </p>
      </header>

      <section className={cardClass} aria-busy={status.kind === "loading"}>
        {status.kind === "loading" ? (
          <p className={subduedClass}>Loading…</p>
        ) : status.kind === "not-configured" ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Connect NoralVoice</h2>
            <p className={subduedClass}>
              Add your NoralVoice API key under Settings → Integrations. Voice Directors will appear here once
              configured.
            </p>
            <a
              href={context.companyPrefix ? `/${context.companyPrefix}/company/settings/integrations` : "/company/settings/integrations"}
              className="self-start inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Open integrations →
            </a>
          </div>
        ) : status.kind === "no-director" ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Create your first Voice Director</h2>
            <p className={subduedClass}>
              The Voice Director is the manager-tier agent that owns voice operations. One click below
              creates the default — reports to CEO, equipped with `noralvoice:*` tools.
            </p>
            <button
              type="button"
              onClick={createVoiceDirector}
              disabled={!status.canCreate}
              className="self-start inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              Create Voice Director
            </button>
          </div>
        ) : status.kind === "ready" ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-medium">Voice Directors</h2>
              <span className={subduedClass}>{status.directors.length} total</span>
            </div>
            <ul className="divide-y divide-border/60">
              {status.directors.map((d: VoiceDirector) => (
                <li key={d.id} className="flex items-center justify-between py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{d.name}</span>
                    <span className={subduedClass}>
                      {d.status ?? "active"}
                      {d.lastActivityAt ? ` · last activity ${new Date(d.lastActivityAt).toLocaleDateString()}` : ""}
                    </span>
                  </div>
                  <a
                    href={context.companyPrefix ? `/${context.companyPrefix}/agents/${d.id}` : `/agents/${d.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Open →
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-destructive">{status.message}</p>
        )}
      </section>

      <section className={`${cardClass} text-sm`}>
        <h2 className="mb-2 text-base font-medium">Phase 4 preview</h2>
        <p className={subduedClass}>
          Deep dashboards (runs, recordings, knowledge base, campaigns, telephony, embedded workflow builder)
          land in Phase 4. Today, deep editing happens inside NoralVoice at <code>voice.noral.ai</code>; the
          Voice Director surfaces highlights to the CEO via Conference Room or chat.
        </p>
      </section>
    </div>
  );
}
