import { and, eq, isNotNull, notInArray, desc } from "drizzle-orm";
import type { Db } from "@noralos/db";
import {
  companySecrets,
  companySecretVersions,
  integrationCredentialAssignments,
  integrationCredentials,
  plugins as pluginsTable,
} from "@noralos/db";
import {
  ASSIGNMENT_TARGETS,
  INTEGRATION_PROVIDERS,
  type IntegrationAssignmentDto,
  type IntegrationCategory,
  type IntegrationCredentialDto,
  type IntegrationCredentialType,
  type IntegrationEnvironment,
  type IntegrationLastTestStatus,
  type IntegrationStatus,
  type ImportIntegrationCredentialInput,
  type UnmanagedSecretDto,
} from "@noralos/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { secretService } from "../secrets.js";

/**
 * Mask a plaintext value to a UI-safe suffix. Always returns a 4-char tail
 * prefixed with `****`. Short values (< 4 chars) are masked entirely.
 */
function maskSuffix(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

/**
 * Best-guess provider/category from a legacy `company_secrets.name`. Used
 * by the unmanaged-secrets list to pre-fill the Import drawer. Always
 * conservative — unrecognised names suggest nothing.
 */
function suggestProviderFromName(name: string): {
  suggestedProvider: string | null;
  suggestedCategory: IntegrationCategory | null;
} {
  const lower = name.toLowerCase();
  if (lower.includes("google") && lower.includes("tts")) {
    return { suggestedProvider: "google_tts", suggestedCategory: "voice" };
  }
  if (lower.includes("elevenlabs") || lower.includes("eleven-labs")) {
    return { suggestedProvider: "elevenlabs", suggestedCategory: "voice" };
  }
  return { suggestedProvider: null, suggestedCategory: null };
}

interface CredentialRow {
  id: string;
  companyId: string;
  secretId: string | null;
  provider: string;
  category: string;
  credentialType: string;
  displayName: string;
  description: string | null;
  environment: string;
  status: string;
  maskedSuffix: string;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  rotationNotes: string | null;
  metadata: Record<string, unknown> | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AssignmentRow {
  id: string;
  credentialId: string;
  targetKind: string;
  targetPluginId: string;
  targetConfigPath: string;
  assignedAt: Date;
}

/**
 * Build the wire DTO for a credential. Strips `secret_id`, never includes
 * any plaintext, and joins assignments with friendly plugin labels.
 */
function buildCredentialDto(
  row: CredentialRow,
  assignments: Array<
    AssignmentRow & {
      pluginKey: string | null;
      pluginDisplayName: string | null;
    }
  >,
): IntegrationCredentialDto {
  return {
    id: row.id,
    provider: row.provider,
    category: row.category as IntegrationCategory,
    credentialType: row.credentialType as IntegrationCredentialType,
    displayName: row.displayName,
    description: row.description,
    environment: row.environment as IntegrationEnvironment,
    status: row.status as IntegrationStatus,
    maskedSuffix: row.maskedSuffix,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    lastTestStatus: row.lastTestStatus as IntegrationLastTestStatus | null,
    lastTestError: row.lastTestError,
    rotationNotes: row.rotationNotes,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    hasMaterial: row.secretId !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    assignments: assignments
      .filter((a) => a.credentialId === row.id)
      .map<IntegrationAssignmentDto>((a) => ({
        id: a.id,
        credentialId: a.credentialId,
        targetKind: "plugin_config",
        targetPluginId: a.targetPluginId,
        targetPluginKey: a.pluginKey ?? "",
        targetPluginDisplayName: a.pluginDisplayName,
        targetConfigPath: a.targetConfigPath,
        targetSlotLabel: resolveSlotLabel(a.pluginKey, a.targetConfigPath),
        assignedAt: a.assignedAt.toISOString(),
      })),
  };
}

function resolveSlotLabel(pluginKey: string | null, configPath: string): string {
  if (!pluginKey) return configPath;
  const target = ASSIGNMENT_TARGETS.find((t) => t.pluginKey === pluginKey);
  const slot = target?.slots.find((s) => s.configPath === configPath);
  return slot?.label ?? `${pluginKey} ${configPath}`;
}

export interface CreateCredentialInput {
  provider: string;
  displayName: string;
  environment?: IntegrationEnvironment;
  value: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateOAuthDraftInput {
  provider: string;
  displayName: string;
  environment?: IntegrationEnvironment;
  clientId: string;
  clientSecret: string;
  /** Non-secret text fields collected on the form. Stored in metadata.fields. */
  fields: Record<string, string>;
  description?: string | null;
}

export interface SetOAuthTokensInput {
  refreshToken: string;
  /** Non-secret api domain to persist in metadata (provider-specific). */
  apiDomain?: string;
  /** Authoritative accounts-server (if the provider echoes one on callback). */
  accountsServer?: string;
}

export interface RotateCredentialInput {
  value: string;
  rotationNotes?: string | null;
}

export interface UpdateCredentialMetadataInput {
  displayName?: string;
  description?: string | null;
  environment?: IntegrationEnvironment;
  status?: IntegrationStatus;
  rotationNotes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CredentialActor {
  userId: string | null;
  agentId: string | null;
}

export function integrationCredentialService(db: Db) {
  const secretSvc = secretService(db);

  async function loadCredentialRow(id: string): Promise<CredentialRow | null> {
    return db
      .select()
      .from(integrationCredentials)
      .where(eq(integrationCredentials.id, id))
      .then((rows) => (rows[0] as CredentialRow | undefined) ?? null);
  }

  async function loadAssignmentsForCompany(companyId: string) {
    const rows = await db
      .select({
        id: integrationCredentialAssignments.id,
        credentialId: integrationCredentialAssignments.credentialId,
        targetKind: integrationCredentialAssignments.targetKind,
        targetPluginId: integrationCredentialAssignments.targetPluginId,
        targetConfigPath: integrationCredentialAssignments.targetConfigPath,
        assignedAt: integrationCredentialAssignments.assignedAt,
        pluginKey: pluginsTable.pluginKey,
        manifestJson: pluginsTable.manifestJson,
      })
      .from(integrationCredentialAssignments)
      .leftJoin(pluginsTable, eq(integrationCredentialAssignments.targetPluginId, pluginsTable.id))
      .where(eq(integrationCredentialAssignments.companyId, companyId));
    return rows.map((row) => ({
      ...row,
      pluginDisplayName:
        (row.manifestJson as { displayName?: string } | null)?.displayName ?? null,
    }));
  }

  /**
   * Resolve the latest material's plaintext value for a credential. Used
   * exclusively by the test runner; never returned over the wire.
   */
  async function resolvePlaintext(companyId: string, credentialId: string): Promise<string> {
    const row = await loadCredentialRow(credentialId);
    if (!row) throw notFound("Integration credential not found");
    if (row.companyId !== companyId) throw unprocessable("Credential belongs to another company");
    if (!row.secretId) throw unprocessable("Credential has no encrypted material");
    return secretSvc.resolveSecretValue(companyId, row.secretId, "latest");
  }

  return {
    list: async (companyId: string): Promise<IntegrationCredentialDto[]> => {
      const [rows, assignments] = await Promise.all([
        db
          .select()
          .from(integrationCredentials)
          .where(eq(integrationCredentials.companyId, companyId))
          .orderBy(desc(integrationCredentials.createdAt)),
        loadAssignmentsForCompany(companyId),
      ]);
      return (rows as CredentialRow[]).map((row) => buildCredentialDto(row, assignments));
    },

    listUnmanaged: async (companyId: string): Promise<UnmanagedSecretDto[]> => {
      // Find `company_secrets` rows that don't have an `integration_credentials`
      // wrapper. Filters out rows that already do.
      const wrapped = await db
        .select({ secretId: integrationCredentials.secretId })
        .from(integrationCredentials)
        .where(
          and(
            eq(integrationCredentials.companyId, companyId),
            isNotNull(integrationCredentials.secretId),
          ),
        );
      const wrappedIds = wrapped
        .map((w) => w.secretId)
        .filter((id): id is string => typeof id === "string");

      const rows = await (wrappedIds.length === 0
        ? db.select().from(companySecrets).where(eq(companySecrets.companyId, companyId))
        : db
            .select()
            .from(companySecrets)
            .where(
              and(
                eq(companySecrets.companyId, companyId),
                notInArray(companySecrets.id, wrappedIds),
              ),
            ));

      return rows
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((s) => ({
          secretId: s.id,
          name: s.name,
          description: s.description ?? null,
          ...suggestProviderFromName(s.name),
          createdAt: s.createdAt.toISOString(),
        }));
    },

    getById: async (
      companyId: string,
      id: string,
    ): Promise<IntegrationCredentialDto | null> => {
      const row = await loadCredentialRow(id);
      if (!row || row.companyId !== companyId) return null;
      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(row, assignments);
    },

    create: async (
      companyId: string,
      input: CreateCredentialInput,
      actor: CredentialActor,
    ): Promise<IntegrationCredentialDto> => {
      const provider = INTEGRATION_PROVIDERS[input.provider];
      if (!provider) throw unprocessable(`Unknown integration provider: ${input.provider}`);

      // Build a stable secret name from the display name; bail if it
      // collides with an existing secret in the same company.
      const baseName = `integration:${input.provider}:${slugifyDisplayName(input.displayName)}`;
      const existingSecret = await secretSvc.getByName(companyId, baseName);
      if (existingSecret) {
        throw conflict(
          `An integration credential already exists for that provider + name. Pick a different display name.`,
        );
      }

      // 1. Create the encrypted secret via the existing service.
      const secret = await secretSvc.create(
        companyId,
        {
          name: baseName,
          provider: "local_encrypted",
          value: input.value,
          description: input.description ?? null,
        },
        { userId: actor.userId, agentId: actor.agentId },
      );

      // 2. Create the metadata wrapper.
      const masked = maskSuffix(input.value);
      const inserted = await db
        .insert(integrationCredentials)
        .values({
          companyId,
          secretId: secret.id,
          provider: provider.id,
          category: provider.category,
          credentialType: provider.credentialType,
          displayName: input.displayName,
          description: input.description ?? null,
          environment: input.environment ?? "production",
          status: "active",
          maskedSuffix: masked,
          metadata: input.metadata ?? {},
          createdByUserId: actor.userId,
          createdByAgentId: actor.agentId,
          updatedByUserId: actor.userId,
        })
        .returning()
        .then((rows) => (rows[0] as CredentialRow));

      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(inserted, assignments);
    },

    /**
     * Create an OAuth-draft credential. Persists `{clientId, clientSecret}`
     * as the encrypted secret material, marks the credential
     * `needs_attention`, and stores per-provider non-secret fields under
     * `metadata.fields`. The OAuth callback later promotes this to an
     * `active` credential by rotating the secret to include the refresh
     * token (`setOAuthTokens`).
     */
    createOAuthDraft: async (
      companyId: string,
      input: CreateOAuthDraftInput,
      actor: CredentialActor,
    ): Promise<IntegrationCredentialDto> => {
      const provider = INTEGRATION_PROVIDERS[input.provider];
      if (!provider) throw unprocessable(`Unknown integration provider: ${input.provider}`);
      if (!provider.oauth) {
        throw unprocessable(`Provider ${input.provider} is not an OAuth provider`);
      }

      const baseName = `integration:${input.provider}:${slugifyDisplayName(input.displayName)}`;
      const existingSecret = await secretSvc.getByName(companyId, baseName);
      if (existingSecret) {
        throw conflict(
          `An integration credential already exists for that provider + name. Pick a different display name.`,
        );
      }

      // Encrypted material is a JSON blob; the refresh token is added on
      // OAuth callback by `setOAuthTokens`. Storing as JSON keeps the
      // existing single-secret-per-credential schema intact.
      const materialJson = JSON.stringify({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      });

      const secret = await secretSvc.create(
        companyId,
        {
          name: baseName,
          provider: "local_encrypted",
          value: materialJson,
          description: input.description ?? null,
        },
        { userId: actor.userId, agentId: actor.agentId },
      );

      const inserted = await db
        .insert(integrationCredentials)
        .values({
          companyId,
          secretId: secret.id,
          provider: provider.id,
          category: provider.category,
          credentialType: provider.credentialType,
          displayName: input.displayName,
          description: input.description ?? null,
          environment: input.environment ?? "production",
          // Awaiting the OAuth callback. The UI surfaces this distinctly.
          status: "needs_attention",
          maskedSuffix: maskSuffix(input.clientSecret),
          metadata: { fields: input.fields, oauth: { connected: false } },
          createdByUserId: actor.userId,
          createdByAgentId: actor.agentId,
          updatedByUserId: actor.userId,
        })
        .returning()
        .then((rows) => (rows[0] as CredentialRow));

      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(inserted, assignments);
    },

    /**
     * Promote an OAuth-draft credential to an active connected credential
     * by attaching the refresh token. Rotates the encrypted material to
     * preserve audit history. Persists `apiDomain` and `accountsServer`
     * (when provided) under non-secret metadata so plugins can construct
     * provider API URLs without re-running the handshake.
     *
     * Safe to call on either an `initial` connect (draft -> active) or a
     * `reconnect` (active with stale refresh token -> active with fresh
     * refresh token). In both cases the access-token cache for this
     * credential must be cleared by the caller.
     */
    setOAuthTokens: async (
      companyId: string,
      credentialId: string,
      input: SetOAuthTokensInput,
      actor: CredentialActor,
    ): Promise<IntegrationCredentialDto> => {
      const row = await loadCredentialRow(credentialId);
      if (!row || row.companyId !== companyId) throw notFound("Integration credential not found");
      if (!row.secretId) throw unprocessable("Credential has no encrypted material to update");

      // Re-resolve current material so we can preserve clientId/clientSecret
      // while rotating in the new refresh token.
      const currentRaw = await secretSvc.resolveSecretValue(companyId, row.secretId, "latest");
      let current: { clientId?: string; clientSecret?: string };
      try {
        current = JSON.parse(currentRaw);
      } catch {
        throw unprocessable("OAuth credential material is not valid JSON");
      }
      if (!current.clientId || !current.clientSecret) {
        throw unprocessable("OAuth credential material missing clientId/clientSecret");
      }

      const nextJson = JSON.stringify({
        clientId: current.clientId,
        clientSecret: current.clientSecret,
        refreshToken: input.refreshToken,
      });

      await secretSvc.rotate(
        row.secretId,
        { value: nextJson },
        { userId: actor.userId, agentId: actor.agentId },
      );

      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const nextMeta: Record<string, unknown> = {
        ...meta,
        oauth: {
          ...((meta.oauth as Record<string, unknown> | undefined) ?? {}),
          connected: true,
          connectedAt: new Date().toISOString(),
          ...(input.accountsServer ? { accountsServer: input.accountsServer } : {}),
        },
      };
      if (input.apiDomain) nextMeta.apiDomain = input.apiDomain;

      await db
        .update(integrationCredentials)
        .set({
          status: "active",
          maskedSuffix: maskSuffix(input.refreshToken),
          metadata: nextMeta,
          // Clear any prior failed-test state — admin should re-test after rotate.
          lastTestStatus: null,
          lastTestError: null,
          updatedByUserId: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(integrationCredentials.id, credentialId));

      const fresh = await loadCredentialRow(credentialId);
      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(fresh!, assignments);
    },

    importExistingSecret: async (
      companyId: string,
      input: ImportIntegrationCredentialInput,
      actor: CredentialActor,
    ): Promise<IntegrationCredentialDto> => {
      // The underlying company_secrets row already exists; we just create
      // the metadata wrapper so the admin sees the secret in the UI.
      const secret = await secretSvc.getById(input.secretId);
      if (!secret) throw notFound("Existing secret not found");
      if (secret.companyId !== companyId) throw unprocessable("Secret belongs to another company");

      const alreadyWrapped = await db
        .select()
        .from(integrationCredentials)
        .where(
          and(
            eq(integrationCredentials.companyId, companyId),
            eq(integrationCredentials.secretId, secret.id),
          ),
        )
        .then((rows) => rows[0]);
      if (alreadyWrapped) throw conflict("This secret is already managed.");

      // Resolve the plaintext exactly once to compute the masked suffix.
      // The plaintext is only used to derive the suffix; never stored or logged.
      const plaintext = await secretSvc.resolveSecretValue(companyId, secret.id, "latest");
      const masked = maskSuffix(plaintext);

      const inserted = await db
        .insert(integrationCredentials)
        .values({
          companyId,
          secretId: secret.id,
          provider: input.provider,
          category: input.category,
          credentialType: input.credentialType,
          displayName: input.displayName,
          description: input.description ?? secret.description ?? null,
          environment: input.environment,
          status: "active",
          maskedSuffix: masked,
          metadata: {},
          createdByUserId: actor.userId,
          createdByAgentId: actor.agentId,
          updatedByUserId: actor.userId,
        })
        .returning()
        .then((rows) => (rows[0] as CredentialRow));

      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(inserted, assignments);
    },

    updateMetadata: async (
      companyId: string,
      id: string,
      input: UpdateCredentialMetadataInput,
      actor: CredentialActor,
    ): Promise<IntegrationCredentialDto> => {
      const row = await loadCredentialRow(id);
      if (!row || row.companyId !== companyId) throw notFound("Integration credential not found");

      const patch: Partial<typeof integrationCredentials.$inferInsert> = {
        updatedByUserId: actor.userId,
        updatedAt: new Date(),
      };
      if (input.displayName !== undefined) patch.displayName = input.displayName;
      if (input.description !== undefined) patch.description = input.description;
      if (input.environment !== undefined) patch.environment = input.environment;
      if (input.status !== undefined) patch.status = input.status;
      if (input.rotationNotes !== undefined) patch.rotationNotes = input.rotationNotes;
      if (input.metadata !== undefined) patch.metadata = input.metadata;

      await db
        .update(integrationCredentials)
        .set(patch)
        .where(eq(integrationCredentials.id, id));

      const fresh = await loadCredentialRow(id);
      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(fresh!, assignments);
    },

    rotate: async (
      companyId: string,
      id: string,
      input: RotateCredentialInput,
      actor: CredentialActor,
    ): Promise<IntegrationCredentialDto> => {
      const row = await loadCredentialRow(id);
      if (!row || row.companyId !== companyId) throw notFound("Integration credential not found");
      if (!row.secretId) throw unprocessable("Credential has no encrypted material to rotate");

      await secretSvc.rotate(
        row.secretId,
        { value: input.value },
        { userId: actor.userId, agentId: actor.agentId },
      );

      await db
        .update(integrationCredentials)
        .set({
          maskedSuffix: maskSuffix(input.value),
          // Clear the test result — admin must re-run after rotation.
          lastTestStatus: null,
          lastTestError: null,
          rotationNotes: input.rotationNotes ?? null,
          updatedByUserId: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(integrationCredentials.id, id));

      const fresh = await loadCredentialRow(id);
      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(fresh!, assignments);
    },

    disable: async (
      companyId: string,
      id: string,
      actor: CredentialActor,
    ): Promise<IntegrationCredentialDto> => {
      const row = await loadCredentialRow(id);
      if (!row || row.companyId !== companyId) throw notFound("Integration credential not found");

      // Refuse to disable a credential while it's still assigned. The
      // admin must unassign first to avoid silently breaking voice-cascade.
      const liveAssignments = await db
        .select()
        .from(integrationCredentialAssignments)
        .where(eq(integrationCredentialAssignments.credentialId, id));
      if (liveAssignments.length > 0) {
        throw conflict(
          "Unassign this credential before disabling it. It is currently assigned to a plugin slot.",
        );
      }

      await db
        .update(integrationCredentials)
        .set({
          status: "disabled",
          updatedByUserId: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(integrationCredentials.id, id));

      const fresh = await loadCredentialRow(id);
      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(fresh!, assignments);
    },

    /** Delete the metadata row + all assignments. Underlying `company_secrets` row is left for audit. */
    remove: async (companyId: string, id: string): Promise<void> => {
      const row = await loadCredentialRow(id);
      if (!row || row.companyId !== companyId) throw notFound("Integration credential not found");
      await db.delete(integrationCredentials).where(eq(integrationCredentials.id, id));
    },

    recordTestResult: async (
      id: string,
      result: { ok: boolean; safeMessage: string },
    ): Promise<void> => {
      await db
        .update(integrationCredentials)
        .set({
          lastTestedAt: new Date(),
          lastTestStatus: result.ok ? "ok" : "failed",
          lastTestError: result.ok ? null : result.safeMessage,
          updatedAt: new Date(),
        })
        .where(eq(integrationCredentials.id, id));
    },

    resolvePlaintext,

    loadCredentialRow,

    buildCredentialDto: async (
      companyId: string,
      row: CredentialRow,
    ): Promise<IntegrationCredentialDto> => {
      const assignments = await loadAssignmentsForCompany(companyId);
      return buildCredentialDto(row, assignments);
    },

    /** Internal helper exposed for tests. */
    _maskSuffix: maskSuffix,
  };
}

function slugifyDisplayName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
