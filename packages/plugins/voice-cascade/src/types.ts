import type { NoAudioReason, Provider, Surface } from "./constants.js";

// Mirror of voice-config's EffectiveVoiceConfig (subset relevant to TTS).
export interface EffectiveVoiceConfig {
  resolved: true;
  companyId: string;
  agentId: string;
  derivedTier: "exec" | "manager" | "worker";
  effectiveTier: "exec" | "manager" | "worker";
  effectiveVisibility: "shown" | "hidden";
  voiceEnabled: boolean;
  effectiveProvider: Provider;
  voiceId: string;
  dashboardVoiceEnabled: boolean;
  conferenceRoomEnabled: boolean;
  slackVoiceEnabled: boolean;
  phoneVoiceEnabled: boolean;
  ttsRepliesEnabled: boolean;
}

export interface FailClosedVoiceConfig {
  resolved: false;
  companyId: string;
  agentId: string;
  reason: string;
  voiceEnabled: false;
  effectiveVisibility: "hidden";
  dashboardVoiceEnabled: false;
  conferenceRoomEnabled: false;
  slackVoiceEnabled: false;
  phoneVoiceEnabled: false;
  ttsRepliesEnabled: false;
}

export type EffectiveOrFailClosed = EffectiveVoiceConfig | FailClosedVoiceConfig;

export interface SynthesizeRequestBody {
  agentId: string;
  text: string;
  surface: Surface;
}

export interface AudioResult {
  ok: true;
  agentId: string;
  surface: Surface;
  providerUsed: Provider;
  voiceId: string;
  mimeType: string;
  audioBase64: string;
  durationMs: number | null;
}

export interface NoAudioResult {
  ok: false;
  agentId: string;
  surface: Surface;
  reason: NoAudioReason;
  message: string;
  providerAttempted?: Provider;
}

export type SynthesisResult = AudioResult | NoAudioResult;

export type ProviderHealth = "ok" | "missing-key" | "unreachable";

export interface HealthResult {
  status: "ok" | "degraded" | "unavailable";
  providers: {
    elevenlabs: ProviderHealth;
    google_tts: ProviderHealth;
  };
  ttsMode: "live" | "dry_run";
}

// Uniform voice descriptor used by the Voice Picker. Both providers map
// onto this shape; provider-specific extras (e.g. ElevenLabs preview_url)
// can be added but are intentionally NOT used in the modal — the modal
// always previews via POST /voices/preview so latency + cost match the
// real synthesis path.
export interface Voice {
  voiceId: string;          // exact id used by /synthesize
  displayName: string;      // human-friendly; equals voiceId for google_tts
  provider: Provider;
  languageCodes: string[];  // ["en-US", ...]
  gender?: "male" | "female" | "neutral" | null;
  style?: string | null;    // google_tts: "Neural2" | "Wavenet" | ... ; elevenlabs: descriptive
  previewUrl?: string | null; // elevenlabs publishes one; not used by modal
}

export type ListVoicesReason =
  | "provider-key-missing"
  | "provider-unreachable"
  | "rate-limited"
  | "internal-error"
  | "invalid-input";

export interface ListVoicesOk {
  ok: true;
  provider: Provider;
  voices: Voice[];
  // Surfaced so the modal can show "selecting a voice does not enable
  // live audio" when ttsMode is dry_run.
  ttsMode: "live" | "dry_run";
}

export interface ListVoicesErr {
  ok: false;
  provider: Provider;
  reason: ListVoicesReason;
  message: string;
  ttsMode: "live" | "dry_run";
}

export type ListVoicesResult = ListVoicesOk | ListVoicesErr;

export type PreviewReason =
  | "provider-key-missing"
  | "provider-failed"
  | "provider-rate-limited"
  | "invalid-input"
  | "exfiltration-blocked"
  | "dry-run"
  | "internal-error";

export interface PreviewOk {
  ok: true;
  // `provider` is the requested provider; `providerUsed` is the one that
  // actually served the synthesis. They're equal today (preview never falls
  // back), but mirroring `AudioResult.providerUsed` from /synthesize keeps
  // the response shape consistent across surfaces.
  provider: Provider;
  providerUsed: Provider;
  voiceId: string;
  audioBase64: string;
  mimeType: string;
}

export interface PreviewErr {
  ok: false;
  provider: Provider;
  voiceId: string;
  reason: PreviewReason;
  message: string;
}

export type PreviewResult = PreviewOk | PreviewErr;
