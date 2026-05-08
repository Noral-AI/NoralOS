/**
 * Settings → Integrations admin API.
 *
 * Credentials and their assignments are *company-scoped*: the underlying
 * `company_secrets` rows belong to a company, the metadata wrapper is
 * keyed by `company_id`, and the UI lives under `/<companyPrefix>/company/
 * settings/integrations`. The `voice-cascade` plugin config it writes to
 * is currently a single instance-wide row — that nuance is surfaced
 * directly to operators in the Voice Cascade assignment card copy.
 *
 * Authorization (per Phase 1 decision):
 *   - owner ✅
 *   - admin ✅
 *   - operator ❌
 *   - viewer ❌
 *   - member ❌
 *   - agent ❌
 *   - unauthenticated ❌
 * Enforced by `assertCompanyAdminAccess(req, companyId)` on every route.
 *
 * The router is mounted alongside the other per-company route families in
 * `server/src/app.ts`. Endpoints follow the existing `/companies/:companyId/...`
 * convention used by `routes/secrets.ts`.
 */
import { Router } from "express";
import { z } from "zod";
import type { Db } from "@noralos/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAdminAccess } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { secretService } from "../services/secrets.js";
import { integrationCredentialsService } from "../services/integrations/credentials-service.js";
import { integrationAssignmentsService } from "../services/integrations/assignments-service.js";
import { voiceCascadeStatusService } from "../services/integrations/voice-cascade-status.js";
import {
  getProvider,
  providerRegistry,
  type ProviderId,
} from "../services/integrations/provider-registry.js";
import { unprocessable } from "../errors.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";
import type { PluginLifecycleManager } from "../services/plugin-lifecycle.js";
import { logger } from "../middleware/logger.js";

const ENVIRONMENT_VALUES = ["production", "test", "development"] as const;
const STATUS_VALUES = ["active", "disabled", "needs_attention"] as const;
const CATEGORY_VALUES = [
  "voice",
  "llm",
  "telephony",
  "crm",
  "email_calendar",
  "webhook",
  "other",
] as const;
const CREDENTIAL_TYPE_VALUES = [
  "api_key",
  "bearer_token",
  "webhook_signing_secret",
  "hmac_secret",
  "shared_secret",
  "oauth_client_secret",
  "oauth_refresh_token",
  "connection_url",
  "custom_json_secret",
] as const;

const createCredentialSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  environment: z.enum(ENVIRONMENT_VALUES).optional(),
  value: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const importSecretSchema = z.object({
  secretId: z.string().uuid(),
  provider: z.string().min(1),
  category: z.enum(CATEGORY_VALUES),
  credentialType: z.enum(CREDENTIAL_TYPE_VALUES),
  displayName: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  environment: z.enum(ENVIRONMENT_VALUES).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateCredentialSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  environment: z.enum(ENVIRONMENT_VALUES).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const rotateCredentialSchema = z.object({
  value: z.string().min(1),
});

const assignCredentialSchema = z.object({
  pluginKey: z.string().min(1),
  targetField: z.string().min(1),
});

interface RateLimiterEntry {
  attempts: number[];
}

function createRateLimiter(maxAttempts: number, windowMs: number) {
  const map = new Map<string, RateLimiterEntry>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const cutoff = now - windowMs;
      const entry = map.get(key) ?? { attempts: [] };
      entry.attempts = entry.attempts.filter((ts) => ts > cutoff);
      if (entry.attempts.length >= maxAttempts) {
        map.set(key, entry);
        return false;
      }
      entry.attempts.push(now);
      map.set(key, entry);
      return true;
    },
  };
}

export interface IntegrationsRoutesDeps {
  workerManager?: PluginWorkerManager;
  lifecycle?: PluginLifecycleManager;
}

export function integrationsRoutes(db: Db, deps: IntegrationsRoutesDeps = {}) {
  const router = Router();
  const credentials = integrationCredentialsService(db);
  const assignments = integrationAssignmentsService(db, {
    workerManager: deps.workerManager,
    lifecycle: deps.lifecycle,
  });
  const secrets = secretService(db);
  const voiceCascadeStatus = voiceCascadeStatusService(db);
  // Max 1 test per credential every 10s — keep enthusiastic admins from
  // hammering provider rate limits.
  const testRateLimiter = createRateLimiter(1, 10_000);

  function publicProviderRegistry() {
    return providerRegistry.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      category: p.category,
      credentialType: p.credentialType,
      enabled: p.enabled,
      assignmentTargets: p.assignmentTargets,
      docsUrl: p.docsUrl,
      description: p.description,
    }));
  }

  // -------------------------------------------------------------------------
  // Provider registry + health
  // -------------------------------------------------------------------------

  router.get(
    "/companies/:companyId/integrations/provider-registry",
    (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      res.json(publicProviderRegistry());
    },
  );

  router.get(
    "/companies/:companyId/integrations/voice-cascade-status",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const status = await voiceCascadeStatus.get();
      res.json(status);
    },
  );

  router.get("/companies/:companyId/integrations/health", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAdminAccess(req, companyId);
    const list = await credentials.list(companyId);
    const byProvider: Record<
      string,
      { provider: string; status: "ok" | "fail" | "untested"; lastTestedAt: string | null }
    > = {};
    for (const cred of list) {
      const cur = byProvider[cred.provider];
      if (!cur || (cred.lastTestedAt && (!cur.lastTestedAt || cred.lastTestedAt > cur.lastTestedAt))) {
        byProvider[cred.provider] = {
          provider: cred.provider,
          status: cred.lastTestStatus === "ok"
            ? "ok"
            : cred.lastTestStatus === "fail"
              ? "fail"
              : "untested",
          lastTestedAt: cred.lastTestedAt,
        };
      }
    }
    res.json({ providers: Object.values(byProvider) });
  });

  // -------------------------------------------------------------------------
  // Credentials CRUD
  // -------------------------------------------------------------------------

  router.get(
    "/companies/:companyId/integrations/credentials",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const list = await credentials.list(companyId);
      res.json(list);
    },
  );

  router.get(
    "/companies/:companyId/integrations/unmanaged-secrets",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const list = await credentials.listUnmanagedSecrets(companyId);
      res.json(list);
    },
  );

  router.get(
    "/companies/:companyId/integrations/credentials/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const id = req.params.id as string;
      const credential = await credentials.getById(companyId, id);
      if (!credential) {
        res.status(404).json({ error: "Credential not found" });
        return;
      }
      const credAssignments = await assignments.listForCredential(companyId, id);
      res.json({ credential, assignments: credAssignments });
    },
  );

  router.post(
    "/companies/:companyId/integrations/credentials",
    validate(createCredentialSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const provider = getProvider(req.body.provider as string);
      if (!provider) throw unprocessable("Unknown provider");
      if (!provider.enabled) throw unprocessable("Provider is not enabled");
      const created = await credentials.create(
        companyId,
        {
          provider: provider.id as ProviderId,
          displayName: req.body.displayName,
          description: req.body.description ?? null,
          environment: req.body.environment,
          value: req.body.value,
          metadata: req.body.metadata,
        },
        { userId: req.actor.userId ?? "board" },
      );
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.credential.created",
        entityType: "integration_credential",
        entityId: created.id,
        details: {
          provider: created.provider,
          displayName: created.displayName,
          environment: created.environment,
          maskedSuffix: created.maskedSuffix,
        },
      });
      res.status(201).json(created);
    },
  );

  router.post(
    "/companies/:companyId/integrations/credentials/import",
    validate(importSecretSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const created = await credentials.importExistingSecret(
        companyId,
        {
          secretId: req.body.secretId,
          provider: req.body.provider as ProviderId,
          category: req.body.category,
          credentialType: req.body.credentialType,
          displayName: req.body.displayName,
          description: req.body.description ?? null,
          environment: req.body.environment,
          metadata: req.body.metadata,
        },
        { userId: req.actor.userId ?? "board" },
      );
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.credential.imported",
        entityType: "integration_credential",
        entityId: created.id,
        details: {
          provider: created.provider,
          displayName: created.displayName,
          secretId: created.secretId,
        },
      });
      res.status(201).json(created);
    },
  );

  router.patch(
    "/companies/:companyId/integrations/credentials/:id",
    validate(updateCredentialSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const id = req.params.id as string;
      const updated = await credentials.updateMetadata(
        companyId,
        id,
        {
          displayName: req.body.displayName,
          description: req.body.description,
          environment: req.body.environment,
          status: req.body.status,
          metadata: req.body.metadata,
        },
        { userId: req.actor.userId ?? "board" },
      );
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: req.body.status === "disabled"
          ? "integration.credential.disabled"
          : "integration.credential.updated",
        entityType: "integration_credential",
        entityId: updated.id,
        details: {
          provider: updated.provider,
          displayName: updated.displayName,
          status: updated.status,
          environment: updated.environment,
        },
      });
      res.json(updated);
    },
  );

  router.post(
    "/companies/:companyId/integrations/credentials/:id/rotate",
    validate(rotateCredentialSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const id = req.params.id as string;
      const updated = await credentials.rotate(
        companyId,
        id,
        req.body.value,
        { userId: req.actor.userId ?? "board" },
      );
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.credential.rotated",
        entityType: "integration_credential",
        entityId: updated.id,
        details: {
          provider: updated.provider,
          maskedSuffix: updated.maskedSuffix,
        },
      });
      res.json(updated);
    },
  );

  router.delete(
    "/companies/:companyId/integrations/credentials/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const id = req.params.id as string;
      const existing = await credentials.getById(companyId, id);
      if (!existing) {
        res.status(404).json({ error: "Credential not found" });
        return;
      }
      await credentials.remove(companyId, id);
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.credential.deleted",
        entityType: "integration_credential",
        entityId: id,
        details: {
          provider: existing.provider,
          displayName: existing.displayName,
        },
      });
      res.json({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // Provider test
  // -------------------------------------------------------------------------

  router.post(
    "/companies/:companyId/integrations/credentials/:id/test",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const id = req.params.id as string;

      const credential = await credentials.getById(companyId, id);
      if (!credential) {
        res.status(404).json({ error: "Credential not found" });
        return;
      }

      const provider = getProvider(credential.provider);
      if (!provider || !provider.enabled || !provider.test) {
        res.status(422).json({ error: "Provider does not support testing" });
        return;
      }

      if (!testRateLimiter.check(`${companyId}:${id}`)) {
        res.status(429).json({ error: "Test rate limit exceeded. Try again shortly." });
        return;
      }

      // Plaintext is held in this single function-local variable and passed
      // directly to the provider call. It never reaches a logger or any
      // persistence boundary.
      let plaintext: string;
      try {
        plaintext = await secrets.resolveSecretValue(
          companyId,
          credential.secretId,
          "latest",
        );
      } catch (err) {
        logger.warn({ credentialId: id, err }, "integrations: failed to resolve secret for test");
        res.status(500).json({ error: "Could not resolve secret for testing" });
        return;
      }

      let result;
      try {
        result = await provider.test({ secretValue: plaintext, metadata: credential.metadata });
      } catch (err) {
        // Provider call threw — never include the underlying message.
        logger.warn({ credentialId: id, err }, "integrations: provider test threw");
        result = { status: "fail", error: "unknown", message: "Provider test failed unexpectedly" } as const;
      }

      await credentials.recordTestResult(id, result);
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.credential.tested",
        entityType: "integration_credential",
        entityId: id,
        details: {
          provider: credential.provider,
          status: result.status,
          ...(result.status === "fail" ? { error: result.error } : {}),
        },
      });

      res.json(result);
    },
  );

  // -------------------------------------------------------------------------
  // Assignment
  // -------------------------------------------------------------------------

  router.get(
    "/companies/:companyId/integrations/assignments",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const list = await assignments.listForCompany(companyId);
      res.json(list);
    },
  );

  router.post(
    "/companies/:companyId/integrations/credentials/:id/assign",
    validate(assignCredentialSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const id = req.params.id as string;
      const result = await assignments.assign(
        companyId,
        id,
        { pluginKey: req.body.pluginKey, targetField: req.body.targetField },
        { userId: req.actor.userId ?? "board" },
      );
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.credential.assigned",
        entityType: "integration_credential",
        entityId: id,
        details: {
          pluginKey: result.assignment.targetPluginKey,
          field: result.assignment.targetField,
        },
      });
      res.status(201).json(result.assignment);
    },
  );

  router.delete(
    "/companies/:companyId/integrations/credentials/:id/assignments/:assignmentId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAdminAccess(req, companyId);
      const id = req.params.id as string;
      const assignmentId = req.params.assignmentId as string;
      const result = await assignments.unassign(companyId, id, assignmentId);
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.credential.unassigned",
        entityType: "integration_credential",
        entityId: id,
        details: {
          pluginKey: result.pluginKey,
          field: result.removedField,
        },
      });
      res.json({ ok: true });
    },
  );

  return router;
}
