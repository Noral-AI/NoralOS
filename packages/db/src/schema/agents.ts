import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { environments } from "./environments.js";
import { departments } from "./departments.js";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    role: text("role").notNull().default("general"),
    title: text("title"),
    icon: text("icon"),
    status: text("status").notNull().default("idle"),
    reportsTo: uuid("reports_to").references((): AnyPgColumn => agents.id),
    capabilities: text("capabilities"),
    adapterType: text("adapter_type").notNull().default("process"),
    adapterConfig: jsonb("adapter_config").$type<Record<string, unknown>>().notNull().default({}),
    runtimeConfig: jsonb("runtime_config").$type<Record<string, unknown>>().notNull().default({}),
    defaultEnvironmentId: uuid("default_environment_id").references(() => environments.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    permissions: jsonb("permissions").$type<Record<string, unknown>>().notNull().default({}),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    // Phase 3: soft FK to NoralVoice's `workflows.workflow_uuid`. Nullable
    // because the vast majority of agents are non-voice. The noralai.noralvoice
    // plugin reads + writes this column when an operator configures voice
    // settings on an Agent detail page. Phase 7 may promote to an enforced
    // cross-DB FK once schemas merge.
    voiceAgentUuid: varchar("voice_agent_uuid", { length: 36 }),
    // Phase 6 PR-4: voice surface flags + tier/visibility overrides moved
    // from the retired `voice-config` plugin's `agent_voice_config` table
    // onto core agents. Keys: dashboard, slack, phone (Conference Room
    // was removed in #105 — its flag is intentionally dropped). The
    // `voice_enabled` concept is now derived: `voice_agent_uuid IS NOT NULL`.
    surfaceFlags: jsonb("surface_flags")
      .$type<{ dashboard: boolean; slack: boolean; phone: boolean }>()
      .notNull()
      .default(sql`'{"dashboard": true, "slack": false, "phone": false}'::jsonb`),
    tierOverride: text("tier_override"),
    visibilityOverride: text("visibility_override"),
    ttsRepliesEnabled: boolean("tts_replies_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("agents_company_status_idx").on(table.companyId, table.status),
    companyReportsToIdx: index("agents_company_reports_to_idx").on(table.companyId, table.reportsTo),
    companyDefaultEnvironmentIdx: index("agents_company_default_environment_idx").on(table.companyId, table.defaultEnvironmentId),
    companyDepartmentIdx: index("agents_company_department_idx").on(table.companyId, table.departmentId),
    // Partial index — most agents have NULL here; only index real values.
    voiceAgentUuidIdx: index("agents_voice_agent_uuid_idx")
      .on(table.voiceAgentUuid)
      .where(sql`${table.voiceAgentUuid} IS NOT NULL`),
  }),
);
