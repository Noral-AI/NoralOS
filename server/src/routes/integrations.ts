import { Router, type Request } from "express";
import type { Db } from "@noralos/db";
import { integrationCredentialAssignments } from "@noralos/db";
import { eq } from "drizzle-orm";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";
import type { PluginLifecycleManager } from "../services/plugin-lifecycle.js";
import {
  ASSIGNMENT_TARGETS,
  INTEGRATION_PROVIDERS,
  assignIntegrationCredentialSchema,
  createIntegrationCredentialSchema,
  importIntegrationCredentialSchema,
  rotateIntegrationCredentialSchema,
  updateIntegrationCredentialSchema,
} from "@noralos/shared";
import { validate } from "../middleware/validate.js";
import {
  actorCanViewAllCompanyIssues,
  assertAuthenticated,
  assertBoard,
  assertCompanyAccess,
  getActorInfo,
} from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { integrationCredentialService } from "../services/integrations/credentials.js";
import { integrationAssignmentService } from "../services/integrations/assignments.js";
import { runProviderTest } from "../services/integrations/provider-tests.js";
import { forbidden } from "../errors.js";

/**
 * Routes powering Settings → Integrations.
 *
 * **All routes — read AND write — require company owner/admin** (or an
 * instance-admin). Operators, viewers, agents, and unauthenticated
 * callers are rejected at every endpoint. The integrations surface
 * exposes provider/credential metadata and writes plugin config that
 * controls which secret keys downstream voice/LLM/CRM workers will use,
 * so even read access is treated as security-sensitive. Reuses the
 * `actorCanViewAllCompanyIssues` semantic helper from PR #41 which
 * resolves to owner/admin/instance-admin/local-implicit.
 *
 * NEVER returns secret values. The `IntegrationCredentialDto` type is
 * the gate — the service layer is the only thing that ever holds
 * plaintext.
 */
function assertCompanyAdmin(req: Request, companyId: string) {
  if (!actorCanViewAllCompanyIssues(req, companyId)) {
    throw forbidden("Owner or admin access required to manage integrations");
  }
}

export interface IntegrationRoutesDeps {
  workerManager?: Pick<PluginWorkerManager, "isRunning" | "call">;
  lifecycle?: Pick<PluginLifecycleManager, "restartWorker">;
}

export function integrationRoutes(db: Db, deps: IntegrationRoutesDeps = {}) {
  const router = Router();
  const credentials = integrationCredentialService(db);
  const assignments = integrationAssignmentService(db, {
    workerManager: deps.workerManager,
    lifecycle: deps.lifecycle,
  });

  // ---------------------------------------------------------------------
  // Provider registry — UI consumes this to render Add Credential drawer.
  // No secrets, just static metadata.
  // ---------------------------------------------------------------------
  router.get("/companies/:companyId/integrations/provider-registry", (req, res) => {
    assertAuthenticated(req); assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertCompanyAdmin(req, companyId);
    res.json({
      providers: Object.values(INTEGRATION_PROVIDERS).map((p) => ({
        id: p.id,
        category: p.category,
        credentialType: p.credentialType,
        displayName: p.displayName,
        description: p.description ?? null,
        fields: p.fields,
        assignableSlots: p.assignableSlots,
      })),
      assignmentTargets: ASSIGNMENT_TARGETS,
    });
  });

  // ---------------------------------------------------------------------
  // Credentials
  // ---------------------------------------------------------------------
  router.get("/companies/:companyId/integrations/credentials", async (req, res) => {
    assertAuthenticated(req); assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertCompanyAdmin(req, companyId);
    const list = await credentials.list(companyId);
    res.json(list);
  });

  router.get("/companies/:companyId/integrations/unmanaged-secrets", async (req, res) => {
    assertAuthenticated(req); assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertCompanyAdmin(req, companyId);
    const list = await credentials.listUnmanaged(companyId);
    res.json(list);
  });

  router.post(
    "/companies/:companyId/integrations/credentials",
    validate(createIntegrationCredentialSchema),
    async (req, res) => {
      assertAuthenticated(req); assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertCompanyAdmin(req, companyId);

      const actorInfo = getActorInfo(req);
      const created = await credentials.create(
        companyId,
        {
          provider: req.body.provider,
          displayName: req.body.displayName,
          environment: req.body.environment,
          value: req.body.value,
          description: req.body.description ?? null,
          metadata: req.body.metadata ?? {},
        },
        {
          userId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
          agentId: actorInfo.agentId,
        },
      );

      // No secret values in details; only safe metadata.
      await logActivity(db, {
        companyId,
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        action: "integration.credential.created",
        entityType: "integration_credential",
        entityId: created.id,
        details: {
          provider: created.provider,
          environment: created.environment,
          maskedSuffix: created.maskedSuffix,
        },
      });
      res.status(201).json(created);
    },
  );

  router.post(
    "/companies/:companyId/integrations/credentials/import",
    validate(importIntegrationCredentialSchema),
    async (req, res) => {
      assertAuthenticated(req); assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertCompanyAdmin(req, companyId);

      const actorInfo = getActorInfo(req);
      const imported = await credentials.importExistingSecret(
        companyId,
        {
          secretId: req.body.secretId,
          provider: req.body.provider,
          displayName: req.body.displayName,
          environment: req.body.environment,
          category: req.body.category,
          credentialType: req.body.credentialType,
          description: req.body.description,
        },
        {
          userId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
          agentId: actorInfo.agentId,
        },
      );
      await logActivity(db, {
        companyId,
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        action: "integration.credential.imported",
        entityType: "integration_credential",
        entityId: imported.id,
        details: {
          provider: imported.provider,
          environment: imported.environment,
          maskedSuffix: imported.maskedSuffix,
        },
      });
      res.status(201).json(imported);
    },
  );

  router.patch(
    "/integrations/credentials/:id",
    validate(updateIntegrationCredentialSchema),
    async (req, res) => {
      assertAuthenticated(req); assertBoard(req);
      const id = req.params.id as string;
      const existing = await credentials.loadCredentialRow(id);
      if (!existing) {
        res.status(404).json({ error: "Integration credential not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      assertCompanyAdmin(req, existing.companyId);
      const actorInfo = getActorInfo(req);
      const updated = await credentials.updateMetadata(
        existing.companyId,
        id,
        {
          displayName: req.body.displayName,
          description: req.body.description,
          environment: req.body.environment,
          status: req.body.status,
          rotationNotes: req.body.rotationNotes,
          metadata: req.body.metadata,
        },
        {
          userId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
          agentId: actorInfo.agentId,
        },
      );
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        action: "integration.credential.updated",
        entityType: "integration_credential",
        entityId: id,
        details: {
          // Only safe metadata fields land in the audit log.
          changedKeys: Object.keys(req.body ?? {}),
        },
      });
      res.json(updated);
    },
  );

  router.post(
    "/integrations/credentials/:id/rotate",
    validate(rotateIntegrationCredentialSchema),
    async (req, res) => {
      assertAuthenticated(req); assertBoard(req);
      const id = req.params.id as string;
      const existing = await credentials.loadCredentialRow(id);
      if (!existing) {
        res.status(404).json({ error: "Integration credential not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      assertCompanyAdmin(req, existing.companyId);
      const actorInfo = getActorInfo(req);
      const rotated = await credentials.rotate(
        existing.companyId,
        id,
        { value: req.body.value, rotationNotes: req.body.rotationNotes ?? null },
        {
          userId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
          agentId: actorInfo.agentId,
        },
      );
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        action: "integration.credential.rotated",
        entityType: "integration_credential",
        entityId: id,
        details: { maskedSuffix: rotated.maskedSuffix },
      });
      res.json(rotated);
    },
  );

  router.post("/integrations/credentials/:id/test", async (req, res) => {
    assertAuthenticated(req); assertBoard(req);
    const id = req.params.id as string;
    const existing = await credentials.loadCredentialRow(id);
    if (!existing) {
      res.status(404).json({ error: "Integration credential not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    assertCompanyAdmin(req, existing.companyId);

    // Resolve plaintext server-side, run the provider test, then immediately
    // discard the value. The plaintext is never assigned to a logger-visible
    // variable and never round-tripped.
    const provider = INTEGRATION_PROVIDERS[existing.provider];
    if (!provider) {
      res.status(422).json({
        ok: false,
        statusCode: 0,
        safeMessage: `Unknown provider: ${existing.provider}`,
      });
      return;
    }

    let result: { ok: boolean; statusCode: number; safeMessage: string };
    try {
      const value = await credentials.resolvePlaintext(existing.companyId, id);
      const fields: Record<string, string> = { apiKey: value };
      result = await runProviderTest(existing.provider, fields);
    } catch (err) {
      result = {
        ok: false,
        statusCode: 0,
        safeMessage:
          err instanceof Error
            ? `${provider.test.safeErrorPrefix}: ${err.message}`
            : `${provider.test.safeErrorPrefix}: unknown error.`,
      };
    }

    await credentials.recordTestResult(id, result);
    const actorInfo = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      action: result.ok ? "integration.credential.test_ok" : "integration.credential.test_failed",
      entityType: "integration_credential",
      entityId: id,
      details: { statusCode: result.statusCode },
    });
    res.json(result);
  });

  router.post("/integrations/credentials/:id/disable", async (req, res) => {
    assertAuthenticated(req); assertBoard(req);
    const id = req.params.id as string;
    const existing = await credentials.loadCredentialRow(id);
    if (!existing) {
      res.status(404).json({ error: "Integration credential not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    assertCompanyAdmin(req, existing.companyId);
    const actorInfo = getActorInfo(req);
    const disabled = await credentials.disable(existing.companyId, id, {
      userId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
      agentId: actorInfo.agentId,
    });
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      action: "integration.credential.disabled",
      entityType: "integration_credential",
      entityId: id,
    });
    res.json(disabled);
  });

  router.delete("/integrations/credentials/:id", async (req, res) => {
    assertAuthenticated(req); assertBoard(req);
    const id = req.params.id as string;
    const existing = await credentials.loadCredentialRow(id);
    if (!existing) {
      res.status(404).json({ error: "Integration credential not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    assertCompanyAdmin(req, existing.companyId);
    await credentials.remove(existing.companyId, id);
    const actorInfo = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      action: "integration.credential.deleted",
      entityType: "integration_credential",
      entityId: id,
    });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------
  // Assignments — friendly per-plugin cards + assign/unassign
  // ---------------------------------------------------------------------
  router.get("/companies/:companyId/integrations/assignments", async (req, res) => {
    assertAuthenticated(req); assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertCompanyAdmin(req, companyId);
    const board = await assignments.listAssignmentBoard(companyId);
    res.json({ board });
  });

  router.post(
    "/integrations/credentials/:id/assignments",
    validate(assignIntegrationCredentialSchema),
    async (req, res) => {
      assertAuthenticated(req); assertBoard(req);
      const id = req.params.id as string;
      const existing = await credentials.loadCredentialRow(id);
      if (!existing) {
        res.status(404).json({ error: "Integration credential not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      assertCompanyAdmin(req, existing.companyId);
      const actorInfo = getActorInfo(req);
      const dto = await assignments.assign(
        existing.companyId,
        {
          credentialId: id,
          targetPluginId: req.body.targetPluginId,
          targetConfigPath: req.body.targetConfigPath,
        },
        {
          userId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
          agentId: actorInfo.agentId,
        },
      );
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        action: "integration.credential.assigned",
        entityType: "integration_credential",
        entityId: id,
        details: {
          targetPluginId: req.body.targetPluginId,
          targetConfigPath: req.body.targetConfigPath,
        },
      });
      res.json(dto);
    },
  );

  router.delete("/integrations/assignments/:assignmentId", async (req, res) => {
    assertAuthenticated(req); assertBoard(req);
    const assignmentId = req.params.assignmentId as string;
    const row = await db
      .select()
      .from(integrationCredentialAssignments)
      .where(eq(integrationCredentialAssignments.id, assignmentId))
      .then((rows) => rows[0] ?? null);
    if (!row) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }
    assertCompanyAccess(req, row.companyId);
    assertCompanyAdmin(req, row.companyId);
    const actorInfo = getActorInfo(req);
    const result = await assignments.unassign(row.companyId, assignmentId, {
      userId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
      agentId: actorInfo.agentId,
    });
    await logActivity(db, {
      companyId: row.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      action: "integration.credential.unassigned",
      entityType: "integration_credential",
      entityId: result.credentialId,
      details: { assignmentId },
    });
    res.json({ ok: true });
  });

  return router;
}
