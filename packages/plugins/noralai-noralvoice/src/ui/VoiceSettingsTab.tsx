/**
 * VoiceSettingsTab — per-agent voice configuration surface mounted on
 * the Agent detail page as a plugin-provided tab.
 *
 * Two states:
 *
 *   A. Agent has no `voice_agent_uuid` → CTA "Provision Voice Agent".
 *      Calls `POST /api/plugins/noralai.noralvoice/api/agents/:agentId/provision-voice`
 *      which wraps the `provision_voice_agent` tool. On 200 → refresh.
 *
 *   B. Agent has a uuid → fetches `GET /agents/:agentId/voice-config`
 *      to load the current provider+voice, then renders:
 *        - Provider dropdown (six values from NoralVoice's TTS catalog)
 *        - Voice dropdown (populated by `list_voices` filtered by provider)
 *        - Save button → POSTs the same path with body { provider, voiceId }
 *      The preview button only shows when a voice carries a `previewUrl`
 *      from NoralVoice's catalog response.
 *
 * Mirrors the styling and shadcn primitives used by the NoralVoicePage
 * (Phase 1B) so the tab looks at home next to other agent-detail tabs.
 */

import { useEffect, useMemo, useState } from "react";
import type { PluginPageProps } from "@noralos/plugin-sdk/ui";

import { PLUGIN_ID } from "../constants.js";

const PROVIDERS = [
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "deepgram", label: "Deepgram" },
  { value: "sarvam", label: "Sarvam" },
  { value: "cartesia", label: "Cartesia" },
  { value: "dograh", label: "NoralVoice (managed)" },
  { value: "rime", label: "Rime" },
] as const;
type ProviderId = (typeof PROVIDERS)[number]["value"];

interface VoiceConfigResponse {
  voice_agent_uuid: string | null;
  workflow_name?: string;
  provider?: ProviderId | null;
  voice_id?: string | null;
  provider_options?: Record<string, unknown> | null;
  error?: string;
}

interface VoiceCatalogEntry {
  provider: ProviderId;
  voiceId: string;
  name: string;
  language?: string;
  gender?: string;
  previewUrl?: string;
}

interface ListVoicesResponse {
  voices?: VoiceCatalogEntry[];
  error?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "no-uuid" }
  | { kind: "ready"; voice_agent_uuid: string; workflow_name?: string }
  | { kind: "error"; message: string };

const cardClass = "rounded-lg border border-border/60 bg-card p-4 shadow-sm";
const subduedClass = "text-sm text-muted-foreground";

// `PluginPageProps` is the closest typed shape the SDK exposes today; an
// agent-detail-tab slot receives the same `context` shape plus an agent
// id. We narrow inline rather than depending on an SDK type that may
// move in a follow-up.
interface AgentDetailTabContext {
  companyId: string;
  companyPrefix?: string;
  agentId: string;
}

export function VoiceSettingsTab({ context }: PluginPageProps) {
  // The host populates `context.agentId` for tabs mounted on the agent
  // detail page. If the host hasn't surfaced that yet (older SDK), bail
  // with a soft message rather than throwing.
  const tabContext = context as unknown as AgentDetailTabContext;
  const { companyId, agentId } = tabContext;

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [provider, setProvider] = useState<ProviderId | "">("");
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<VoiceCatalogEntry[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  // Convenience URL builders — all plugin routes carry the companyId
  // query param since they're board-scoped.
  const pluginBase = `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api`;
  const voiceConfigUrl = `${pluginBase}/agents/${encodeURIComponent(agentId ?? "")}/voice-config?companyId=${encodeURIComponent(companyId)}`;
  const provisionUrl = `${pluginBase}/agents/${encodeURIComponent(agentId ?? "")}/provision-voice?companyId=${encodeURIComponent(companyId)}`;
  const listVoicesUrl = (p: ProviderId) =>
    `${pluginBase}/voices?companyId=${encodeURIComponent(companyId)}&provider=${encodeURIComponent(p)}`;

  // ── Load the current voice config ────────────────────────────────────
  function loadConfig() {
    if (!agentId || !companyId) {
      setState({ kind: "loading" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(voiceConfigUrl, { credentials: "include", headers: { Accept: "application/json" } })
      .then(async (resp) => {
        const body = (await resp.json().catch(() => ({}))) as VoiceConfigResponse;
        if (cancelled) return;
        if (resp.status === 404 && body.voice_agent_uuid) {
          // uuid recorded locally but NV doesn't recognise it.
          setState({
            kind: "error",
            message: "The linked NoralVoice workflow was not found. Re-provision below.",
          });
          return;
        }
        if (!resp.ok) {
          setState({ kind: "error", message: body.error ?? `HTTP ${resp.status}` });
          return;
        }
        if (!body.voice_agent_uuid) {
          setState({ kind: "no-uuid" });
          return;
        }
        setState({
          kind: "ready",
          voice_agent_uuid: body.voice_agent_uuid,
          workflow_name: body.workflow_name,
        });
        if (body.provider) setProvider(body.provider);
        if (body.voice_id) setVoiceId(body.voice_id);
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "error", message: "Could not reach the NoralVoice plugin API." });
        }
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    const dispose = loadConfig();
    return () => {
      if (typeof dispose === "function") dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, companyId]);

  // ── Load voices when the operator picks a provider ───────────────────
  useEffect(() => {
    if (state.kind !== "ready" || !provider) {
      setVoices([]);
      return;
    }
    let cancelled = false;
    setVoicesLoading(true);
    fetch(listVoicesUrl(provider), { credentials: "include", headers: { Accept: "application/json" } })
      .then(async (resp) => {
        const body = (await resp.json().catch(() => ({}))) as ListVoicesResponse;
        if (cancelled) return;
        if (!resp.ok) {
          setVoices([]);
          return;
        }
        setVoices(body.voices ?? []);
        // If the currently-selected voiceId doesn't match a voice in the
        // new provider's catalog, drop it so the operator has to choose.
        if (
          voiceId &&
          (body.voices ?? []).every((v) => v.voiceId !== voiceId)
        ) {
          setVoiceId("");
        }
      })
      .catch(() => {
        if (!cancelled) setVoices([]);
      })
      .finally(() => {
        if (!cancelled) setVoicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, state.kind]);

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voiceId === voiceId),
    [voices, voiceId],
  );

  async function handleProvision() {
    if (!agentId) return;
    setProvisioning(true);
    setSaveError(null);
    setSaveOk(null);
    try {
      const resp = await fetch(provisionUrl, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setSaveError(body.error ?? `HTTP ${resp.status}`);
        return;
      }
      // Refresh.
      loadConfig();
    } catch {
      setSaveError("Could not provision the NoralVoice workflow.");
    } finally {
      setProvisioning(false);
    }
  }

  async function handleSave() {
    if (!agentId || !provider || !voiceId) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(null);
    try {
      const resp = await fetch(voiceConfigUrl, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ provider, voiceId }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setSaveError(body.error ?? `HTTP ${resp.status}`);
        return;
      }
      setSaveOk("Saved — NoralVoice updated.");
    } catch {
      setSaveError("Could not save voice settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">Voice settings</h2>
        <p className={subduedClass}>
          Manage this agent's NoralVoice workflow — pick a TTS provider and voice. NoralVoice is the
          source of truth; the legacy voice-config plugin mirrors a copy for backward compatibility.
        </p>
      </header>

      <section className={cardClass} aria-busy={state.kind === "loading" || provisioning}>
        {state.kind === "loading" ? (
          <p className={subduedClass}>Loading voice settings…</p>
        ) : state.kind === "no-uuid" ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-medium">No voice agent linked yet</h3>
            <p className={subduedClass}>
              This agent has no linked NoralVoice workflow. Click below to provision a minimal one;
              you'll be able to extend it from the NoralVoice editor.
            </p>
            <button
              type="button"
              onClick={handleProvision}
              disabled={provisioning}
              className="self-start inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {provisioning ? "Provisioning…" : "Provision Voice Agent"}
            </button>
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
          </div>
        ) : state.kind === "ready" ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-medium">
                Linked to NoralVoice workflow{" "}
                <code className="font-mono text-xs text-muted-foreground">
                  {state.voice_agent_uuid}
                </code>
              </h3>
              {state.workflow_name ? (
                <p className={subduedClass}>"{state.workflow_name}"</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="provider">
                Provider
              </label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderId)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              >
                <option value="">Select a provider…</option>
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="voice">
                Voice
              </label>
              <select
                id="voice"
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                disabled={!provider || voicesLoading}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
              >
                <option value="">
                  {!provider
                    ? "Pick a provider first…"
                    : voicesLoading
                      ? "Loading voices…"
                      : voices.length === 0
                        ? "No voices returned"
                        : "Select a voice…"}
                </option>
                {voices.map((v) => (
                  <option key={v.voiceId} value={v.voiceId}>
                    {v.name}
                    {v.gender ? ` (${v.gender})` : ""}
                    {v.language ? ` · ${v.language}` : ""}
                  </option>
                ))}
              </select>
              {selectedVoice?.previewUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedVoice.previewUrl) {
                      const audio = new Audio(selectedVoice.previewUrl);
                      audio.play().catch(() => {
                        // Browser autoplay restrictions; ignore.
                      });
                    }
                  }}
                  className="self-start inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent"
                >
                  ▶ Preview
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={!provider || !voiceId || saving}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save voice"}
              </button>
              {saveOk ? <p className={`${subduedClass} text-emerald-700`}>{saveOk}</p> : null}
              {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-destructive">{state.message}</p>
        )}
      </section>
    </div>
  );
}
