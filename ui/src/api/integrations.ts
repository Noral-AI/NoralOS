import type {
  IntegrationCredentialDto,
  UnmanagedSecretDto,
  IntegrationProvider,
  IntegrationProviderTestResult,
  IntegrationCategory,
  IntegrationCredentialType,
  IntegrationEnvironment,
  IntegrationStatus,
  ImportIntegrationCredentialInput,
} from "@noralos/shared";
import { api } from "./client";

export type AssignmentBoardSlot = {
  configPath: string;
  label: string;
  expectsProvider: string;
  currentCredential: IntegrationCredentialDto | null;
  candidates: IntegrationCredentialDto[];
};

export type AssignmentBoardCard = {
  pluginKey: string;
  pluginDisplayName: string;
  pluginId: string | null;
  slots: AssignmentBoardSlot[];
};

export type ProviderRegistryResponse = {
  providers: Array<
    Pick<IntegrationProvider, "id" | "category" | "credentialType" | "displayName" | "description" | "fields" | "assignableSlots">
  >;
  assignmentTargets: Array<{
    pluginKey: string;
    pluginDisplayName: string;
    slots: Array<{ configPath: string; label: string; expectsProvider: string }>;
  }>;
};

export const integrationsApi = {
  registry: (companyId: string) =>
    api.get<ProviderRegistryResponse>(
      `/companies/${companyId}/integrations/provider-registry`,
    ),
  list: (companyId: string) =>
    api.get<IntegrationCredentialDto[]>(
      `/companies/${companyId}/integrations/credentials`,
    ),
  unmanaged: (companyId: string) =>
    api.get<UnmanagedSecretDto[]>(
      `/companies/${companyId}/integrations/unmanaged-secrets`,
    ),
  create: (
    companyId: string,
    input: {
      provider: string;
      displayName: string;
      environment?: IntegrationEnvironment;
      value: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ) =>
    api.post<IntegrationCredentialDto>(
      `/companies/${companyId}/integrations/credentials`,
      input,
    ),
  importExisting: (companyId: string, input: ImportIntegrationCredentialInput) =>
    api.post<IntegrationCredentialDto>(
      `/companies/${companyId}/integrations/credentials/import`,
      input,
    ),
  update: (
    id: string,
    input: {
      displayName?: string;
      description?: string | null;
      environment?: IntegrationEnvironment;
      status?: IntegrationStatus;
      rotationNotes?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) => api.patch<IntegrationCredentialDto>(`/integrations/credentials/${id}`, input),
  rotate: (id: string, input: { value: string; rotationNotes?: string }) =>
    api.post<IntegrationCredentialDto>(`/integrations/credentials/${id}/rotate`, input),
  test: (id: string) =>
    api.post<IntegrationProviderTestResult>(`/integrations/credentials/${id}/test`, {}),
  disable: (id: string) =>
    api.post<IntegrationCredentialDto>(`/integrations/credentials/${id}/disable`, {}),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/integrations/credentials/${id}`),
  assignmentBoard: (companyId: string) =>
    api.get<{ board: AssignmentBoardCard[] }>(
      `/companies/${companyId}/integrations/assignments`,
    ),
  assign: (
    credentialId: string,
    input: {
      targetKind: "plugin_config";
      targetPluginId: string;
      targetConfigPath: string;
    },
  ) =>
    api.post<IntegrationCredentialDto>(
      `/integrations/credentials/${credentialId}/assignments`,
      input,
    ),
  unassign: (assignmentId: string) =>
    api.delete<{ ok: true }>(`/integrations/assignments/${assignmentId}`),
};

export type {
  IntegrationCredentialDto,
  UnmanagedSecretDto,
  IntegrationCategory,
  IntegrationCredentialType,
  IntegrationEnvironment,
  IntegrationStatus,
  IntegrationProviderTestResult,
} from "@noralos/shared";
