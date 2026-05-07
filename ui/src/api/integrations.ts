/**
 * Frontend API client for the Settings → Integrations admin surface.
 *
 * All endpoints map 1:1 to `server/src/routes/integrations.ts` and are gated
 * by `assertInstanceAdmin` server-side. The UI hides the page when the
 * sidebar query 401/403s, matching the codebase convention (the server is
 * the only authority on visibility).
 *
 * IMPORTANT: response shapes intentionally never include a raw secret value
 * field. Plaintext is captured client-side only inside controlled forms
 * (Add / Rotate drawers) and is dropped from React state after submission.
 */
import { api } from "./client";

export type CredentialEnvironment = "production" | "test" | "development";
export type CredentialStatus = "active" | "disabled" | "needs_attention";
export type ProviderCategory =
  | "voice"
  | "llm"
  | "telephony"
  | "crm"
  | "email_calendar"
  | "webhook"
  | "other";
export type CredentialType =
  | "api_key"
  | "bearer_token"
  | "webhook_signing_secret"
  | "hmac_secret"
  | "shared_secret"
  | "oauth_client_secret"
  | "oauth_refresh_token"
  | "connection_url"
  | "custom_json_secret";

export interface IntegrationCredential {
  id: string;
  companyId: string;
  secretId: string;
  provider: string;
  category: string;
  credentialType: string;
  displayName: string;
  description: string | null;
  environment: string;
  status: string;
  maskedSuffix: string;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastRotatedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationAssignment {
  id: string;
  companyId: string;
  credentialId: string;
  targetKind: string;
  targetPluginId: string;
  targetPluginKey: string;
  targetField: string;
  assignedAt: string;
}

export interface UnmanagedSecret {
  secretId: string;
  name: string;
  provider: string;
  description: string | null;
  createdAt: string;
}

export interface AssignmentTarget {
  pluginKey: string;
  field: string;
}

export interface ProviderRegistryEntry {
  id: string;
  displayName: string;
  category: ProviderCategory;
  credentialType: CredentialType;
  enabled: boolean;
  assignmentTargets: AssignmentTarget[];
  docsUrl?: string;
  description?: string;
}

export interface ProviderHealthSummary {
  provider: string;
  status: "ok" | "fail" | "untested";
  lastTestedAt: string | null;
}

export interface CredentialTestResult {
  status: "ok" | "fail";
  statusCode?: number;
  error?:
    | "unauthorized"
    | "forbidden"
    | "rate_limited"
    | "network"
    | "timeout"
    | "unknown";
  message?: string;
}

export interface CreateCredentialInput {
  provider: string;
  displayName: string;
  description?: string | null;
  environment?: CredentialEnvironment;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface ImportCredentialInput {
  secretId: string;
  provider: string;
  category: ProviderCategory;
  credentialType: CredentialType;
  displayName: string;
  description?: string | null;
  environment?: CredentialEnvironment;
  metadata?: Record<string, unknown>;
}

export interface UpdateCredentialInput {
  displayName?: string;
  description?: string | null;
  environment?: CredentialEnvironment;
  status?: CredentialStatus;
  metadata?: Record<string, unknown>;
}

const base = (companyId: string) => `/companies/${companyId}/integrations`;

export const integrationsApi = {
  listCredentials: (companyId: string) =>
    api.get<IntegrationCredential[]>(`${base(companyId)}/credentials`),

  listUnmanagedSecrets: (companyId: string) =>
    api.get<UnmanagedSecret[]>(`${base(companyId)}/unmanaged-secrets`),

  getCredential: (companyId: string, id: string) =>
    api.get<{ credential: IntegrationCredential; assignments: IntegrationAssignment[] }>(
      `${base(companyId)}/credentials/${id}`,
    ),

  createCredential: (companyId: string, input: CreateCredentialInput) =>
    api.post<IntegrationCredential>(`${base(companyId)}/credentials`, input),

  importCredential: (companyId: string, input: ImportCredentialInput) =>
    api.post<IntegrationCredential>(`${base(companyId)}/credentials/import`, input),

  updateCredential: (companyId: string, id: string, input: UpdateCredentialInput) =>
    api.patch<IntegrationCredential>(`${base(companyId)}/credentials/${id}`, input),

  rotateCredential: (companyId: string, id: string, value: string) =>
    api.post<IntegrationCredential>(`${base(companyId)}/credentials/${id}/rotate`, {
      value,
    }),

  deleteCredential: (companyId: string, id: string) =>
    api.delete<{ ok: boolean }>(`${base(companyId)}/credentials/${id}`),

  testCredential: (companyId: string, id: string) =>
    api.post<CredentialTestResult>(`${base(companyId)}/credentials/${id}/test`, {}),

  listAssignments: (companyId: string) =>
    api.get<IntegrationAssignment[]>(`${base(companyId)}/assignments`),

  assignCredential: (companyId: string, id: string, body: { pluginKey: string; targetField: string }) =>
    api.post<IntegrationAssignment>(`${base(companyId)}/credentials/${id}/assign`, body),

  unassignCredential: (companyId: string, id: string, assignmentId: string) =>
    api.delete<{ ok: boolean }>(
      `${base(companyId)}/credentials/${id}/assignments/${assignmentId}`,
    ),

  getProviderRegistry: (companyId: string) =>
    api.get<ProviderRegistryEntry[]>(`${base(companyId)}/provider-registry`),

  getHealth: (companyId: string) =>
    api.get<{ providers: ProviderHealthSummary[] }>(`${base(companyId)}/health`),
};
