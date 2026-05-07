import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

/**
 * `integration_credentials` table — admin-visible metadata wrapping a
 * `company_secrets` row. The encrypted secret material stays in
 * `company_secrets` / `company_secret_versions`; this row only carries
 * non-sensitive display and routing metadata for the Settings → Integrations UI.
 *
 * One credential row points at exactly one secret row (`UNIQUE secret_id`).
 * The masked suffix is captured at create / rotate time from the plaintext
 * before it's handed to the secret service; raw plaintext is never stored
 * here.
 *
 * @see server/src/services/integration-credentials.ts
 */
export const integrationCredentials = pgTable(
  "integration_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    secretId: uuid("secret_id")
      .notNull()
      .references(() => companySecrets.id, { onDelete: "restrict" }),

    provider: text("provider").notNull(),
    category: text("category").notNull(),
    credentialType: text("credential_type").notNull(),

    displayName: text("display_name").notNull(),
    description: text("description"),
    environment: text("environment").notNull().default("production"),
    status: text("status").notNull().default("active"),

    maskedSuffix: text("masked_suffix").notNull(),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestStatus: text("last_test_status"),
    lastTestError: text("last_test_error"),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),

    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    createdByUserId: text("created_by_user_id").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyCategoryIdx: index("integration_credentials_company_category_idx").on(
      table.companyId,
      table.category,
    ),
    companyProviderIdx: index("integration_credentials_company_provider_idx").on(
      table.companyId,
      table.provider,
    ),
    companyStatusIdx: index("integration_credentials_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    secretUq: uniqueIndex("integration_credentials_secret_uq").on(table.secretId),
    companyProviderNameUq: uniqueIndex(
      "integration_credentials_company_provider_name_uq",
    ).on(table.companyId, table.provider, table.displayName),
  }),
);
