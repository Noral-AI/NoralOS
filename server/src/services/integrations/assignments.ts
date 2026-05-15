// Credential → plugin slot assignment.
//
// Phase 1 only assigns to `voice-cascade` slots:
//   - `googleTtsApiKeyRef` accepts a `google_tts` provider credential
//   - `elevenLabsApiKeyRef` accepts an `elevenlabs` provider credential
//
// The assignment writer:
//   1. Validates the slot is allowed (allowlisted in INTEGRATION_PROVIDERS).
//   2. Validates the credential's provider matches the slot's expectation.
//   3. Inside one transaction, replaces any existing assignment row for
//      the same (plugin, configPath) and writes the credential's
//      underlying secret-id into the plugin's `plugin_config.config_json`
//      via `pluginRegistryService.patchConfig` (shallow merge) — so
//      unrelated fields (`voiceConfigAgentTokenRef`, `ttsMode`,
//      `googleTtsDefaultLanguageCode`, `maxTextChars`, …) are preserved
//      verbatim.
//   4. After the patch, calls the worker's `configChanged` RPC so the
//      worker picks up the new ref live; if the worker hasn't
//      implemented `onConfigChanged` we fall back to a worker restart.
//      No-op when the worker isn't running.
//
// Crucially, this code path NEVER sets `ttsMode: live`. The patchConfig
// helper does a shallow merge so any field not in the patch object is
// preserved verbatim.

import { and, eq } from "drizzle-orm";
import type { Db } from "@noralos/db";
import {
  integrationCredentialAssignments,
  integrationCredentials,
  pluginConfig as pluginConfigTable,
  plugins as pluginsTable,
} from "@noralos/db";
import {
  ASSIGNMENT_TARGETS,
  INTEGRATION_PROVIDERS,
  type IntegrationCredentialDto,
} from "@noralos/shared";
import { JsonRpcCallError, PLUGIN_RPC_ERROR_CODES } from "@noralos/plugin-sdk";
import type { PluginWorkerManager } from "../plugin-worker-manager.js";
import type { PluginLifecycleManager } from "../plugin-lifecycle.js";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { integrationCredentialService, type CredentialActor } from "./credentials.js";
import { pluginRegistryService } from "../plugin-registry.js";

export interface AssignInput {
  credentialId: string;
  targetPluginId: string;
  targetConfigPath: string;
}

/**
 * Optional dependencies that let assign/unassign notify the running
 * worker after a config change. When omitted (e.g. unit tests) the
 * service still patches the DB; the worker will pick up the change on
 * its next manual restart.
 */
export interface AssignmentServiceDeps {
  workerManager?: Pick<PluginWorkerManager, "isRunning" | "call">;
  lifecycle?: Pick<PluginLifecycleManager, "restartWorker">;
}

/**
 * Read the non-secret form fields off a credential row. The credentials
 * service stores them under `metadata.fields` as `Record<string, string>`
 * (per the create/update paths). Returns an empty object when missing or
 * malformed so callers can iterate without guarding.
 */
function readCredentialFields(row: { metadata?: unknown }): Record<string, string> {
  const metadata = row.metadata as { fields?: unknown } | null | undefined;
  const fields = metadata?.fields;
  if (!fields || typeof fields !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/**
 * Coerce a credential field's string value to the type the plugin's
 * `instanceConfigSchema` expects. JSON-schema validation in the plugin
 * loader rejects type mismatches; coercing here keeps the cast in one
 * place and out of every plugin worker. Returns the raw string when no
 * coercion is requested.
 */
function coerceFieldValue(raw: string, coerce: "integer" | "boolean" | undefined): unknown {
  if (coerce === "integer") {
    // Integer fields in the form layer are typed as text but constrained
    // to digits by the input. Empty / non-numeric values were filtered
    // out by the caller (raw === "" is skipped). Use `Number()` rather
    // than `parseInt` so a trailing-garbage value like "12abc" surfaces
    // as NaN and gets rejected by JSON-schema downstream — better than
    // silently truncating.
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw unprocessable(
        `Credential field expected integer but got "${raw}". Fix the credential's value before assigning.`,
      );
    }
    return n;
  }
  if (coerce === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw unprocessable(
      `Credential field expected boolean but got "${raw}". Use literal "true" or "false".`,
    );
  }
  return raw;
}

export function integrationAssignmentService(db: Db, deps: AssignmentServiceDeps = {}) {
  const credentialSvc = integrationCredentialService(db);
  const registry = pluginRegistryService(db);

  /**
   * Tell the worker about the patched config. Mirrors
   * routes/plugins.ts handling: try `configChanged` RPC; on
   * METHOD_NOT_IMPLEMENTED restart the worker; otherwise let the
   * persisted config take effect at the next restart.
   */
  async function notifyConfigChanged(pluginId: string, configJson: Record<string, unknown>) {
    if (!deps.workerManager) return;
    if (!deps.workerManager.isRunning(pluginId)) return;
    try {
      await deps.workerManager.call(pluginId, "configChanged", { config: configJson });
    } catch (rpcErr) {
      if (
        rpcErr instanceof JsonRpcCallError &&
        rpcErr.code === PLUGIN_RPC_ERROR_CODES.METHOD_NOT_IMPLEMENTED
      ) {
        if (deps.lifecycle) {
          try {
            await deps.lifecycle.restartWorker(pluginId);
          } catch (restartErr) {
            logger.warn(
              { pluginId, err: restartErr },
              "integrations: worker restart after config patch failed",
            );
          }
        }
        return;
      }
      // Other RPC errors are non-fatal — config is already persisted.
      logger.warn(
        { pluginId, err: rpcErr },
        "integrations: worker configChanged RPC failed; will pick up on next restart",
      );
    }
  }

  /**
   * Validate that (pluginKey, configPath) is one of the allowlisted
   * Phase-1 voice-cascade slots, and that the credential's provider
   * matches what the slot expects.
   */
  function validateSlot(
    pluginKey: string,
    configPath: string,
    credentialProvider: string,
  ) {
    const target = ASSIGNMENT_TARGETS.find((t) => t.pluginKey === pluginKey);
    if (!target) {
      throw unprocessable(
        `Plugin "${pluginKey}" is not assignable from the Integrations page yet.`,
      );
    }
    const slot = target.slots.find((s) => s.configPath === configPath);
    if (!slot) {
      throw unprocessable(
        `Plugin "${pluginKey}" does not expose an assignable slot at "${configPath}".`,
      );
    }
    if (slot.expectsProvider !== credentialProvider) {
      throw unprocessable(
        `Slot "${slot.label}" expects a ${slot.expectsProvider} credential, ` +
          `but this credential is ${credentialProvider}.`,
      );
    }
    return slot;
  }

  return {
    listForCompany: async (companyId: string) => {
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
          credentialProvider: integrationCredentials.provider,
          credentialDisplayName: integrationCredentials.displayName,
        })
        .from(integrationCredentialAssignments)
        .leftJoin(pluginsTable, eq(integrationCredentialAssignments.targetPluginId, pluginsTable.id))
        .leftJoin(integrationCredentials, eq(integrationCredentialAssignments.credentialId, integrationCredentials.id))
        .where(eq(integrationCredentialAssignments.companyId, companyId));
      return rows.map((row) => ({
        id: row.id,
        credentialId: row.credentialId,
        credentialProvider: row.credentialProvider,
        credentialDisplayName: row.credentialDisplayName,
        targetKind: row.targetKind as "plugin_config",
        targetPluginId: row.targetPluginId,
        targetPluginKey: row.pluginKey ?? "",
        targetPluginDisplayName:
          (row.manifestJson as { displayName?: string } | null)?.displayName ?? null,
        targetConfigPath: row.targetConfigPath,
        assignedAt: row.assignedAt.toISOString(),
      }));
    },

    /**
     * Returns the per-plugin "Assignment cards" the UI renders. For Phase 1
     * this is a single card for voice-cascade with two slots. Each slot
     * carries the currently-assigned credential (if any) plus the
     * candidate credentials the admin can pick from.
     */
    listAssignmentBoard: async (companyId: string) => {
      const credentials = await credentialSvc.list(companyId);
      const cards: Array<{
        pluginKey: string;
        pluginDisplayName: string;
        pluginId: string | null;
        slots: Array<{
          configPath: string;
          label: string;
          expectsProvider: string;
          currentCredential: IntegrationCredentialDto | null;
          candidates: IntegrationCredentialDto[];
        }>;
      }> = [];

      for (const target of ASSIGNMENT_TARGETS) {
        const plugin = await db
          .select()
          .from(pluginsTable)
          .where(eq(pluginsTable.pluginKey, target.pluginKey))
          .then((rows) => rows[0] ?? null);
        cards.push({
          pluginKey: target.pluginKey,
          pluginDisplayName: target.pluginDisplayName,
          pluginId: plugin?.id ?? null,
          slots: target.slots.map((slot) => {
            const candidates = credentials.filter(
              (c) => c.provider === slot.expectsProvider && c.status === "active",
            );
            const current = credentials.find((c) =>
              c.assignments.some(
                (a) =>
                  a.targetPluginId === plugin?.id &&
                  a.targetConfigPath === slot.configPath,
              ),
            );
            return {
              configPath: slot.configPath,
              label: slot.label,
              expectsProvider: slot.expectsProvider,
              currentCredential: current ?? null,
              candidates,
            };
          }),
        });
      }
      return cards;
    },

    assign: async (
      companyId: string,
      input: AssignInput,
      actor: CredentialActor,
    ): Promise<IntegrationCredentialDto> => {
      // 1. Resolve credential + plugin records.
      const credentialRow = await credentialSvc.loadCredentialRow(input.credentialId);
      if (!credentialRow || credentialRow.companyId !== companyId) {
        throw notFound("Integration credential not found");
      }
      if (credentialRow.status !== "active") {
        throw conflict("Cannot assign a disabled or attention-flagged credential.");
      }
      if (!credentialRow.secretId) {
        throw unprocessable("Credential has no encrypted material to assign.");
      }
      const provider = INTEGRATION_PROVIDERS[credentialRow.provider];
      if (!provider) throw unprocessable(`Unknown provider: ${credentialRow.provider}`);

      const plugin = await db
        .select()
        .from(pluginsTable)
        .where(eq(pluginsTable.id, input.targetPluginId))
        .then((rows) => rows[0] ?? null);
      if (!plugin) throw notFound("Target plugin not installed");

      // 2. Validate the slot allowlist.
      validateSlot(plugin.pluginKey, input.targetConfigPath, credentialRow.provider);

      // 3. Inside one transaction:
      //    - Replace the previous assignment row for this slot (if any).
      //    - Persist the assignment record itself.
      // (We do the config patch outside the transaction because the
      // pluginRegistryService.patchConfig helper opens its own write,
      // and we want it to use the same shallow-merge semantics every
      // other plugin-config writer uses. The assignment row + config
      // patch are tightly coupled but not co-transactional; on failure
      // of the patch we roll back the assignment row.)
      await db.transaction(async (tx) => {
        await tx
          .delete(integrationCredentialAssignments)
          .where(
            and(
              eq(integrationCredentialAssignments.targetPluginId, plugin.id),
              eq(integrationCredentialAssignments.targetConfigPath, input.targetConfigPath),
            ),
          );
        await tx.insert(integrationCredentialAssignments).values({
          companyId,
          credentialId: input.credentialId,
          targetKind: "plugin_config",
          targetPluginId: plugin.id,
          targetConfigPath: input.targetConfigPath,
          assignedByUserId: actor.userId,
        });
      });

      // 4. Patch the plugin's config_json via the registry helper. This
      //    is a shallow merge: only the named slot key changes; every
      //    other field (`ttsMode`, `voiceConfigAgentTokenRef`,
      //    `googleTtsDefaultLanguageCode`, `maxTextChars`, plus any
      //    field a future operator added) is preserved verbatim.
      //
      //    For multi-field providers, also propagate any non-secret
      //    fields the slot declares as `pairedFields`. NoralVoice needs
      //    `baseUrl` + `organizationId` alongside `apiKeyRef`; without
      //    this, the plugin's instanceConfig schema validation fails
      //    on the missing fields and operators have to hand-edit JSON.
      const patchPayload: Record<string, unknown> = {
        [input.targetConfigPath]: credentialRow.secretId,
      };
      const slot = provider.assignableSlots.find(
        (s) => s.pluginKey === plugin.pluginKey && s.configPath === input.targetConfigPath,
      );
      if (slot?.pairedFields?.length) {
        const credentialFields = readCredentialFields(credentialRow);
        for (const paired of slot.pairedFields) {
          const raw = credentialFields[paired.sourceField];
          if (raw === undefined || raw === null || raw === "") continue;
          patchPayload[paired.targetConfigPath] = coerceFieldValue(raw, paired.coerce);
        }
      }
      let patched: { configJson: Record<string, unknown> } | null = null;
      try {
        patched = (await registry.patchConfig(plugin.id, {
          configJson: patchPayload,
        })) as { configJson: Record<string, unknown> } | null;
      } catch (err) {
        // Roll back the assignment row so the UI doesn't lie about
        // success.
        await db
          .delete(integrationCredentialAssignments)
          .where(
            and(
              eq(integrationCredentialAssignments.targetPluginId, plugin.id),
              eq(integrationCredentialAssignments.targetConfigPath, input.targetConfigPath),
            ),
          );
        throw err;
      }

      // 5. Notify the worker — best-effort. METHOD_NOT_IMPLEMENTED falls
      //    back to a restart; other failures are logged but don't fail
      //    the response since the config is already persisted.
      if (patched?.configJson) {
        await notifyConfigChanged(plugin.id, patched.configJson);
      }

      return (await credentialSvc.getById(companyId, input.credentialId))!;
    },

    unassign: async (
      companyId: string,
      assignmentId: string,
      actor: CredentialActor,
    ): Promise<{ credentialId: string }> => {
      const row = await db
        .select({
          assignment: integrationCredentialAssignments,
          plugin: pluginsTable,
        })
        .from(integrationCredentialAssignments)
        .leftJoin(pluginsTable, eq(integrationCredentialAssignments.targetPluginId, pluginsTable.id))
        .where(eq(integrationCredentialAssignments.id, assignmentId))
        .then((rows) => rows[0] ?? null);
      if (!row || row.assignment.companyId !== companyId) {
        throw notFound("Assignment not found");
      }
      if (!row.plugin) throw notFound("Target plugin not installed");

      // Drop the assignment row first.
      await db
        .delete(integrationCredentialAssignments)
        .where(eq(integrationCredentialAssignments.id, assignmentId));

      // Then drop the slot from plugin_config.config_json. We compute the
      // next state (everything except the target path) and overwrite via
      // upsertConfig — `patchConfig` would only do a shallow merge, which
      // can't remove keys.
      const existingConfig = await db
        .select()
        .from(pluginConfigTable)
        .where(eq(pluginConfigTable.pluginId, row.plugin!.id))
        .then((rows) => rows[0] ?? null);
      if (existingConfig) {
        const next = {
          ...((existingConfig.configJson as Record<string, unknown> | null) ?? {}),
        };
        delete next[row.assignment.targetConfigPath];
        await registry.upsertConfig(row.plugin!.id, { configJson: next });
        await notifyConfigChanged(row.plugin!.id, next);
      }

      void actor;
      return { credentialId: row.assignment.credentialId };
    },
  };
}
