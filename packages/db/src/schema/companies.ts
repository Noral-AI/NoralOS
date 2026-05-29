import { pgTable, uuid, text, integer, timestamp, boolean, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

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

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    issuePrefix: text("issue_prefix").notNull().default("PAP"),
    issueCounter: integer("issue_counter").notNull().default(0),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    attachmentMaxBytes: integer("attachment_max_bytes")
      .notNull()
      .default(10 * 1024 * 1024),
    requireBoardApprovalForNewAgents: boolean("require_board_approval_for_new_agents")
      .notNull()
      .default(false),
    feedbackDataSharingEnabled: boolean("feedback_data_sharing_enabled")
      .notNull()
      .default(false),
    feedbackDataSharingConsentAt: timestamp("feedback_data_sharing_consent_at", { withTimezone: true }),
    feedbackDataSharingConsentByUserId: text("feedback_data_sharing_consent_by_user_id"),
    feedbackDataSharingTermsVersion: text("feedback_data_sharing_terms_version"),
    brandColor: text("brand_color"),
    llmBackendSettings: jsonb("llm_backend_settings")
      .$type<CompanyLlmBackendSettings>()
      .notNull()
      .default({ mode: "native" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issuePrefixUniqueIdx: uniqueIndex("companies_issue_prefix_idx").on(table.issuePrefix),
  }),
);
