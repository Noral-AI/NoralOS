import type { Provider, Tier, Visibility } from "./constants.js";

export interface AgentVoiceConfig {
  companyId: string;
  agentId: string;
  voiceEnabled: boolean;
  provider: Provider;
  voiceId: string;
  dashboardVoiceEnabled: boolean;
  conferenceRoomEnabled: boolean;
  slackVoiceEnabled: boolean;
  phoneVoiceEnabled: boolean;
  ttsRepliesEnabled: boolean;
  tierOverride: Tier | null;
  visibilityOverride: Visibility | null;
  updatedByPrincipalId: string | null;
  updatedByKind: "board" | "agent" | "plugin" | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyVoiceDefaults {
  companyId: string;
  defaultProvider: Exclude<Provider, "default">;
  defaultDashboardVoiceEnabled: boolean;
  defaultConferenceRoomEnabled: boolean;
  defaultSlackVoiceEnabled: boolean;
  defaultPhoneVoiceEnabled: boolean;
  defaultTtsRepliesEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveVoiceConfig {
  companyId: string;
  agentId: string;
  resolved: true;
  derivedTier: Tier;
  effectiveTier: Tier;
  effectiveVisibility: Visibility;
  voiceEnabled: boolean;
  effectiveProvider: Exclude<Provider, "default">;
  voiceId: string;
  dashboardVoiceEnabled: boolean;
  conferenceRoomEnabled: boolean;
  slackVoiceEnabled: boolean;
  phoneVoiceEnabled: boolean;
  ttsRepliesEnabled: boolean;
}

export interface FailClosedVoiceConfig {
  companyId: string;
  agentId: string;
  resolved: false;
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
