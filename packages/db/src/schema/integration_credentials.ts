import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";
import { agents } from "./agents.js";

/**
 * `integration_credentials` — admin-facing wrapper around an encrypted
 * `company_secrets` row.
 *
 * The secret material itself stays in `company_secrets` + `company_secret_versions`
 * (the existing encrypted store). This row only holds the human-friendly
 * metadata an admin needs to manage the credential from the Settings UI:
 * provider, category, display name, environment, status, masked suffix,
 * last test result, etc. Raw secret values never live in this table.
 *
 * Phase 1 supports `provider IN ('google_tts','elevenlabs')` with
 * `category = 'voice'` and `credentialType = 'api_key'`. The columns are
 * kept as `text` (not enums) so Phase 2 can extend the registry without a
 * follow-up migration.
 */
export const integrationCredentials = pgTable(
  "integration_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /**
     * FK to the encrypted secret. Nullable so a soft-delete path can keep
     * the audit-friendly metadata even if the secret itself is purged.
     */
    secretId: uuid("secret_id").references(() => companySecrets.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    category: text("category").notNull(),
    credentialType: text("credential_type").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    environment: text("environment").notNull().default("production"),
    status: text("status").notNull().default("active"),
    /** Last 4 chars of the saved value, prefixed with `****`. UI display only. */
    maskedSuffix: text("masked_suffix").notNull(),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestStatus: text("last_test_status"),
    lastTestError: text("last_test_error"),
    rotationNotes: text("rotation_notes"),
    /** Provider-specific NON-secret metadata (e.g. organization ID, region). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyNameUq: uniqueIndex("integration_credentials_company_name_uq").on(table.companyId, table.displayName),
    companyIdx: index("integration_credentials_company_idx").on(table.companyId),
    companyProviderIdx: index("integration_credentials_company_provider_idx").on(table.companyId, table.provider),
    companyCategoryIdx: index("integration_credentials_company_category_idx").on(table.companyId, table.category),
  }),
);
