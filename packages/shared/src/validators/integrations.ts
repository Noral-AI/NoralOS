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
export type ImportIntegrationCredentialInput = z.infer<typeof importIntegrationCredentialSchema>;
export type UpdateIntegrationCredentialInput = z.infer<typeof updateIntegrationCredentialSchema>;
export type RotateIntegrationCredentialInput = z.infer<typeof rotateIntegrationCredentialSchema>;
export type AssignIntegrationCredentialInput = z.infer<typeof assignIntegrationCredentialSchema>;
