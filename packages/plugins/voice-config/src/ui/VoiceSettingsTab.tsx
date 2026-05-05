import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  useHostContext,
  usePluginData,
  type PluginDetailTabProps,
} from "@noralos/plugin-sdk/ui";
import {
  DATA_KEYS,
  PLUGIN_API_PREFIX,
  PROVIDERS,
  TIERS,
  VISIBILITIES,
  type Provider,
  type Tier,
  type Visibility,
} from "../constants.js";
import type {
  AgentVoiceConfig,
  CompanyVoiceDefaults,
  EffectiveOrFailClosed,
} from "../types.js";

type VoiceSettingsData = {
  raw: AgentVoiceConfig | null;
  derivedTier: Tier | null;
  effective: EffectiveOrFailClosed;
  companyDefaults: CompanyVoiceDefaults | null;
};

type FormState = {
  voiceEnabled: boolean;
  provider: Provider;
  voiceId: string;
  dashboardVoiceEnabled: boolean;
  conferenceRoomEnabled: boolean;
  slackVoiceEnabled: boolean;
  phoneVoiceEnabled: boolean;
  ttsRepliesEnabled: boolean;
  tierOverride: Tier | "";
  visibilityOverride: Visibility | "";
};

function fromEffective(d: VoiceSettingsData): FormState {
  if (d.raw) {
    return {
      voiceEnabled: d.raw.voiceEnabled,
      provider: d.raw.provider,
      voiceId: d.raw.voiceId,
      dashboardVoiceEnabled: d.raw.dashboardVoiceEnabled,
      conferenceRoomEnabled: d.raw.conferenceRoomEnabled,
      slackVoiceEnabled: d.raw.slackVoiceEnabled,
      phoneVoiceEnabled: d.raw.phoneVoiceEnabled,
      ttsRepliesEnabled: d.raw.ttsRepliesEnabled,
      tierOverride: d.raw.tierOverride ?? "",
      visibilityOverride: d.raw.visibilityOverride ?? "",
    };
  }
  if (d.effective.resolved) {
    return {
      voiceEnabled: d.effective.voiceEnabled,
      provider: "default",
      voiceId: d.effective.voiceId,
      dashboardVoiceEnabled: d.effective.dashboardVoiceEnabled,
      conferenceRoomEnabled: d.effective.conferenceRoomEnabled,
      slackVoiceEnabled: d.effective.slackVoiceEnabled,
      phoneVoiceEnabled: d.effective.phoneVoiceEnabled,
      ttsRepliesEnabled: d.effective.ttsRepliesEnabled,
      tierOverride: "",
      visibilityOverride: "",
    };
  }
  return {
    voiceEnabled: false,
    provider: "default",
    voiceId: "",
    dashboardVoiceEnabled: false,
    conferenceRoomEnabled: false,
    slackVoiceEnabled: false,
    phoneVoiceEnabled: false,
    ttsRepliesEnabled: false,
    tierOverride: "",
    visibilityOverride: "",
  };
}

async function callPluginApi(
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const parsed = text ? safeJsonParse(text) : null;
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function VoiceSettingsTab(_props: PluginDetailTabProps) {
  const { companyId, entityId, entityType } = useHostContext();

  if (entityType !== "agent" || !entityId || !companyId) {
    return <div>Voice settings are only available on agent detail pages.</div>;
  }

  const dataReq = useMemo(() => ({ companyId, agentId: entityId }), [companyId, entityId]);
  const { data, error, refresh } = usePluginData<VoiceSettingsData>(
    DATA_KEYS.voiceSettings,
    dataReq,
  );

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm(fromEffective(data));
  }, [data]);

  if (error) return <div>Failed to load voice settings: {error.message}</div>;
  if (!data || !form) return <div>Loading…</div>;

  const visibility = data.effective.resolved
    ? data.effective.effectiveVisibility
    : "hidden";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const path = `${PLUGIN_API_PREFIX}/agents/${encodeURIComponent(entityId)}/voice-config?companyId=${encodeURIComponent(companyId)}`;
      await callPluginApi(path, {
        method: "POST",
        body: JSON.stringify({
          voiceEnabled: form.voiceEnabled,
          provider: form.provider,
          voiceId: form.voiceId,
          dashboardVoiceEnabled: form.dashboardVoiceEnabled,
          conferenceRoomEnabled: form.conferenceRoomEnabled,
          slackVoiceEnabled: form.slackVoiceEnabled,
          phoneVoiceEnabled: form.phoneVoiceEnabled,
          ttsRepliesEnabled: form.ttsRepliesEnabled,
          tierOverride: form.tierOverride === "" ? null : form.tierOverride,
          visibilityOverride: form.visibilityOverride === "" ? null : form.visibilityOverride,
        }),
      });
      await refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const path = `${PLUGIN_API_PREFIX}/agents/${encodeURIComponent(entityId)}/voice-config?companyId=${encodeURIComponent(companyId)}`;
      await callPluginApi(path, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      <section>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          Derived tier: <strong>{data.derivedTier ?? "unknown"}</strong>
          {data.raw?.tierOverride ? ` · admin override → ${data.raw.tierOverride}` : ""}
          {" · "}visibility: <strong>{visibility}</strong>
          {!data.effective.resolved ? ` · failed to resolve: ${data.effective.reason}` : ""}
        </div>
      </section>

      <label>
        <input
          type="checkbox"
          checked={form.voiceEnabled}
          onChange={(e) => setField("voiceEnabled", e.target.checked)}
        />{" "}
        Voice Enabled
      </label>

      {form.voiceEnabled && (
        <>
          <label>
            Provider
            <select
              value={form.provider}
              onChange={(e) => setField("provider", e.target.value as Provider)}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p === "default"
                    ? "Default (use company default)"
                    : p === "elevenlabs"
                      ? "ElevenLabs"
                      : p === "google_tts"
                        ? "Google Cloud TTS"
                        : p}
                </option>
              ))}
            </select>
          </label>

          {form.provider !== "default" && (
            <label>
              Voice ID
              <input
                type="text"
                value={form.voiceId}
                onChange={(e) => setField("voiceId", e.target.value)}
                placeholder={
                  form.provider === "elevenlabs"
                    ? "ElevenLabs voice ID"
                    : "Google Cloud TTS voice name (e.g. en-US-Neural2-J)"
                }
              />
            </label>
          )}

          <label>
            <input
              type="checkbox"
              checked={form.dashboardVoiceEnabled}
              onChange={(e) => setField("dashboardVoiceEnabled", e.target.checked)}
            />{" "}
            Dashboard Voice Enabled
          </label>

          <label>
            <input
              type="checkbox"
              checked={form.conferenceRoomEnabled}
              onChange={(e) => setField("conferenceRoomEnabled", e.target.checked)}
            />{" "}
            Conference Room Enabled
          </label>

          <label>
            <input
              type="checkbox"
              checked={form.slackVoiceEnabled}
              onChange={(e) => setField("slackVoiceEnabled", e.target.checked)}
            />{" "}
            Slack Voice Enabled
          </label>

          <label>
            <input
              type="checkbox"
              checked={form.phoneVoiceEnabled}
              onChange={(e) => setField("phoneVoiceEnabled", e.target.checked)}
            />{" "}
            Phone Voice Enabled
            <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>
              (vendor-neutral; consumed by Twilio/SIP/etc. channel plugins)
            </span>
          </label>

          <label>
            <input
              type="checkbox"
              checked={form.ttsRepliesEnabled}
              onChange={(e) => setField("ttsRepliesEnabled", e.target.checked)}
            />{" "}
            TTS Replies Enabled
          </label>
        </>
      )}

      <fieldset style={{ border: "1px solid #ccc", padding: 12 }}>
        <legend>Admin overrides</legend>
        <label>
          Tier override
          <select
            value={form.tierOverride}
            onChange={(e) => setField("tierOverride", e.target.value as Tier | "")}
          >
            <option value="">— use derived ({data.derivedTier ?? "?"}) —</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ marginLeft: 12 }}>
          Visibility override
          <select
            value={form.visibilityOverride}
            onChange={(e) =>
              setField("visibilityOverride", e.target.value as Visibility | "")
            }
          >
            <option value="">— use default —</option>
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {saveError && <div style={{ color: "red" }}>Save failed: {saveError}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={handleReset} disabled={saving || !data.raw}>
          Reset to defaults
        </button>
      </div>
    </form>
  );
}

export default VoiceSettingsTab;
