import type { Provider, Tier, Visibility } from "./constants.js";

/**
 * Long-term Conference Room role for an agent. The room shows the host
 * prominently, lists explicitly-marked directors, and never shows an agent
 * resolved to "hidden" — regardless of derived tier or has-direct-reports
 * heuristics.
 */
export const CONFERENCE_ROOM_ROLES = ["host", "director", "hidden"] as const;
export type ConferenceRoomRole = (typeof CONFERENCE_ROOM_ROLES)[number];

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
  /**
   * Explicit Conference Room visibility (NULL means inherit from the
   * fallthrough rules in `resolveEffective`). Always evaluated AFTER
   * systemManaged + role=ceo so service agents stay hidden and the CEO
   * stays visible regardless of admin edits.
   */
  conferenceRoomVisible: boolean | null;
  /**
   * Explicit Conference Room role label. NULL means inherit. Same
   * precedence as `conferenceRoomVisible` — never overrides the
   * systemManaged/CEO short-circuits.
   */
  conferenceRoomRole: ConferenceRoomRole | null;
  /**
   * True iff this agent is the Conference Room's default target when no
   * participant has explicitly pinned someone. The migration's partial
   * unique index limits this to one row per company.
   */
  conferenceRoomDefaultTarget: boolean;
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
  /**
   * Long-term explicit Conference Room visibility. True iff the agent
   * should appear in the Conference Room team list AND be selectable.
   * Service agents (`metadata.systemManaged`) always resolve to false.
   */
  conferenceRoomVisible: boolean;
  /**
   * Long-term explicit Conference Room role. Always present, never null.
   * `hidden` mirrors `conferenceRoomVisible === false`.
   */
  conferenceRoomRole: ConferenceRoomRole;
  /**
   * True iff this agent is the room's default target when no explicit
   * pin is provided. At most one true per company.
   */
  conferenceRoomDefaultTarget: boolean;
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
  conferenceRoomVisible: false;
  conferenceRoomRole: "hidden";
  conferenceRoomDefaultTarget: false;
}

export type EffectiveOrFailClosed = EffectiveVoiceConfig | FailClosedVoiceConfig;
