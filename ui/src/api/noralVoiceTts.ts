// Browser-side client for NoralVoice TTS via the noralai.noralvoice plugin.
//
// Phase 6 — see docs/audit/consolidation-plan.md.
//
// The browser POSTs here; the plugin worker forwards to NoralVoice's
// /api/v1/public/embed/synthesize with the plugin's apiKey. The apiKey
// NEVER reaches the browser — only the resulting pre-signed audio URL.
//
// 422 `text_blocked_exfiltration` from NoralVoice surfaces here as
// `{ok: false, reason: "exfiltration-blocked"}` (matches voice-cascade's
// contract for the same scenario, so `useChatVoiceAutoplay` can no-op
// cleanly).

const NORALVOICE_PLUGIN_API = "/api/plugins/noralai.noralvoice/api";

export interface NoralVoiceSynthesizeOk {
  ok: true;
  audioUrl: string;
  expiresAt: string;
  contentType: string;
  durationSeconds: number;
  charCount: number;
  provider: string;
}

export interface NoralVoiceSynthesizeBlocked {
  ok: false;
  reason: "exfiltration-blocked";
  matchTypes: string[];
}

export interface NoralVoiceSynthesizeFailed {
  ok: false;
  reason: "transport-error" | "upstream-error";
  message: string;
  status?: number;
}

export type NoralVoiceSynthesizeResult =
  | NoralVoiceSynthesizeOk
  | NoralVoiceSynthesizeBlocked
  | NoralVoiceSynthesizeFailed;

export interface NoralVoiceSynthesizeInput {
  companyId: string;
  text: string;
  voiceOverride?: {
    provider: string;
    voiceId: string;
    model: string;
  };
}

export const noralVoiceTtsApi = {
  /**
   * Synthesize a clip of audio via NoralVoice's multi-provider TTS catalog.
   *
   * Callers MUST check `ok` on the result. `ok: false` with
   * `reason: "exfiltration-blocked"` is normal — surface no audio,
   * do not retry. `ok: false` with `reason: "transport-error"` is
   * an infrastructure issue; the caller can retry or fall back.
   */
  synthesize: async (
    input: NoralVoiceSynthesizeInput,
  ): Promise<NoralVoiceSynthesizeResult> => {
    const params = new URLSearchParams({ companyId: input.companyId });
    const requestBody: Record<string, unknown> = { text: input.text };
    if (input.voiceOverride) {
      requestBody.voiceOverride = input.voiceOverride;
    }
    let res: Response;
    try {
      res = await fetch(
        `${NORALVOICE_PLUGIN_API}/synthesize?${params.toString()}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
      );
    } catch (err) {
      return {
        ok: false,
        reason: "transport-error",
        message: err instanceof Error ? err.message : "fetch failed",
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        reason: "transport-error",
        message: `noralvoice /synthesize failed: HTTP ${res.status}`,
        status: res.status,
      };
    }

    const body = (await res.json()) as Record<string, unknown>;
    if (body.ok === true) {
      return {
        ok: true,
        audioUrl: String(body.audioUrl ?? ""),
        expiresAt: String(body.expiresAt ?? ""),
        contentType: String(body.contentType ?? "audio/wav"),
        durationSeconds: Number(body.durationSeconds ?? 0),
        charCount: Number(body.charCount ?? 0),
        provider: String(body.provider ?? ""),
      };
    }
    if (body.reason === "exfiltration-blocked") {
      const types = Array.isArray(body.matchTypes)
        ? body.matchTypes.map((t) => String(t))
        : [];
      return { ok: false, reason: "exfiltration-blocked", matchTypes: types };
    }
    // Upstream-error path — plugin worker hit NV's 4xx/5xx.
    return {
      ok: false,
      reason: "upstream-error",
      message:
        typeof body.message === "string"
          ? body.message
          : `noralvoice /synthesize upstream error`,
      status: typeof body.status === "number" ? body.status : undefined,
    };
  },
};
