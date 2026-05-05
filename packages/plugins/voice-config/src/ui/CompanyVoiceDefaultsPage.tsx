import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  useHostContext,
  usePluginData,
  type PluginSettingsPageProps,
} from "@noralos/plugin-sdk/ui";
import { DATA_KEYS, PLUGIN_API_PREFIX } from "../constants.js";
import type { CompanyVoiceDefaults } from "../types.js";

type FormState = {
  defaultProvider: "elevenlabs" | "google_tts";
  defaultDashboardVoiceEnabled: boolean;
  defaultConferenceRoomEnabled: boolean;
  defaultSlackVoiceEnabled: boolean;
  defaultPhoneVoiceEnabled: boolean;
  defaultTtsRepliesEnabled: boolean;
};

const FALLBACK: FormState = {
  defaultProvider: "elevenlabs",
  defaultDashboardVoiceEnabled: true,
  defaultConferenceRoomEnabled: true,
  defaultSlackVoiceEnabled: false,
  defaultPhoneVoiceEnabled: false,
  defaultTtsRepliesEnabled: true,
};

function fromDefaults(d: CompanyVoiceDefaults | null): FormState {
  if (!d) return FALLBACK;
  return {
    defaultProvider: d.defaultProvider,
    defaultDashboardVoiceEnabled: d.defaultDashboardVoiceEnabled,
    defaultConferenceRoomEnabled: d.defaultConferenceRoomEnabled,
    defaultSlackVoiceEnabled: d.defaultSlackVoiceEnabled,
    defaultPhoneVoiceEnabled: d.defaultPhoneVoiceEnabled,
    defaultTtsRepliesEnabled: d.defaultTtsRepliesEnabled,
  };
}

async function callPluginApi(path: string, init: RequestInit): Promise<unknown> {
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

export function CompanyVoiceDefaultsPage(_props: PluginSettingsPageProps) {
  const { companyId } = useHostContext();
  if (!companyId) return <div>Select a company first.</div>;

  const dataReq = useMemo(() => ({ companyId }), [companyId]);
  const { data, error, refresh } = usePluginData<CompanyVoiceDefaults | null>(
    DATA_KEYS.companyDefaults,
    dataReq,
  );

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setForm(fromDefaults(data ?? null));
  }, [data]);

  if (error) return <div>Failed to load defaults: {error.message}</div>;
  if (!form) return <div>Loading…</div>;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const path = `${PLUGIN_API_PREFIX}/companies/${encodeURIComponent(companyId)}/defaults?companyId=${encodeURIComponent(companyId)}`;
      await callPluginApi(path, {
        method: "POST",
        body: JSON.stringify(form),
      });
      await refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      <h2>Voice Defaults</h2>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Defaults are applied to agents whose voice settings have not been customized,
        and to per-agent rows whose provider is set to "Default".
      </p>

      <label>
        Default Provider
        <select
          value={form.defaultProvider}
          onChange={(e) => setField("defaultProvider", e.target.value as FormState["defaultProvider"])}
        >
          <option value="elevenlabs">ElevenLabs</option>
          <option value="google_tts">Google Cloud TTS</option>
        </select>
      </label>

      <label>
        <input
          type="checkbox"
          checked={form.defaultDashboardVoiceEnabled}
          onChange={(e) => setField("defaultDashboardVoiceEnabled", e.target.checked)}
        />{" "}
        Dashboard Voice Enabled by default
      </label>

      <label>
        <input
          type="checkbox"
          checked={form.defaultConferenceRoomEnabled}
          onChange={(e) => setField("defaultConferenceRoomEnabled", e.target.checked)}
        />{" "}
        Conference Room Enabled by default
      </label>

      <label>
        <input
          type="checkbox"
          checked={form.defaultSlackVoiceEnabled}
          onChange={(e) => setField("defaultSlackVoiceEnabled", e.target.checked)}
        />{" "}
        Slack Voice Enabled by default
      </label>

      <label>
        <input
          type="checkbox"
          checked={form.defaultPhoneVoiceEnabled}
          onChange={(e) => setField("defaultPhoneVoiceEnabled", e.target.checked)}
        />{" "}
        Phone Voice Enabled by default
        <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>
          (vendor-neutral; off unless an admin opts in)
        </span>
      </label>

      <label>
        <input
          type="checkbox"
          checked={form.defaultTtsRepliesEnabled}
          onChange={(e) => setField("defaultTtsRepliesEnabled", e.target.checked)}
        />{" "}
        TTS Replies Enabled by default
      </label>

      {saveError && <div style={{ color: "red" }}>Save failed: {saveError}</div>}

      <div>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export default CompanyVoiceDefaultsPage;
