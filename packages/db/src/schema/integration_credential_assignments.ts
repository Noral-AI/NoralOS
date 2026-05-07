import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { plugins } from "./plugins.js";
import { integrationCredentials } from "./integration_credentials.js";

/**
 * `integration_credential_assignments` — records that a credential metadata
 * row has been assigned to a specific plugin instance config field
 * (e.g. `voice-cascade.googleTtsApiKeyRef`).
 *
 * For Phase 1, `target_kind` is always `"plugin_config"`. This is the
 * instance-wide plugin configuration table (`plugin_config.config_json`).
 * Per-company overrides via `plugin_company_settings` are not wired into the
 * runtime today; the column is kept open so future per-company kinds can be
 * added without migration.
 *
 * The unique index prevents two active assignments to the same target field.
 * Reassignment replaces the row in place via `INSERT … ON CONFLICT DO UPDATE`.
 */
export const integrationCredentialAssignments = pgTable(
  "integration_credential_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => integrationCredentials.id, { onDelete: "cascade" }),

    targetKind: text("target_kind").notNull().default("plugin_config"),
    targetPluginId: uuid("target_plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    targetField: text("target_field").notNull(),

    assignedByUserId: text("assigned_by_user_id").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    credentialIdx: index("integration_credential_assignments_credential_idx").on(
      table.credentialId,
    ),
    targetUq: uniqueIndex(
      "integration_credential_assignments_target_uq",
    ).on(table.companyId, table.targetPluginId, table.targetField),
  }),
);
