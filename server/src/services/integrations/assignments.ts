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
//      the same (plugin, configPath) and patches the plugin's config_json
//      via shallow merge — so unrelated fields (`voiceConfigAgentTokenRef`,
//      `ttsMode`, `googleTtsDefaultLanguageCode`, `maxTextChars`, …) are
//      preserved verbatim.
//
// Crucially, this code path NEVER sets `ttsMode: live`. The caller that
// preserves ttsMode is the `mergedConfig` helper below, which only writes
// the new ref field and leaves everything else untouched.

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
import { conflict, notFound, unprocessable } from "../../errors.js";
import { integrationCredentialService, type CredentialActor } from "./credentials.js";

export interface AssignInput {
  credentialId: string;
  targetPluginId: string;
  targetConfigPath: string;
}

export function integrationAssignmentService(db: Db) {
  const credentialSvc = integrationCredentialService(db);

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
      //    - Read the plugin's current config_json, shallow-merge in the
      //      new ref pointing at the underlying secret_id, and write back.
      //      This explicitly preserves all other config keys (ttsMode,
      //      voiceConfigAgentTokenRef, googleTtsDefaultLanguageCode, etc).
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

        const existingConfig = await tx
          .select()
          .from(pluginConfigTable)
          .where(eq(pluginConfigTable.pluginId, plugin.id))
          .then((rows) => rows[0] ?? null);
        const merged = {
          ...((existingConfig?.configJson as Record<string, unknown> | null) ?? {}),
          [input.targetConfigPath]: credentialRow.secretId,
        };
        if (existingConfig) {
          await tx
            .update(pluginConfigTable)
            .set({
              configJson: merged,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(eq(pluginConfigTable.pluginId, plugin.id));
        } else {
          await tx.insert(pluginConfigTable).values({
            pluginId: plugin.id,
            configJson: merged,
          });
        }
      });

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

      await db.transaction(async (tx) => {
        await tx
          .delete(integrationCredentialAssignments)
          .where(eq(integrationCredentialAssignments.id, assignmentId));
        const existingConfig = await tx
          .select()
          .from(pluginConfigTable)
          .where(eq(pluginConfigTable.pluginId, row.plugin!.id))
          .then((rows) => rows[0] ?? null);
        if (existingConfig) {
          const next = { ...((existingConfig.configJson as Record<string, unknown> | null) ?? {}) };
          delete next[row.assignment.targetConfigPath];
          await tx
            .update(pluginConfigTable)
            .set({ configJson: next, updatedAt: new Date() })
            .where(eq(pluginConfigTable.pluginId, row.plugin!.id));
        }
      });

      void actor;
      return { credentialId: row.assignment.credentialId };
    },
  };
}
