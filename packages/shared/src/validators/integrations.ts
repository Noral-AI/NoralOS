import { z } from "zod";
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_CREDENTIAL_TYPES,
  INTEGRATION_ENVIRONMENTS,
  INTEGRATION_PROVIDERS,
  INTEGRATION_STATUSES,
} from "../integration-providers.js";

const providerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => Object.prototype.hasOwnProperty.call(INTEGRATION_PROVIDERS, value),
    { message: "Unknown integration provider" },
  );

export const createIntegrationCredentialSchema = z.object({
  provider: providerIdSchema,
  displayName: z.string().trim().min(1).max(120),
  environment: z.enum(INTEGRATION_ENVIRONMENTS).optional(),
  /** Plaintext secret value submitted from the Add modal. Server encrypts. */
  value: z.string().min(1).max(8192),
  description: z.string().trim().max(1024).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Body for `POST /companies/:companyId/integrations/credentials-oauth-draft`.
 *
 * Used by providers with an `oauth` block in their registry entry. The
 * server stores `clientId` + `clientSecret` encrypted as the initial
 * credential material, marks the credential `needs_attention`, and
 * returns an authorize URL the browser then navigates to. The provider
 * callback rotates the same secret material to add the refresh token.
 *
 * `fields` carries the per-provider text inputs declared in
 * `IntegrationProvider.fields` (e.g. `{ clientId, dataCenter }`). The
 * `clientSecret` is passed separately so we can keep it out of the
 * non-secret metadata path entirely.
 */
export const createOAuthIntegrationCredentialSchema = z.object({
  provider: providerIdSchema,
  displayName: z.string().trim().min(1).max(120),
  environment: z.enum(INTEGRATION_ENVIRONMENTS).optional(),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(8192),
  /** Non-secret text fields from the provider's `fields` list, e.g. `{ dataCenter: "us" }`. */
  fields: z.record(z.string(), z.string().trim().min(1).max(256)).default({}),
  description: z.string().trim().max(1024).optional(),
});

export const importIntegrationCredentialSchema = z.object({
  /** Existing `company_secrets.id`. */
  secretId: z.string().uuid(),
  provider: providerIdSchema,
  displayName: z.string().trim().min(1).max(120),
  environment: z.enum(INTEGRATION_ENVIRONMENTS).default("production"),
  category: z.enum(INTEGRATION_CATEGORIES),
  credentialType: z.enum(INTEGRATION_CREDENTIAL_TYPES),
  description: z.string().trim().max(1024).optional(),
});

export const updateIntegrationCredentialSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1024).optional().nullable(),
  environment: z.enum(INTEGRATION_ENVIRONMENTS).optional(),
  status: z.enum(INTEGRATION_STATUSES).optional(),
  rotationNotes: z.string().trim().max(1024).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const rotateIntegrationCredentialSchema = z.object({
  value: z.string().min(1).max(8192),
  rotationNotes: z.string().trim().max(1024).optional(),
});

export const assignIntegrationCredentialSchema = z.object({
  targetKind: z.literal("plugin_config"),
  targetPluginId: z.string().uuid(),
  targetConfigPath: z.string().trim().min(1).max(120),
});

export type CreateIntegrationCredentialInput = z.infer<typeof createIntegrationCredentialSchema>;
export type CreateOAuthIntegrationCredentialInput = z.infer<
  typeof createOAuthIntegrationCredentialSchema
>;
export type ImportIntegrationCredentialInput = z.infer<typeof importIntegrationCredentialSchema>;
export type UpdateIntegrationCredentialInput = z.infer<typeof updateIntegrationCredentialSchema>;
export type RotateIntegrationCredentialInput = z.infer<typeof rotateIntegrationCredentialSchema>;
export type AssignIntegrationCredentialInput = z.infer<typeof assignIntegrationCredentialSchema>;
