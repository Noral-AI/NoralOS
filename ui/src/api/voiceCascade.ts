// Tiny browser-side helper for the voice-cascade plugin's read-only routes.
//
// Today this only exposes the /health probe so the Integrations page can show
// the actual `ttsMode` from the running plugin instead of a hard-coded label.
// Keeping it scoped here (instead of importing from the plugin package)
// avoids cross-coupling the host UI to plugin source.

const VOICE_CASCADE_API = "/api/plugins/noralos.voice-cascade/api";

export type VoiceCascadeTtsMode = "live" | "dry_run";

export interface VoiceCascadeHealthResponse {
  status: "ok" | "degraded" | "unavailable";
  providers: { elevenlabs: string; google_tts: string };
  ttsMode: VoiceCascadeTtsMode;
}

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
};
