/**
 * VoiceSettingsTab — per-agent voice configuration surface mounted on
 * the Agent detail page as a plugin-provided tab.
 *
 * Two layers:
 *
 *   A. NoralVoice picker (provider + voice). Requires the agent to have a
 *      `voice_agent_uuid` (provisioned via the CTA below). PUT lands on
 *      NoralVoice; this plugin is the only writer.
 *
 *   B. Per-agent surface flags + tier/visibility overrides + tts_replies.
 *      Stored on `public.agents` (PR-4a added the columns). Available
 *      whether or not a voice agent is provisioned.
 *
 * Phase 6 PR-4b removed the legacy voice-config plugin; this tab is the
 * only operator-facing surface for these settings.
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

interface SurfaceFlags {
  dashboard: boolean;
  slack: boolean;
  phone: boolean;
}

type TierOverride = "exec" | "manager" | "worker" | null;
type VisibilityOverride = "shown" | "hidden" | null;

interface VoiceConfigResponse {
  voice_agent_uuid: string | null;
  workflow_name?: string;
  provider?: ProviderId | null;
  voice_id?: string | null;
  provider_options?: Record<string, unknown> | null;
  surface_flags?: SurfaceFlags;
  tier_override?: TierOverride;
  visibility_override?: VisibilityOverride;
  tts_replies_enabled?: boolean;
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

interface AgentDetailTabContext {
  companyId: string;
  companyPrefix?: string;
  agentId: string;
}

const DEFAULT_SURFACE_FLAGS: SurfaceFlags = {
  dashboard: true,
  slack: false,
  phone: false,
};

export function VoiceSettingsTab({ context }: PluginPageProps) {
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

  // Phase 6 PR-4b — per-agent surface state from public.agents columns.
  const [surfaceFlags, setSurfaceFlags] = useState<SurfaceFlags>(DEFAULT_SURFACE_FLAGS);
  const [tierOverride, setTierOverride] = useState<TierOverride>(null);
  const [visibilityOverride, setVisibilityOverride] = useState<VisibilityOverride>(null);
  const [ttsRepliesEnabled, setTtsRepliesEnabled] = useState(true);
  const [savingSurface, setSavingSurface] = useState(false);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [surfaceOk, setSurfaceOk] = useState<string | null>(null);

  const pluginBase = `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api`;
  const voiceConfigUrl = `${pluginBase}/agents/${encodeURIComponent(agentId ?? "")}/voice-config?companyId=${encodeURIComponent(companyId)}`;
  const provisionUrl = `${pluginBase}/agents/${encodeURIComponent(agentId ?? "")}/provision-voice?companyId=${encodeURIComponent(companyId)}`;
  const listVoicesUrl = (p: ProviderId) =>
    `${pluginBase}/voices?companyId=${encodeURIComponent(companyId)}&provider=${encodeURIComponent(p)}`;

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
          setState({
            kind: "error",
            message: "The linked NoralVoice workflow was not found. Re-provision below.",
          });
          // Still load surface fields if present in the 404 body.
        } else if (!resp.ok) {
          setState({ kind: "error", message: body.error ?? `HTTP ${resp.status}` });
          return;
        } else if (!body.voice_agent_uuid) {
          setState({ kind: "no-uuid" });
        } else {
          setState({
            kind: "ready",
            voice_agent_uuid: body.voice_agent_uuid,
            workflow_name: body.workflow_name,
          });
          if (body.provider) setProvider(body.provider);
          if (body.voice_id) setVoiceId(body.voice_id);
        }
        // Surface fields are always populated (always come from agents columns).
        if (body.surface_flags) setSurfaceFlags({ ...DEFAULT_SURFACE_FLAGS, ...body.surface_flags });
        if (body.tier_override !== undefined) setTierOverride(body.tier_override);
        if (body.visibility_override !== undefined) setVisibilityOverride(body.visibility_override);
        if (typeof body.tts_replies_enabled === "boolean") setTtsRepliesEnabled(body.tts_replies_enabled);
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
        if (voiceId && (body.voices ?? []).every((v) => v.voiceId !== voiceId)) {
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
      loadConfig();
    } catch {
      setSaveError("Could not provision the NoralVoice workflow.");
    } finally {
      setProvisioning(false);
    }
  }

  async function handleSavePicker() {
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

  async function handleSaveSurface() {
    if (!agentId) return;
    setSavingSurface(true);
    setSurfaceError(null);
    setSurfaceOk(null);
    try {
      const resp = await fetch(voiceConfigUrl, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          surfaceFlags,
          tierOverride,
          visibilityOverride,
          ttsRepliesEnabled,
        }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setSurfaceError(body.error ?? `HTTP ${resp.status}`);
        return;
      }
      setSurfaceOk("Saved.");
    } catch {
      setSurfaceError("Could not save surface settings.");
    } finally {
      setSavingSurface(false);
    }
  }

  function renderSurfaceCard() {
    return (
      <section className={cardClass}>
        <h3 className="text-base font-medium">Surfaces &amp; overrides</h3>
        <p className={subduedClass}>
          Where this agent's voice plays and how the platform treats it. Stored on the agent record;
          editable whether or not a voice workflow is provisioned.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Surface flags</span>
            <div className="flex flex-wrap gap-4">
              {(["dashboard", "slack", "phone"] as const).map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={surfaceFlags[s]}
                    onChange={(e) =>
                      setSurfaceFlags((prev) => ({ ...prev, [s]: e.target.checked }))
                    }
                  />
                  <span className="capitalize">{s}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="tier-override">
                Tier override
              </label>
              <select
                id="tier-override"
                value={tierOverride ?? ""}
                onChange={(e) => setTierOverride((e.target.value || null) as TierOverride)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              >
                <option value="">— default —</option>
                <option value="exec">exec</option>
                <option value="manager">manager</option>
                <option value="worker">worker</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="visibility-override">
                Visibility override
              </label>
              <select
                id="visibility-override"
                value={visibilityOverride ?? ""}
                onChange={(e) =>
                  setVisibilityOverride((e.target.value || null) as VisibilityOverride)
                }
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              >
                <option value="">— default —</option>
                <option value="shown">shown</option>
                <option value="hidden">hidden</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ttsRepliesEnabled}
              onChange={(e) => setTtsRepliesEnabled(e.target.checked)}
            />
            <span>TTS on agent replies</span>
          </label>

          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveSurface}
              disabled={savingSurface}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {savingSurface ? "Saving…" : "Save surfaces"}
            </button>
            {surfaceOk ? <p className={`${subduedClass} text-emerald-700`}>{surfaceOk}</p> : null}
            {surfaceError ? <p className="text-sm text-destructive">{surfaceError}</p> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">Voice settings</h2>
        <p className={subduedClass}>
          Manage this agent's NoralVoice workflow (provider + voice) and the surfaces where its voice
          plays. NoralVoice is the source of truth for voice selection; agents.surface_flags is the
          source of truth for surface visibility.
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
                onClick={handleSavePicker}
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

      {renderSurfaceCard()}
    </div>
  );
}
