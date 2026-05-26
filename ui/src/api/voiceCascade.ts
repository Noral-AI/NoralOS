// Tiny browser-side helper for the voice-cascade plugin's read-only routes.
//
// Today this only exposes the /health probe so the Integrations page can show
// the actual `ttsMode` from the running plugin instead of a hard-coded label.
// Keeping it scoped here (instead of importing from the plugin package)
// avoids cross-coupling the host UI to plugin source.
//
// @deprecated Phase 6 PR-2 — `voiceCascadeApi.synthesize` is being replaced
// by `noralVoiceTtsApi.synthesize` (in `./noralVoiceTts`). The flag
// `NEXT_PUBLIC_ENABLE_NV_TTS_AUTOPLAY=true` flips `useChatVoiceAutoplay`
// to the NoralVoice TTS path. `voiceCascadeApi.health` stays useful until
// PR-3 retires the voice-cascade plugin entirely.

const VOICE_CASCADE_API = "/api/plugins/noralos.voice-cascade/api";

export type VoiceCascadeTtsMode = "live" | "dry_run";

export interface VoiceCascadeHealthResponse {
  status: "ok" | "degraded" | "unavailable";
  providers: { elevenlabs: string; google_tts: string };
  ttsMode: VoiceCascadeTtsMode;
}

export type VoiceCascadeSurface = "dashboard" | "conference_room" | "slack" | "phone";

/**
 * Successful synthesis response — the route always returns HTTP 200, so callers
 * MUST inspect `ok` to discriminate. Failure modes carry `reason` (e.g.
 * `voice-config-disabled`, `surface-disabled`, `exfiltration-blocked`,
 * `provider-failed`) so the UI can surface a useful message without leaking
 * provider internals.
 */
export interface VoiceCascadeSynthesisOk {
  ok: true;
  agentId: string;
  surface: VoiceCascadeSurface;
  providerUsed: "elevenlabs" | "google_tts";
  voiceId: string;
  mimeType: string;
  audioBase64: string;
  ttsMode: VoiceCascadeTtsMode;
}

export interface VoiceCascadeSynthesisFail {
  ok: false;
  agentId: string;
  surface: VoiceCascadeSurface;
  reason: string;
  message: string;
  ttsMode?: VoiceCascadeTtsMode;
}

export type VoiceCascadeSynthesisResult =
  | VoiceCascadeSynthesisOk
  | VoiceCascadeSynthesisFail;

export const voiceCascadeApi = {
  /**
   * Fetch the current voice-cascade health snapshot, including `ttsMode`.
   *
   * The route requires only a board user session (auth: "board-or-agent")
   * so this is safe to call from any admin UI. Provider keys never reach
   * the browser; the response only carries provider liveness flags.
   */
  health: async (companyId: string): Promise<VoiceCascadeHealthResponse> => {
    const params = new URLSearchParams({ companyId });
    const res = await fetch(`${VOICE_CASCADE_API}/health?${params.toString()}`, {
      method: "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`voice-cascade /health failed: HTTP ${res.status}`);
    }
    return (await res.json()) as VoiceCascadeHealthResponse;
  },

  /**
   * Synthesize a clip of audio for an agent on a given surface.
   *
   * The server applies every gate: voice-config enablement, per-surface
   * flag (e.g. `dashboardVoiceEnabled`), `ttsMode` dry_run/live, the
   * pre-TTS exfiltration scan, and provider-key resolution. The browser
   * only sees the resulting audio bytes (base64) or a `reason` string —
   * provider keys never reach this client.
   *
   * Callers MUST check `ok` on the result. Non-ok responses are normal
   * (e.g. dry_run, surface disabled, agent not voice-enabled) and should
   * NOT be treated as bugs — they're how the gate signals "no audio
   * intended."
   */
  synthesize: async (input: {
    companyId: string;
    agentId: string;
    surface: VoiceCascadeSurface;
    text: string;
  }): Promise<VoiceCascadeSynthesisResult> => {
    const params = new URLSearchParams({ companyId: input.companyId });
    const res = await fetch(`${VOICE_CASCADE_API}/synthesize?${params.toString()}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: input.agentId,
        surface: input.surface,
        text: input.text,
      }),
    });
    if (!res.ok) {
      // Hard transport errors (auth, 5xx) — surface as a synthetic fail
      // result so callers don't need a separate try/catch path.
      return {
        ok: false,
        agentId: input.agentId,
        surface: input.surface,
        reason: "transport-error",
        message: `voice-cascade /synthesize failed: HTTP ${res.status}`,
      };
    }
    return (await res.json()) as VoiceCascadeSynthesisResult;
  },
};
