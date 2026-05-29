import type { CompanyStatus, PauseReason } from "../constants.js";

/** Operator-facing LLM backend for a company's agents. */
export type CompanyLlmBackendMode = "native" | "deepseek_v4";

/**
 * Company-wide LLM backend override. Applied at agent EXECUTION time (in the
 * heartbeat) — it never mutates `agents.adapter_type` / `agents.adapter_config`,
 * so switching back to `native` is instant and lossless (agents return to their
 * own stored adapter, e.g. claude_local).
 *   - `native`      → each agent runs on its own configured adapter (default).
 *   - `deepseek_v4` → every agent is forced onto `opencode_local` + DeepSeek V4.
 */
export interface CompanyLlmBackendSettings {
  mode: CompanyLlmBackendMode;
  /** When mode=deepseek_v4: opencode model id, e.g. "deepseek/deepseek-v4-pro". */
  model?: string;
  /** Integration credential id (noralai_brooklyn / DeepSeek key) → injected as DEEPSEEK_API_KEY. */
  credentialId?: string;
  updatedAt?: string;
  updatedByUserId?: string | null;
}

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  attachmentMaxBytes: number;
  requireBoardApprovalForNewAgents: boolean;
  feedbackDataSharingEnabled: boolean;
  feedbackDataSharingConsentAt: Date | null;
  feedbackDataSharingConsentByUserId: string | null;
  feedbackDataSharingTermsVersion: string | null;
  brandColor: string | null;
  llmBackendSettings: CompanyLlmBackendSettings;
  logoAssetId: string | null;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
