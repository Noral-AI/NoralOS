// Browser-side fetch helpers that call voice-cascade's safe routes.
//
// All requests use `credentials: "include"` so the user's NoralOS session
// cookie authenticates the call (auth: "board-or-agent"). Provider keys
// and service-agent tokens never reach the browser.
//
// These types are intentionally a local mirror of voice-cascade's
// public response shapes — we don't depend on @noralos-plugins/voice-cascade
// to keep the plugin packages independent.

const VOICE_CASCADE_API = "/api/plugins/noralos.voice-cascade/api";

export type VoicePickerProvider = "google_tts" | "elevenlabs";

export interface VoicePickerVoice {
  voiceId: string;
  displayName: string;
  provider: VoicePickerProvider;
  languageCodes: string[];
  gender?: "male" | "female" | "neutral" | null;
  style?: string | null;
  previewUrl?: string | null;
}

export type ListVoicesReason =
  | "provider-key-missing"
  | "provider-unreachable"
  | "rate-limited"
  | "internal-error"
  | "invalid-input";

export type ListVoicesResponse =
  | {
      ok: true;
      provider: VoicePickerProvider;
      voices: VoicePickerVoice[];
      ttsMode: "live" | "dry_run";
    }
  | {
      ok: false;
      provider: VoicePickerProvider;
      reason: ListVoicesReason;
      message: string;
      ttsMode: "live" | "dry_run";
    };

export type PreviewReason =
  | "provider-key-missing"
  | "provider-failed"
  | "provider-rate-limited"
  | "invalid-input"
  | "exfiltration-blocked"
  | "dry-run"
  | "internal-error";

export type PreviewResponse =
  | {
      ok: true;
      provider: VoicePickerProvider;
      voiceId: string;
      audioBase64: string;
      mimeType: string;
    }
  | {
      ok: false;
      provider: VoicePickerProvider;
      voiceId: string;
      reason: PreviewReason;
      message: string;
    };

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  // The voice-cascade routes always return 200 with `{ ok: false, ... }` for
  // user-fixable conditions. A non-OK status means a wiring problem.
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    const err = new Error(`voice-cascade ${path} failed: ${message}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export async function listVoices(args: {
  companyId: string;
  provider: VoicePickerProvider;
  languageCode?: string | null;
}): Promise<ListVoicesResponse> {
  const params = new URLSearchParams({
    companyId: args.companyId,
    provider: args.provider,
  });
  if (args.languageCode) params.set("languageCode", args.languageCode);
  return call<ListVoicesResponse>(`${VOICE_CASCADE_API}/voices?${params.toString()}`, {
    method: "GET",
  });
}

export async function previewVoice(args: {
  companyId: string;
  provider: VoicePickerProvider;
  voiceId: string;
}): Promise<PreviewResponse> {
  const params = new URLSearchParams({ companyId: args.companyId });
  return call<PreviewResponse>(`${VOICE_CASCADE_API}/voices/preview?${params.toString()}`, {
    method: "POST",
    body: JSON.stringify({ provider: args.provider, voiceId: args.voiceId }),
  });
}
