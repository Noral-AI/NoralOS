/**
 * Settings → Integrations credential service.
 *
 * A thin metadata wrapper around the existing `secretService`. This module
 * never sees encrypted material; it stores admin-visible metadata in
 * `integration_credentials` and delegates all encrypted-material operations
 * (create, rotate, resolve, delete) to `secretService`.
 *
 * Phase 1 invariants:
 *  - Raw plaintext is never stored here. The masked suffix is computed from
 *    plaintext at create / rotate time and only the suffix is persisted.
 *  - Response shapes (DTOs) intentionally exclude any `value` field, so
 *    plaintext cannot leak through the API.
 *  - Provider tests resolve plaintext only inside this module's `testCredential`
 *    and pass it directly to the provider HTTP call. The plaintext is held in
 *    a single function-local variable and never logged.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@noralos/db";
import {
  companySecrets,
  integrationCredentialAssignments,
  integrationCredentials,
} from "@noralos/db";
import type { SecretProvider } from "@noralos/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { secretService } from "../secrets.js";
import {
  getProvider,
  type ProviderId,
  type ProviderCategory,
  type CredentialType,
} from "./provider-registry.js";
import type { TestResult } from "./providers/types.js";

export type CredentialEnvironment = "production" | "test" | "development";
export type CredentialStatus = "active" | "disabled" | "needs_attention";

export interface CredentialDto {
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

export interface CreateCredentialInput {
  provider: ProviderId;
  displayName: string;
  description?: string | null;
  environment?: CredentialEnvironment;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface ImportCredentialInput {
  secretId: string;
  provider: ProviderId;
  category: ProviderCategory;
  credentialType: CredentialType;
  displayName: string;
  description?: string | null;
  environment?: CredentialEnvironment;
  metadata?: Record<string, unknown>;
}

export interface UpdateCredentialMetadataInput {
  displayName?: string;
  description?: string | null;
  environment?: CredentialEnvironment;
  status?: CredentialStatus;
  metadata?: Record<string, unknown>;
}

const SAFE_SECRET_NAME_RE = /[^a-z0-9_-]+/g;

function deriveSecretName(provider: string, displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(SAFE_SECRET_NAME_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `integrations__${provider}__${slug || "credential"}`;
}

/**
 * Compute a 4-char masked suffix from plaintext for display purposes.
 * Returns the literal `••••????` placeholder when plaintext is empty or too
 * short — used for imported secrets where we cannot read the underlying
 * value.
 */
export function computeMaskedSuffix(plaintext: string | null | undefined): string {
  if (!plaintext || plaintext.length < 4) return "••••????";
  return `••••${plaintext.slice(-4)}`;
}

function rowToDto(row: typeof integrationCredentials.$inferSelect): CredentialDto {
  return {
    id: row.id,
    companyId: row.companyId,
    secretId: row.secretId,
    provider: row.provider,
    category: row.category,
    credentialType: row.credentialType,
    displayName: row.displayName,
    description: row.description,
    environment: row.environment,
    status: row.status,
    maskedSuffix: row.maskedSuffix,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastRotatedAt: row.lastRotatedAt ? row.lastRotatedAt.toISOString() : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface UnmanagedSecret {
  secretId: string;
  name: string;
  provider: string;
  description: string | null;
  createdAt: string;
}

export function integrationCredentialsService(db: Db) {
  const secrets = secretService(db);

  async function list(companyId: string): Promise<CredentialDto[]> {
    const rows = await db
      .select()
      .from(integrationCredentials)
      .where(eq(integrationCredentials.companyId, companyId))
      .orderBy(desc(integrationCredentials.createdAt));
    return rows.map(rowToDto);
  }

  async function getById(
    companyId: string,
    id: string,
  ): Promise<CredentialDto | null> {
    const row = await db
      .select()
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.id, id),
          eq(integrationCredentials.companyId, companyId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    return row ? rowToDto(row) : null;
  }

  async function getByIdOrThrow(
    companyId: string,
    id: string,
  ): Promise<typeof integrationCredentials.$inferSelect> {
    const row = await db
      .select()
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.id, id),
          eq(integrationCredentials.companyId, companyId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Credential not found");
    return row;
  }

  async function listUnmanagedSecrets(
    companyId: string,
  ): Promise<UnmanagedSecret[]> {
    const rows = await db
      .select({
        secretId: companySecrets.id,
        name: companySecrets.name,
        provider: companySecrets.provider,
        description: companySecrets.description,
        createdAt: companySecrets.createdAt,
      })
      .from(companySecrets)
      .leftJoin(
        integrationCredentials,
        eq(integrationCredentials.secretId, companySecrets.id),
      )
      .where(
        and(
          eq(companySecrets.companyId, companyId),
          isNull(integrationCredentials.id),
        ),
      )
      .orderBy(desc(companySecrets.createdAt));
    return rows.map((r) => ({
      secretId: r.secretId,
      name: r.name,
      provider: r.provider,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async function create(
    companyId: string,
    input: CreateCredentialInput,
    actor: { userId: string },
  ): Promise<CredentialDto> {
    const provider = getProvider(input.provider);
    if (!provider || !provider.enabled) {
      throw unprocessable(`Provider not available: ${input.provider}`);
    }
    if (!input.value || typeof input.value !== "string" || input.value.length === 0) {
      throw unprocessable("Credential value is required");
    }
    const environment = input.environment ?? "production";
    const secretName = deriveSecretName(provider.id, input.displayName);

    // Conflict pre-check on display name (DB unique provides backstop).
    const dup = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.companyId, companyId),
          eq(integrationCredentials.provider, provider.id),
          eq(integrationCredentials.displayName, input.displayName),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (dup) {
      throw conflict(`A credential with this name already exists for ${provider.displayName}`);
    }

    const maskedSuffix = computeMaskedSuffix(input.value);

    // Step 1 — write the encrypted secret via the existing secret service.
    const created = await secrets.create(
      companyId,
      {
        name: secretName,
        provider: "local_encrypted" satisfies SecretProvider,
        value: input.value,
        description: `Integration credential: ${provider.displayName} / ${input.displayName}`,
      },
      { userId: actor.userId, agentId: null },
    );

    // Step 2 — write metadata. If this fails we leave the secret behind; the
    // import flow can wrap it.
    const row = await db
      .insert(integrationCredentials)
      .values({
        companyId,
        secretId: created.id,
        provider: provider.id,
        category: provider.category,
        credentialType: provider.credentialType,
        displayName: input.displayName,
        description: input.description ?? null,
        environment,
        status: "active",
        maskedSuffix,
        metadata: input.metadata ?? {},
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      })
      .returning()
      .then((rows) => rows[0]);

    return rowToDto(row);
  }

  async function importExistingSecret(
    companyId: string,
    input: ImportCredentialInput,
    actor: { userId: string },
  ): Promise<CredentialDto> {
    const secret = await secrets.getById(input.secretId);
    if (!secret) throw notFound("Secret not found");
    if (secret.companyId !== companyId) {
      throw unprocessable("Secret does not belong to this company");
    }

    // Refuse to import the same secret twice.
    const existing = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(eq(integrationCredentials.secretId, input.secretId))
      .then((rows) => rows[0] ?? null);
    if (existing) {
      throw conflict("This secret is already managed as a credential");
    }

    const provider = getProvider(input.provider);
    if (!provider) {
      throw unprocessable(`Unknown provider: ${input.provider}`);
    }

    const row = await db
      .insert(integrationCredentials)
      .values({
        companyId,
        secretId: input.secretId,
        provider: provider.id,
        category: input.category,
        credentialType: input.credentialType,
        displayName: input.displayName,
        description: input.description ?? null,
        environment: input.environment ?? "production",
        status: "active",
        // We can't read the existing plaintext; placeholder until first rotate.
        maskedSuffix: "••••????",
        metadata: input.metadata ?? {},
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      })
      .returning()
      .then((rows) => rows[0]);

    return rowToDto(row);
  }

  async function updateMetadata(
    companyId: string,
    id: string,
    patch: UpdateCredentialMetadataInput,
    actor: { userId: string },
  ): Promise<CredentialDto> {
    const existing = await getByIdOrThrow(companyId, id);
    const updates: Partial<typeof integrationCredentials.$inferInsert> & {
      updatedAt: Date;
      updatedByUserId: string;
    } = {
      updatedAt: new Date(),
      updatedByUserId: actor.userId,
    };
    if (patch.displayName !== undefined) updates.displayName = patch.displayName;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.environment !== undefined) updates.environment = patch.environment;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.metadata !== undefined) updates.metadata = patch.metadata;

    if (
      patch.displayName !== undefined &&
      patch.displayName !== existing.displayName
    ) {
      const dup = await db
        .select({ id: integrationCredentials.id })
        .from(integrationCredentials)
        .where(
          and(
            eq(integrationCredentials.companyId, companyId),
            eq(integrationCredentials.provider, existing.provider),
            eq(integrationCredentials.displayName, patch.displayName),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (dup && dup.id !== existing.id) {
        throw conflict("A credential with this name already exists for this provider");
      }
    }

    const updated = await db
      .update(integrationCredentials)
      .set(updates)
      .where(eq(integrationCredentials.id, id))
      .returning()
      .then((rows) => rows[0]);
    return rowToDto(updated);
  }

  async function rotate(
    companyId: string,
    id: string,
    value: string,
    actor: { userId: string },
  ): Promise<CredentialDto> {
    if (!value || value.length === 0) {
      throw unprocessable("Replacement value is required");
    }
    const existing = await getByIdOrThrow(companyId, id);
    await secrets.rotate(
      existing.secretId,
      { value },
      { userId: actor.userId, agentId: null },
    );
    const maskedSuffix = computeMaskedSuffix(value);
    const updated = await db
      .update(integrationCredentials)
      .set({
        maskedSuffix,
        lastRotatedAt: new Date(),
        // Clear stale test status — admin should re-test after rotation.
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
        // Treat needs_attention as resolved by a fresh value, but leave
        // explicit `disabled` alone.
        status: existing.status === "needs_attention" ? "active" : existing.status,
        updatedAt: new Date(),
        updatedByUserId: actor.userId,
      })
      .where(eq(integrationCredentials.id, id))
      .returning()
      .then((rows) => rows[0]);
    return rowToDto(updated);
  }

  async function setStatus(
    companyId: string,
    id: string,
    status: CredentialStatus,
    actor: { userId: string },
  ): Promise<CredentialDto> {
    await getByIdOrThrow(companyId, id);
    const updated = await db
      .update(integrationCredentials)
      .set({
        status,
        updatedAt: new Date(),
        updatedByUserId: actor.userId,
      })
      .where(eq(integrationCredentials.id, id))
      .returning()
      .then((rows) => rows[0]);
    return rowToDto(updated);
  }

  async function remove(companyId: string, id: string): Promise<void> {
    const existing = await getByIdOrThrow(companyId, id);

    // Refuse to delete a credential that has active assignments — the admin
    // must unassign first to avoid silently leaving a plugin field pointing
    // at a UUID that's about to disappear.
    const assignmentCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(integrationCredentialAssignments)
      .where(eq(integrationCredentialAssignments.credentialId, id))
      .then((rows) => rows[0]?.count ?? 0);
    if (assignmentCount > 0) {
      throw conflict(
        "Cannot delete a credential with active assignments. Remove the assignments first.",
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.id, id));
      // Also remove the underlying secret. integration_credentials.secret_id
      // is ON DELETE RESTRICT, but we just removed the only reference, so
      // the secret can be deleted now.
      await tx.delete(companySecrets).where(eq(companySecrets.id, existing.secretId));
    });
  }

  async function recordTestResult(
    id: string,
    result: TestResult,
  ): Promise<void> {
    await db
      .update(integrationCredentials)
      .set({
        lastTestedAt: new Date(),
        lastTestStatus: result.status,
        lastTestError: result.status === "ok" ? null : result.error,
        // A successful test doesn't auto-clear `disabled`, but it does clear
        // `needs_attention`.
        status:
          result.status === "ok"
            ? sql`CASE WHEN ${integrationCredentials.status} = 'needs_attention' THEN 'active' ELSE ${integrationCredentials.status} END`
            : sql`${integrationCredentials.status}`,
        updatedAt: new Date(),
      })
      .where(eq(integrationCredentials.id, id));
  }

  return {
    list,
    getById,
    listUnmanagedSecrets,
    create,
    importExistingSecret,
    updateMetadata,
    rotate,
    setStatus,
    remove,
    recordTestResult,
  };
}
