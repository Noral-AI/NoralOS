import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { integrationCredentials } from "./integration_credentials.js";
import { plugins } from "./plugins.js";

/**
 * `integration_credential_assignments` — binding from a managed credential
 * to a concrete consumer slot.
 *
 * Phase 1 supports only `target_kind = 'plugin_config'` — the assignment
 * service patches the target plugin's `instanceConfig` at
 * `target_config_path` with the credential's underlying secret id. Phase 2
 * will extend this to agent / workflow / webhook targets.
 *
 * The unique index on (target_plugin_id, target_config_path) means each
 * plugin slot has at most one active assignment; reassigning is a single
 * DELETE+INSERT inside one transaction.
 */
export const integrationCredentialAssignments = pgTable(
  "integration_credential_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => integrationCredentials.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(),
    targetPluginId: uuid("target_plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    targetConfigPath: text("target_config_path").notNull(),
    assignedByUserId: text("assigned_by_user_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slotUq: uniqueIndex("integration_credential_assignments_slot_uq").on(
      table.targetPluginId,
      table.targetConfigPath,
    ),
    credentialIdx: index("integration_credential_assignments_credential_idx").on(table.credentialId),
  }),
);
