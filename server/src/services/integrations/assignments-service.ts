/**
 * Settings → Integrations assignment service.
 *
 * Writes credential assignments to `plugin_config.config_json`. The runtime
 * config load path (`plugin-loader.ts:1726-1735` and
 * `plugin-host-services.ts:764`) reads exclusively from `plugin_config`, so
 * that's the only target Phase 1 needs to support. The
 * `plugin_company_settings` table exists in the schema but has no runtime
 * readers; ignoring it here is intentional and matches the spike findings.
 *
 * Concurrency is protected by a per-plugin row lock (`SELECT … FOR UPDATE`)
 * inside a single transaction so two simultaneous assignments cannot
 * clobber each other through the read-merge-write cycle.
 *
 * After the transaction commits, the worker is notified via the same
 * `configChanged → restartWorker` fallback that the existing
 * `POST /api/plugins/:pluginId/config` route uses
 * (`server/src/routes/plugins.ts:1950-1972`). Failures of the notify path
 * are non-fatal — the new config is already persisted and will take effect
 * on the next worker boot.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@noralos/db";
import {
  integrationCredentialAssignments,
  integrationCredentials,
  pluginConfig,
  plugins,
} from "@noralos/db";
import { JsonRpcCallError, PLUGIN_RPC_ERROR_CODES } from "@noralos/plugin-sdk";
import { badRequest, conflict, notFound, unprocessable } from "../../errors.js";
import type { PluginWorkerManager } from "../plugin-worker-manager.js";
import type { PluginLifecycleManager } from "../plugin-lifecycle.js";
import { validateInstanceConfig } from "../plugin-config-validator.js";
import { logger } from "../../middleware/logger.js";
import {
  getProvider,
  isAssignmentTargetAllowed,
} from "./provider-registry.js";

export interface AssignmentDto {
  id: string;
  companyId: string;
  credentialId: string;
  targetKind: string;
  targetPluginId: string;
  targetPluginKey: string;
  targetField: string;
  assignedAt: string;
}

export interface AssignInput {
  pluginKey: string;
  targetField: string;
}

export interface AssignmentsServiceOptions {
  workerManager?: PluginWorkerManager;
  lifecycle?: PluginLifecycleManager;
}

function rowToDto(
  row: typeof integrationCredentialAssignments.$inferSelect,
  pluginKey: string,
): AssignmentDto {
  return {
    id: row.id,
    companyId: row.companyId,
    credentialId: row.credentialId,
    targetKind: row.targetKind,
    targetPluginId: row.targetPluginId,
    targetPluginKey: pluginKey,
    targetField: row.targetField,
    assignedAt: row.assignedAt.toISOString(),
  };
}

export function integrationAssignmentsService(
  db: Db,
  options: AssignmentsServiceOptions = {},
) {
  async function listForCompany(companyId: string): Promise<AssignmentDto[]> {
    const rows = await db
      .select({
        assignment: integrationCredentialAssignments,
        pluginKey: plugins.pluginKey,
      })
      .from(integrationCredentialAssignments)
      .innerJoin(
        plugins,
        eq(plugins.id, integrationCredentialAssignments.targetPluginId),
      )
      .where(eq(integrationCredentialAssignments.companyId, companyId));
    return rows.map((r) => rowToDto(r.assignment, r.pluginKey));
  }

  async function listForCredential(
    companyId: string,
    credentialId: string,
  ): Promise<AssignmentDto[]> {
    const rows = await db
      .select({
        assignment: integrationCredentialAssignments,
        pluginKey: plugins.pluginKey,
      })
      .from(integrationCredentialAssignments)
      .innerJoin(
        plugins,
        eq(plugins.id, integrationCredentialAssignments.targetPluginId),
      )
      .where(
        and(
          eq(integrationCredentialAssignments.companyId, companyId),
          eq(integrationCredentialAssignments.credentialId, credentialId),
        ),
      );
    return rows.map((r) => rowToDto(r.assignment, r.pluginKey));
  }

  async function notifyWorker(
    pluginId: string,
    mergedConfig: Record<string, unknown>,
  ): Promise<void> {
    const wm = options.workerManager;
    const lc = options.lifecycle;
    if (!wm) return;
    if (!wm.isRunning(pluginId)) return;
    try {
      await wm.call(pluginId, "configChanged", { config: mergedConfig });
    } catch (err) {
      if (
        err instanceof JsonRpcCallError &&
        err.code === PLUGIN_RPC_ERROR_CODES.METHOD_NOT_IMPLEMENTED
      ) {
        if (!lc) return;
        try {
          await lc.restartWorker(pluginId);
        } catch (restartErr) {
          logger.warn(
            { pluginId, err: restartErr },
            "integrations: worker restart after assignment failed",
          );
        }
        return;
      }
      logger.warn(
        { pluginId, err },
        "integrations: configChanged RPC failed; new config will take effect on next worker boot",
      );
    }
  }

  /**
   * Assign a credential to a plugin instance config field.
   *
   * Within a single transaction: validates inputs, takes a row lock on the
   * `plugin_config` row, shallow-merges the target field, validates the
   * merged config against the plugin's instanceConfigSchema, persists the
   * merged config, and upserts the assignment row.
   *
   * After commit, notifies the worker via the standard configChanged →
   * restartWorker fallback. Notification failures are non-fatal.
   *
   * @returns the resulting assignment plus the merged config (so the caller
   *          can inspect the diff in tests).
   */
  async function assign(
    companyId: string,
    credentialId: string,
    input: AssignInput,
    actor: { userId: string },
  ): Promise<{ assignment: AssignmentDto; mergedConfig: Record<string, unknown> }> {
    if (!input.pluginKey || !input.targetField) {
      throw badRequest("pluginKey and targetField are required");
    }

    const credential = await db
      .select()
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.id, credentialId),
          eq(integrationCredentials.companyId, companyId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!credential) throw notFound("Credential not found");

    if (credential.status === "disabled") {
      throw unprocessable("Cannot assign a disabled credential");
    }

    if (
      !isAssignmentTargetAllowed(credential.provider, input.pluginKey, input.targetField)
    ) {
      throw badRequest(
        `Provider ${credential.provider} cannot be assigned to ${input.pluginKey}.${input.targetField}`,
      );
    }

    const plugin = await db
      .select()
      .from(plugins)
      .where(eq(plugins.pluginKey, input.pluginKey))
      .then((rows) => rows[0] ?? null);
    if (!plugin) throw notFound(`Plugin not installed: ${input.pluginKey}`);

    const provider = getProvider(credential.provider);
    if (!provider || !provider.enabled) {
      throw unprocessable("Provider is not enabled");
    }

    const instanceConfigSchema = (
      plugin.manifestJson as { instanceConfigSchema?: Record<string, unknown> } | null
    )?.instanceConfigSchema;

    const result = await db.transaction(async (tx) => {
      // Lock the existing plugin_config row (if any) to serialize concurrent
      // assignments. If no row exists yet, the subsequent insert will be
      // protected by the unique constraint on plugin_id.
      const lockedRows = (await tx.execute(
        sql`SELECT id, plugin_id, config_json FROM plugin_config WHERE plugin_id = ${plugin.id} FOR UPDATE`,
      )) as unknown as Array<{
        id: string;
        plugin_id: string;
        config_json: Record<string, unknown> | null;
      }>;
      const existing = lockedRows[0] ?? null;

      const currentConfig: Record<string, unknown> =
        (existing?.config_json as Record<string, unknown> | null) ?? {};
      const mergedConfig: Record<string, unknown> = {
        ...currentConfig,
        [input.targetField]: credential.secretId,
      };

      if (instanceConfigSchema && Object.keys(instanceConfigSchema).length > 0) {
        const validation = validateInstanceConfig(mergedConfig, instanceConfigSchema);
        if (!validation.valid) {
          throw unprocessable(
            "Resulting plugin config does not match the plugin's instanceConfigSchema",
            validation.errors,
          );
        }
      }

      if (existing) {
        await tx
          .update(pluginConfig)
          .set({ configJson: mergedConfig, updatedAt: new Date(), lastError: null })
          .where(eq(pluginConfig.pluginId, plugin.id));
      } else {
        await tx.insert(pluginConfig).values({
          pluginId: plugin.id,
          configJson: mergedConfig,
        });
      }

      // Upsert the assignment row. The unique index on
      // (companyId, targetPluginId, targetField) enforces single-credential-
      // per-target-field; conflicting rows are replaced.
      const inserted = await tx
        .insert(integrationCredentialAssignments)
        .values({
          companyId,
          credentialId,
          targetKind: "plugin_config",
          targetPluginId: plugin.id,
          targetField: input.targetField,
          assignedByUserId: actor.userId,
        })
        .onConflictDoUpdate({
          target: [
            integrationCredentialAssignments.companyId,
            integrationCredentialAssignments.targetPluginId,
            integrationCredentialAssignments.targetField,
          ],
          set: {
            credentialId,
            assignedByUserId: actor.userId,
            assignedAt: new Date(),
          },
        })
        .returning()
        .then((rows) => rows[0]);

      return { assignmentRow: inserted, mergedConfig };
    });

    // Worker notify happens AFTER commit so a notify failure doesn't roll
    // back the persisted assignment.
    await notifyWorker(plugin.id, result.mergedConfig);

    return {
      assignment: rowToDto(result.assignmentRow, plugin.pluginKey),
      mergedConfig: result.mergedConfig,
    };
  }

  /**
   * Remove an assignment. Clears the corresponding field in the plugin
   * config (via shallow-delete in a transaction with a row lock), deletes
   * the assignment row, and notifies the worker.
   */
  async function unassign(
    companyId: string,
    credentialId: string,
    assignmentId: string,
  ): Promise<{ removedField: string; pluginKey: string; mergedConfig: Record<string, unknown> }> {
    const assignment = await db
      .select({
        assignment: integrationCredentialAssignments,
        pluginKey: plugins.pluginKey,
      })
      .from(integrationCredentialAssignments)
      .innerJoin(plugins, eq(plugins.id, integrationCredentialAssignments.targetPluginId))
      .where(
        and(
          eq(integrationCredentialAssignments.id, assignmentId),
          eq(integrationCredentialAssignments.companyId, companyId),
          eq(integrationCredentialAssignments.credentialId, credentialId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!assignment) throw notFound("Assignment not found");

    const targetPluginId = assignment.assignment.targetPluginId;
    const targetField = assignment.assignment.targetField;

    const result = await db.transaction(async (tx) => {
      const lockedRows = (await tx.execute(
        sql`SELECT id, plugin_id, config_json FROM plugin_config WHERE plugin_id = ${targetPluginId} FOR UPDATE`,
      )) as unknown as Array<{
        config_json: Record<string, unknown> | null;
      }>;
      const existing = lockedRows[0] ?? null;

      const currentConfig: Record<string, unknown> =
        (existing?.config_json as Record<string, unknown> | null) ?? {};
      // Strip the field from the config rather than setting it to "" — that
      // way required fields fail validation cleanly and the JSON stays clean.
      const mergedConfig: Record<string, unknown> = { ...currentConfig };
      delete mergedConfig[targetField];

      if (existing) {
        await tx
          .update(pluginConfig)
          .set({ configJson: mergedConfig, updatedAt: new Date() })
          .where(eq(pluginConfig.pluginId, targetPluginId));
      }

      await tx
        .delete(integrationCredentialAssignments)
        .where(eq(integrationCredentialAssignments.id, assignmentId));

      return { mergedConfig };
    });

    await notifyWorker(targetPluginId, result.mergedConfig);

    return {
      removedField: targetField,
      pluginKey: assignment.pluginKey,
      mergedConfig: result.mergedConfig,
    };
  }

  return {
    listForCompany,
    listForCredential,
    assign,
    unassign,
  };
}
