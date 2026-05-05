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
