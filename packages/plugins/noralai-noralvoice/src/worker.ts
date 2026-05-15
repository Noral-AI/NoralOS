/**
 * NoralVoice plugin worker entrypoint.
 *
 * Wires up the Phase 1B agent surface:
 *
 *   - Tool registration (`list_workflows`, `run_call`, `get_run`) with a
 *     tier gate at the dispatch boundary.
 *   - `onWebhook` for NoralVoice's `run.completed`: HMAC-SHA256
 *     verification against the per-company secret captured at lifecycle
 *     setup, then `ctx.events.emit("noralai.noralvoice.run.completed",
 *     payload)`.
 *   - `onConfigChanged` lifecycle hook that registers the receiver with
 *     NoralVoice (`POST /api/v1/integration-webhooks`) on first save and
 *     deletes any previous registration on rotation/uninstall.
 *   - `onApiRequest` for the `list_workflows` board route (used by the
 *     plugin page UI) and the `create_voice_director` provisioner.
 *
 * Boundaries:
 *   - `apiKeyRef` is resolved via `ctx.secrets.resolve()` on every
 *     tool call. Never cached in module state.
 *   - The per-company webhook secret IS stored in plugin state
 *     (`ctx.state` scope=company, key=webhook-registration). We accept
 *     this trade-off because we need to verify HMAC signatures without
 *     re-roundtripping to NoralVoice on every webhook.
 *   - Logging: never log resolved API keys or webhook secrets. Phone
 *     numbers are logged in E.164 form on `run_call` so misuse leaves
 *     a clear audit trail.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { definePlugin, runWorker } from "@noralos/plugin-sdk";
import type { PluginContext, ToolRunContext, ToolResult } from "@noralos/plugin-sdk";

import {
  GET_RUN_TOOL_NAME,
  LIST_WORKFLOWS_TOOL_NAME,
  PLUGIN_ID,
  ROLE_TO_TIER,
  RUN_CALL_TOOL_NAME,
  RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY,
  STATE_KEY_WEBHOOK_REGISTRATION,
  STATE_NAMESPACE,
  TIER_RANK,
  TOOL_MIN_TIER,
  type AgentTier,
} from "./constants.js";
import { manifest } from "./manifest.js";
import {
  NoralVoiceClientError,
  deleteIntegrationWebhook,
  registerIntegrationWebhook,
  type NoralVoiceClientConfig,
} from "./noralvoice-client.js";
import { executeGetRun } from "./tools/get_run.js";
import { executeListWorkflows } from "./tools/list_workflows.js";
import { executeRunCall } from "./tools/run_call.js";
import {
  VOICE_DIRECTOR_DEFAULT_ROLE,
  VOICE_DIRECTOR_DEFAULT_SYSTEM_PROMPT,
  VOICE_DIRECTOR_DEFAULT_TITLE,
  VOICE_DIRECTOR_DEFAULT_TOOLS,
  VOICE_DIRECTOR_TEMPLATE_ID,
  VOICE_DIRECTOR_TEMPLATE_NAME,
  type VoiceDirectorOverrides,
} from "./voice-director-template.js";

// ---------------------------------------------------------------------------
// Module-scoped plugin context (set in `setup`, reused from webhook/api hooks)
// ---------------------------------------------------------------------------

let pluginCtx: PluginContext | null = null;

function requireCtx(): PluginContext | null {
  return pluginCtx;
}

// ---------------------------------------------------------------------------
// Tier gate
// ---------------------------------------------------------------------------

function resolveTier(role: string | null | undefined): AgentTier {
  if (!role) return "worker";
  return ROLE_TO_TIER[role.toLowerCase()] ?? "worker";
}

async function assertTier(
  ctx: PluginContext,
  runCtx: ToolRunContext,
  toolName: string,
): Promise<{ error: string } | null> {
  const minTier = TOOL_MIN_TIER[toolName] ?? "worker";
  if (!runCtx.agentId || !runCtx.companyId) {
    return { error: "NoralVoice tools require an agent-scoped run context." };
  }
  let agent;
  try {
    agent = await ctx.agents.get(runCtx.agentId, runCtx.companyId);
  } catch (err) {
    ctx.logger.warn("NoralVoice tier-gate agent lookup failed", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
      err: err instanceof Error ? err.message : "unknown",
    });
    return { error: "NoralVoice could not verify calling agent." };
  }
  if (!agent) return { error: "NoralVoice could not verify calling agent." };
  const callerTier = resolveTier(agent.role);
  if (TIER_RANK[callerTier] < TIER_RANK[minTier]) {
    ctx.logger.info("NoralVoice tier-gate denial", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
      role: agent.role,
      tool: toolName,
      callerTier,
      requiredTier: minTier,
    });
    return {
      error:
        `This tool requires ${minTier} tier or above. Delegate to the Voice Director ` +
        `(or another manager-tier agent) — see Settings → Templates → Voice Director.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Voice Director provisioner
// ---------------------------------------------------------------------------

/**
 * Resolve the company's CEO agent id (if any) so the new Voice Director
 * reports up the chain. Falls back to null with a soft warning when no
 * CEO exists yet — the operator can create one later and re-parent.
 */
async function resolveCeoAgentId(
  ctx: PluginContext,
  companyId: string,
): Promise<string | null> {
  try {
    const rows = await ctx.agents.list({ companyId });
    const ceo = rows.find(
      (a) =>
        (a.role ?? "").toLowerCase() === "ceo" &&
        a.status !== "terminated",
    );
    return ceo?.id ?? null;
  } catch (err) {
    ctx.logger.warn("NoralVoice provisionVoiceDirector: CEO lookup failed", {
      companyId,
      err: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

/** Parse the apiRoute body into a typed overrides object. */
function readVoiceDirectorOverrides(body: unknown): VoiceDirectorOverrides {
  if (!body || typeof body !== "object") return {};
  const o = body as Record<string, unknown>;
  const out: VoiceDirectorOverrides = {};
  if (typeof o.name === "string" && o.name.trim().length > 0) out.name = o.name.trim();
  if (typeof o.systemPrompt === "string" && o.systemPrompt.length > 0) out.systemPrompt = o.systemPrompt;
  if (typeof o.adapterType === "string" || o.adapterType === null) out.adapterType = o.adapterType;
  if (typeof o.reportsTo === "string" || o.reportsTo === null) out.reportsTo = o.reportsTo;
  return out;
}

/**
 * Handle `POST /api/plugins/noralai.noralvoice/api/voice-directors`.
 *
 * Creates a manager-tier agent from the Voice Director template using
 * `ctx.agents.create` (the host service enforces `agents.write`
 * capability and writes provenance metadata).
 *
 * The caller-supplied overrides take precedence over template defaults.
 * When `reportsTo` isn't specified, we resolve the company's CEO and
 * report up the chain; if no CEO exists, we surface a soft warning so
 * the UI can prompt to create one.
 */
async function handleCreateVoiceDirector(
  ctx: PluginContext,
  input: { companyId?: string; parsedBody?: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const companyId = typeof input.companyId === "string" ? input.companyId : "";
  if (!companyId) {
    return { status: 400, body: { error: "Missing companyId" } };
  }
  const overrides = readVoiceDirectorOverrides(input.parsedBody);
  const reportsTo =
    overrides.reportsTo !== undefined ? overrides.reportsTo : await resolveCeoAgentId(ctx, companyId);

  try {
    const created = await ctx.agents.create({
      companyId,
      name: overrides.name ?? VOICE_DIRECTOR_TEMPLATE_NAME,
      role: VOICE_DIRECTOR_DEFAULT_ROLE,
      title: VOICE_DIRECTOR_DEFAULT_TITLE,
      reportsTo,
      capabilities: VOICE_DIRECTOR_DEFAULT_TOOLS.join(","),
      adapterType: overrides.adapterType ?? null,
      adapterConfig: {},
      runtimeConfig: {
        systemPrompt: overrides.systemPrompt ?? VOICE_DIRECTOR_DEFAULT_SYSTEM_PROMPT,
        tools: [...VOICE_DIRECTOR_DEFAULT_TOOLS],
        template: VOICE_DIRECTOR_TEMPLATE_ID,
      },
      metadata: {
        provisionedFromTemplate: VOICE_DIRECTOR_TEMPLATE_ID,
      },
    });
    await ctx.activity.log({
      companyId,
      message: `Voice Director "${created.name}" provisioned`,
      entityType: "agent",
      entityId: created.id,
      metadata: {
        kind: "noralvoice.voice-director.provisioned",
        reportsTo: created.reportsTo ?? null,
      },
    });
    const body: Record<string, unknown> = {
      ok: true,
      agentId: created.id,
      name: created.name,
      reportsTo: created.reportsTo ?? null,
    };
    if (created.reportsTo == null) {
      body.reportsToWarning =
        "No CEO agent found in this company — Voice Director was created without a manager. " +
        "Create a CEO agent (or pass `reportsTo` explicitly) to set up the reporting chain.";
    }
    return { status: 200, body };
  } catch (err) {
    ctx.logger.warn("NoralVoice create_voice_director failed", {
      companyId,
      err: err instanceof Error ? err.message : "unknown",
    });
    return {
      status: 500,
      body: { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
    };
  }
}

// ---------------------------------------------------------------------------
// Config + secret resolution (per-call; never cached)
// ---------------------------------------------------------------------------

interface InstanceConfig {
  baseUrl: string;
  apiKeyRef: string;
  organizationId: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readConfig(raw: Record<string, unknown>): InstanceConfig | { error: string } {
  const baseUrl = isNonEmptyString(raw.baseUrl) ? raw.baseUrl.trim().replace(/\/+$/, "") : "";
  const apiKeyRef = isNonEmptyString(raw.apiKeyRef) ? raw.apiKeyRef.trim() : "";
  const organizationId =
    typeof raw.organizationId === "number" && Number.isInteger(raw.organizationId)
      ? raw.organizationId
      : NaN;
  const missing: string[] = [];
  if (!baseUrl) missing.push("baseUrl");
  if (!apiKeyRef) missing.push("apiKeyRef");
  if (!Number.isFinite(organizationId)) missing.push("organizationId");
  if (missing.length > 0) {
    return { error: `NoralVoice plugin config is missing: ${missing.join(", ")}.` };
  }
  return { baseUrl, apiKeyRef, organizationId };
}

async function resolveClientConfig(
  ctx: PluginContext,
  runCtx: ToolRunContext | null,
): Promise<NoralVoiceClientConfig | { error: string }> {
  const config = readConfig(await ctx.config.get());
  if ("error" in config) return { error: config.error };
  let apiKey: string;
  try {
    apiKey = await ctx.secrets.resolve(config.apiKeyRef);
  } catch {
    ctx.logger.error("NoralVoice apiKey resolution failed", {
      companyId: runCtx?.companyId,
      agentId: runCtx?.agentId,
    });
    return {
      error:
        "NoralVoice could not resolve the API key. Check Settings → Integrations → NoralVoice.",
    };
  }
  if (!apiKey) {
    return {
      error: "NoralVoice API key credential is empty. Re-enter the credential in Settings → Integrations.",
    };
  }
  return { baseUrl: config.baseUrl, apiKey };
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

function normaliseFailure(err: unknown): { safe: string; category: string; httpStatus?: number } {
  if (err instanceof NoralVoiceClientError) {
    return { safe: err.message, category: err.category, httpStatus: err.httpStatus };
  }
  return { safe: "NoralVoice request failed for an unknown reason.", category: "unknown" };
}

// ---------------------------------------------------------------------------
// HMAC verification (must match PR-A signing: HMAC-SHA256 over raw body,
// hex-encoded, sent as `X-Signature: sha256=<hex>`)
// ---------------------------------------------------------------------------

interface WebhookRegistrationState {
  webhookId: number;
  secret: string;
}

function verifyHmac(secret: string, body: string, headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  // Header format: `sha256=<hex>`. Strip the prefix if present.
  const expectedHex = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const actualHex = headerValue.startsWith("sha256=")
    ? headerValue.slice("sha256=".length)
    : headerValue;
  // Both buffers must be equal length for timingSafeEqual; bail with
  // false if not.
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;

    const findTool = (name: string) => {
      const tool = manifest.tools?.find((t) => t.name === name);
      if (!tool) throw new Error(`NoralVoice worker: tool '${name}' missing from manifest.`);
      return tool;
    };

    type Reader<T> = (raw: Record<string, unknown>) => { ok: true; value: T } | { ok: false; error: string };

    function registerTool<T>(
      toolName: string,
      read: Reader<T>,
      execute: (params: T, config: NoralVoiceClientConfig, runCtx: ToolRunContext) => Promise<ToolResult>,
    ): void {
      const decl = findTool(toolName);
      ctx.tools.register(
        toolName,
        {
          displayName: decl.displayName,
          description: decl.description,
          parametersSchema: decl.parametersSchema,
        },
        async (rawParams, runCtx) => {
          // 1. Tier gate (per-tool min tier).
          const denied = await assertTier(ctx, runCtx, toolName);
          if (denied) return denied;

          // 2. Param parsing.
          if (rawParams != null && (typeof rawParams !== "object" || Array.isArray(rawParams))) {
            return { error: `${toolName} parameters must be an object.` };
          }
          const parsed = read((rawParams as Record<string, unknown>) ?? {});
          if (!parsed.ok) return { error: parsed.error };

          // 3. Config + secret.
          const config = await resolveClientConfig(ctx, runCtx);
          if ("error" in config) return { error: config.error };

          // 4. Execute, normalise upstream errors.
          try {
            return await execute(parsed.value, config, runCtx);
          } catch (err) {
            const { safe, category, httpStatus } = normaliseFailure(err);
            ctx.logger.warn(`NoralVoice ${toolName} failed`, {
              companyId: runCtx.companyId,
              agentId: runCtx.agentId,
              category,
              httpStatus,
            });
            return { error: safe };
          }
        },
      );
    }

    // ---- list_workflows ---------------------------------------------------
    registerTool<{ limit?: number }>(
      LIST_WORKFLOWS_TOOL_NAME,
      (raw) => {
        let limit: number | undefined;
        if (raw.limit !== undefined) {
          if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 100) {
            return { ok: false, error: `${LIST_WORKFLOWS_TOOL_NAME}.limit must be an integer 1..100.` };
          }
          limit = raw.limit;
        }
        return { ok: true, value: { limit } };
      },
      async (params, config, runCtx) => {
        const result = await executeListWorkflows(config, params);
        ctx.logger.info("NoralVoice list_workflows ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          count: result.data.workflows.length,
        });
        return result;
      },
    );

    // ---- run_call ---------------------------------------------------------
    registerTool<{ workflowUuid: string; toNumber: string; variables?: Record<string, string | number | boolean> }>(
      RUN_CALL_TOOL_NAME,
      (raw) => {
        const workflowUuid = isNonEmptyString(raw.workflowUuid) ? raw.workflowUuid : "";
        const toNumber = isNonEmptyString(raw.toNumber) ? raw.toNumber : "";
        if (!workflowUuid) return { ok: false, error: `${RUN_CALL_TOOL_NAME}.workflowUuid is required.` };
        if (!toNumber) return { ok: false, error: `${RUN_CALL_TOOL_NAME}.toNumber is required.` };
        if (!/^\+[1-9]\d{6,14}$/.test(toNumber)) {
          return { ok: false, error: `${RUN_CALL_TOOL_NAME}.toNumber must be E.164 (e.g. +15555550100).` };
        }
        let variables: Record<string, string | number | boolean> | undefined;
        if (raw.variables !== undefined) {
          if (typeof raw.variables !== "object" || Array.isArray(raw.variables) || raw.variables === null) {
            return { ok: false, error: `${RUN_CALL_TOOL_NAME}.variables must be an object.` };
          }
          variables = raw.variables as Record<string, string | number | boolean>;
        }
        return { ok: true, value: { workflowUuid, toNumber, variables } };
      },
      async (params, config, runCtx) => {
        const result = await executeRunCall(config, params);
        ctx.logger.info("NoralVoice run_call placed", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          workflowUuid: params.workflowUuid,
          toNumber: params.toNumber,
          runId: result.data.runId,
        });
        return result;
      },
    );

    // ---- get_run ----------------------------------------------------------
    registerTool<{ runId: string }>(
      GET_RUN_TOOL_NAME,
      (raw) => {
        const runId = isNonEmptyString(raw.runId) ? raw.runId : "";
        if (!runId) return { ok: false, error: `${GET_RUN_TOOL_NAME}.runId is required.` };
        return { ok: true, value: { runId } };
      },
      async (params, config) => executeGetRun(config, params),
    );

    ctx.logger.info(`${PLUGIN_ID} plugin setup complete`);
  },

  // ---------------------------------------------------------------------------
  // Lifecycle: register the webhook receiver with NoralVoice on config save.
  // Idempotent — if a registration already exists in plugin state we delete
  // it before creating a new one (rotation case).
  // ---------------------------------------------------------------------------

  async onConfigChanged(newConfig) {
    const ctx = requireCtx();
    if (!ctx) return;
    const parsed = readConfig(newConfig);
    if ("error" in parsed) {
      ctx.logger.warn("NoralVoice onConfigChanged: config incomplete; skipping webhook registration", {
        reason: parsed.error,
      });
      return;
    }
    let apiKey: string;
    try {
      apiKey = await ctx.secrets.resolve(parsed.apiKeyRef);
    } catch {
      ctx.logger.warn("NoralVoice onConfigChanged: apiKey resolve failed");
      return;
    }
    if (!apiKey) return;

    const companyId = (ctx as unknown as { companyId?: string }).companyId;
    if (!companyId) {
      // onConfigChanged is per-company in practice; if the host hasn't
      // surfaced it on the context yet we bail rather than guess.
      ctx.logger.info("NoralVoice onConfigChanged: no companyId on ctx; skipping");
      return;
    }

    const stateScope = {
      scopeKind: "company",
      scopeId: companyId,
      namespace: STATE_NAMESPACE,
      stateKey: STATE_KEY_WEBHOOK_REGISTRATION,
    } as const;

    // Tear down a previous registration if any. Best-effort.
    const existing = (await ctx.state.get(stateScope)) as WebhookRegistrationState | null;
    if (existing && existing.webhookId) {
      try {
        await deleteIntegrationWebhook({ baseUrl: parsed.baseUrl, apiKey }, existing.webhookId);
      } catch (err) {
        ctx.logger.warn("NoralVoice onConfigChanged: previous webhook delete failed", {
          webhookId: existing.webhookId,
          err: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    // Where NoralVoice should POST `run.completed`. The host's public
    // base URL is captured by the SDK at startup; we ask for it via the
    // context (`ctx.host.publicUrl`) which yields the canonical
    // operator-facing origin.
    const hostBaseUrl = (ctx as unknown as { host?: { publicUrl?: string } }).host?.publicUrl;
    if (!hostBaseUrl) {
      ctx.logger.warn("NoralVoice onConfigChanged: ctx.host.publicUrl unavailable; cannot construct target URL");
      return;
    }
    const targetUrl =
      `${hostBaseUrl.replace(/\/+$/, "")}` +
      `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/webhooks/${RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY}` +
      `?company=${encodeURIComponent(companyId)}`;

    try {
      const registration = await registerIntegrationWebhook(
        { baseUrl: parsed.baseUrl, apiKey },
        { eventType: "run.completed", targetUrl },
      );
      await ctx.state.set(stateScope, registration);
      ctx.logger.info("NoralVoice onConfigChanged: webhook registered", {
        webhookId: registration.id,
      });
    } catch (err) {
      ctx.logger.error("NoralVoice onConfigChanged: webhook register failed", {
        err: err instanceof Error ? err.message : "unknown",
      });
    }
  },

  // ---------------------------------------------------------------------------
  // Webhook receiver: verify HMAC + emit on the NoralOS event bus.
  // ---------------------------------------------------------------------------

  async onWebhook(input) {
    if (input.endpointKey !== RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY) return;
    const ctx = requireCtx();
    if (!ctx) return;

    const companyQ = input.query.company;
    const companyId = Array.isArray(companyQ) ? companyQ[0] : companyQ;
    if (!companyId) {
      ctx.logger.warn("NoralVoice webhook: missing companyId in query");
      return;
    }

    const registration = (await ctx.state.get({
      scopeKind: "company",
      scopeId: companyId,
      namespace: STATE_NAMESPACE,
      stateKey: STATE_KEY_WEBHOOK_REGISTRATION,
    })) as WebhookRegistrationState | null;
    if (!registration?.secret) {
      ctx.logger.warn("NoralVoice webhook: no registration state — rejecting", { companyId });
      return;
    }

    const signatureHeader =
      (input.headers["x-signature"] as string | undefined) ??
      (input.headers["X-Signature"] as string | undefined);
    const rawBody = typeof input.rawBody === "string" ? input.rawBody : "";
    if (!verifyHmac(registration.secret, rawBody, signatureHeader)) {
      ctx.logger.warn("NoralVoice webhook: HMAC verification failed", { companyId });
      return;
    }

    const payload = input.parsedBody;
    if (!payload || typeof payload !== "object") return;

    // Emit on the NoralOS event bus — this is what wakes the originating
    // agent. The payload keys mirror the v1 schema PR-A defined.
    await ctx.events.emit(
      "noralai.noralvoice.run.completed",
      companyId,
      payload as Record<string, unknown>,
    );
    await ctx.activity.log({
      companyId,
      message: "NoralVoice run.completed delivered",
      metadata: { eventType: "run.completed" },
    });
    ctx.logger.info("NoralVoice webhook accepted", {
      companyId,
      runId: (payload as { run_id?: string }).run_id,
    });
  },

  // ---------------------------------------------------------------------------
  // API routes: board-auth surfaces for the plugin page UI.
  // ---------------------------------------------------------------------------

  async onApiRequest(input) {
    const ctx = requireCtx();
    if (!ctx) return { status: 503, body: { error: "Plugin not yet initialised" } };

    if (input.routeKey === "list_workflows") {
      const config = await resolveClientConfig(ctx, null);
      if ("error" in config) return { status: 400, body: { error: config.error } };
      try {
        const result = await executeListWorkflows(config, {});
        return { status: 200, body: { workflows: result.data.workflows } };
      } catch (err) {
        const { safe, httpStatus } = normaliseFailure(err);
        return {
          status: httpStatus && httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
          body: { error: safe },
        };
      }
    }

    if (input.routeKey === "create_voice_director") {
      return await handleCreateVoiceDirector(ctx, input);
    }

    return { status: 404, body: { error: "Unknown route" } };
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_ID} ready` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
