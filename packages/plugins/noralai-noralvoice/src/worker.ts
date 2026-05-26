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

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { definePlugin, runWorker } from "@noralos/plugin-sdk";
import type {
  PluginContext,
  PluginReverseToolInput,
  PluginReverseToolResult,
  ToolResult,
  ToolRunContext,
} from "@noralos/plugin-sdk";

import {
  GET_RUN_TOOL_NAME,
  LIST_WORKFLOWS_TOOL_NAME,
  PLUGIN_ID,
  REVERSE_TOOL_WEBHOOK_ENDPOINT_KEY,
  ROLE_TO_TIER,
  RUN_CALL_TOOL_NAME,
  RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY,
  STATE_KEY_WEBHOOK_REGISTRATION,
  STATE_NAMESPACE,
  TIER_RANK,
  type AgentTier,
} from "./constants.js";
import { dispatchReverseTool, type HostQuery } from "./reverse-tools.js";
import { manifest } from "./manifest.js";
import {
  NoralVoiceClientError,
  type NoralVoiceTTSProvider,
  deleteIntegrationWebhook,
  extractVoiceSettings,
  getWorkflowByUuid,
  registerIntegrationWebhook,
  type NoralVoiceClientConfig,
} from "./noralvoice-client.js";
import { executeGetCampaign } from "./tools/get_campaign.js";
import { executeGetRun } from "./tools/get_run.js";
import { executeListCampaigns } from "./tools/list_campaigns.js";
import { executeListRuns } from "./tools/list_runs.js";
import { executeListWorkflows } from "./tools/list_workflows.js";
import {
  ADD_TELEPHONY_CREDENTIAL_TOOL_NAME,
  ADD_WORKFLOW_TOOL_TOOL_NAME,
  ASSIGN_PHONE_NUMBER_TOOL_NAME,
  CREATE_CAMPAIGN_TOOL_NAME,
  CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  CREATE_WORKFLOW_TOOL_NAME,
  DELETE_WORKFLOW_TOOL_TOOL_NAME,
  GET_CAMPAIGN_TOOL_NAME,
  GET_DAILY_REPORT_TOOL_NAME,
  GET_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  GET_RECORDING_DOWNLOAD_URL_TOOL_NAME,
  GET_RUN_DETAIL_TOOL_NAME,
  LIST_CAMPAIGNS_TOOL_NAME,
  LIST_KB_DOCUMENTS_TOOL_NAME,
  LIST_RECORDINGS_TOOL_NAME,
  LIST_RUNS_TOOL_NAME,
  LIST_TELEPHONY_CREDENTIALS_TOOL_NAME,
  LIST_VOICES_TOOL_NAME,
  PAUSE_CAMPAIGN_TOOL_NAME,
  PROVISION_VOICE_AGENT_TOOL_NAME,
  REDIAL_CAMPAIGN_TOOL_NAME,
  RESUME_CAMPAIGN_TOOL_NAME,
  REVOKE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
  SEARCH_KB_TOOL_NAME,
  SET_AGENT_VOICE_TOOL_NAME,
  START_CAMPAIGN_TOOL_NAME,
  TOOL_MIN_TIER_V3,
  UPDATE_WORKFLOW_TOOL_TOOL_NAME,
  UPLOAD_KB_DOCUMENT_TOOL_NAME,
} from "./tools/registry.js";
import { executeAddWorkflowTool } from "./tools/add_workflow_tool.js";
import { executeCreateCampaign } from "./tools/create_campaign.js";
import { executeCreatePersistentEmbedToken } from "./tools/create_persistent_embed_token.js";
import { executeCreateWorkflow } from "./tools/create_workflow.js";
import { executeDeleteWorkflowTool } from "./tools/delete_workflow_tool.js";
import { executeGetDailyReport } from "./tools/get_daily_report.js";
import { executeGetPersistentEmbedToken } from "./tools/get_persistent_embed_token.js";
import { executeGetRecordingDownloadUrl } from "./tools/get_recording_download_url.js";
import { executeGetRunDetail } from "./tools/get_run_detail.js";
import { executeListKbDocuments } from "./tools/list_kb_documents.js";
import { executeListRecordings } from "./tools/list_recordings.js";
import { executePauseCampaign } from "./tools/pause_campaign.js";
import { executeRedialCampaign } from "./tools/redial_campaign.js";
import { executeResumeCampaign } from "./tools/resume_campaign.js";
import { executeRevokePersistentEmbedToken } from "./tools/revoke_persistent_embed_token.js";
import { executeSaveWorkflow } from "./tools/save_workflow.js";
import { executeStartCampaign } from "./tools/start_campaign.js";
import { executeUpdateWorkflowTool } from "./tools/update_workflow_tool.js";
import { executeUploadKbDocument } from "./tools/upload_kb_document.js";
import { executeAddTelephonyCredential } from "./tools/add_telephony_credential.js";
import { executeAssignPhoneNumber } from "./tools/assign_phone_number_to_workflow.js";
import { executeListTelephonyCredentials } from "./tools/list_telephony_credentials.js";
import { executeRunCall } from "./tools/run_call.js";
import { executeListVoices } from "./tools/list_voices.js";
import { executeProvisionVoiceAgent } from "./tools/provision_voice_agent.js";
import { executeSearchKb } from "./tools/search_kb.js";
import { executeSetAgentVoice } from "./tools/set_agent_voice.js";
import { NORALVOICE_TELEPHONY_PROVIDERS, type NoralVoiceTelephonyProvider } from "./noralvoice-client.js";
import {
  VOICE_DIRECTOR_DEFAULT_ROLE,
  VOICE_DIRECTOR_DEFAULT_SYSTEM_PROMPT,
  VOICE_DIRECTOR_DEFAULT_TITLE,
  VOICE_DIRECTOR_DEFAULT_TOOLS,
  VOICE_DIRECTOR_TEMPLATE_ID,
  VOICE_DIRECTOR_TEMPLATE_NAME,
  type VoiceDirectorOverrides,
} from "./voice-director-template.js";
import { mirrorToVoiceConfig } from "./voice-config-mirror.js";

// ---------------------------------------------------------------------------
// Module-scoped plugin context (set in `setup`, reused from webhook/api hooks)
// ---------------------------------------------------------------------------

let pluginCtx: PluginContext | null = null;

function requireCtx(): PluginContext | null {
  return pluginCtx;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Parse + clamp a `?limit=` query value to 1..100. Default 25. */
function parseLimit(raw: unknown): number {
  if (typeof raw !== "string") return 25;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 25;
  return Math.min(100, n);
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
  // Phase 3: tier mappings live in tools/registry.ts (TOOL_MIN_TIER_V3),
  // which is the source of truth across both phases. The Phase 1B
  // TOOL_MIN_TIER constant is preserved for backward compat but new
  // tools must register here.
  const minTier = TOOL_MIN_TIER_V3[toolName] ?? "worker";
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
  input: { companyId?: string; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const companyId = typeof input.companyId === "string" ? input.companyId : "";
  if (!companyId) {
    return { status: 400, body: { error: "Missing companyId" } };
  }
  const overrides = readVoiceDirectorOverrides(input.body);
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
  const actorHeaders = await buildActorHeaders(ctx, runCtx);
  return { baseUrl: config.baseUrl, apiKey, actorHeaders };
}

/**
 * Phase-7.5 cross-system attribution: assemble the `X-Noralos-Actor-*` headers
 * NoralVoice's actor middleware reads on every write request. Sourced from
 * the `ToolRunContext` plus a one-shot agent lookup for the display name.
 *
 * Returns an empty object when there's no run (lifecycle hooks, manual API
 * paths) — NoralVoice treats those as human-direct writes.
 *
 * Per the cross-system attribution spec: omit headers that aren't available
 * rather than synthesising values. NoralVoice's middleware is lenient about
 * missing optional headers and falls back to "Unknown agent" if the name is
 * absent.
 */
async function buildActorHeaders(
  ctx: PluginContext,
  runCtx: ToolRunContext | null,
): Promise<Record<string, string>> {
  if (!runCtx) return {};
  const headers: Record<string, string> = {
    "X-Noralos-Actor-Agent-Id": runCtx.agentId,
    "X-Noralos-Run-Id": runCtx.runId,
    "X-Noralos-Company-Id": runCtx.companyId,
  };
  // Delegated-identity assertion: when the run was triggered by a human user,
  // forward their NoralOS user id (and email, for JIT provisioning) so
  // NoralVoice can stamp the created entity as owned by that user instead of
  // by whoever minted the shared API key. NoralVoice only honors these
  // headers when the API key is flagged delegation_capable on its side.
  if (runCtx.triggeredByUserId) {
    headers["X-Noralos-Actor-User-Id"] = runCtx.triggeredByUserId;
    if (runCtx.triggeredByUserEmail) {
      headers["X-Noralos-Actor-User-Email"] = runCtx.triggeredByUserEmail;
    }
  }
  try {
    const agent = await ctx.agents.get(runCtx.agentId, runCtx.companyId);
    if (agent && agent.name) {
      headers["X-Noralos-Actor-Agent-Name"] = agent.name;
    }
  } catch (err) {
    // Best-effort — a failed agent lookup must never block a tool call.
    // NoralVoice will record the actor with display_name = "Unknown agent".
    ctx.logger.debug("agent name lookup for attribution failed", {
      err: err instanceof Error ? err.message : String(err),
      agentId: runCtx.agentId,
    });
  }
  return headers;
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
  // Phase 5d — per-company HMAC key for inbound `noralos://`
  // reverse-RPC dispatches. Generated server-side at first
  // registration and shipped to NoralVoice alongside `reverseRpcUrl`
  // via `registerIntegrationWebhook`. The worker re-uses this stored
  // value when verifying the X-Noralos-Signature header on inbound
  // reverse-tool webhooks.
  reverseRpcSecret?: string;
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
// Phase 5d — inbound `noralos://` reverse-RPC dispatch handler.
//
// NoralVoice's workflow tool executor POSTs to
// `/api/plugins/<pluginId>/webhooks/reverse-tool?company=<uuid>` with
// an envelope `{ schemaVersion, plugin_id, tool_name, args, run_id,
// workflow_uuid, organization_id }`, signed with
// `X-Noralos-Signature: sha256=<hex>` over the raw body using the
// per-company `reverseRpcSecret` captured at lifecycle setup.
//
// The function verifies HMAC against state-stored reverseRpcSecret,
// dispatches to the matching reverse-tool handler, and (because the
// host's webhook return shape is fire-and-forget) the result is
// logged. A future host-side enhancement could thread the
// PluginReverseToolResult back through the HTTP response so the
// calling NoralVoice Agent node sees it directly.
// ---------------------------------------------------------------------------

interface NoralosReverseToolEnvelope {
  schemaVersion: number;
  plugin_id: string;
  tool_name: string;
  args?: Record<string, unknown>;
  run_id?: string | number | null;
  workflow_uuid?: string | null;
  organization_id?: number | null;
}

function isReverseToolEnvelope(value: unknown): value is NoralosReverseToolEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === "number" &&
    typeof v.plugin_id === "string" &&
    typeof v.tool_name === "string"
  );
}

async function handleReverseToolWebhook(
  input: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["onWebhook"]>>[0],
): Promise<void> {
  const ctx = requireCtx();
  if (!ctx) return;

  const companyQ = input.query.company;
  const companyId = Array.isArray(companyQ) ? companyQ[0] : companyQ;
  if (!companyId) {
    ctx.logger.warn("NoralVoice reverse-tool webhook: missing companyId in query");
    return;
  }

  const registration = (await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    namespace: STATE_NAMESPACE,
    stateKey: STATE_KEY_WEBHOOK_REGISTRATION,
  })) as WebhookRegistrationState | null;
  if (!registration?.reverseRpcSecret) {
    ctx.logger.warn("NoralVoice reverse-tool webhook: no reverse-RPC secret on file", {
      companyId,
    });
    return;
  }

  const signatureHeader =
    (input.headers["x-noralos-signature"] as string | undefined) ??
    (input.headers["X-Noralos-Signature"] as string | undefined);
  const rawBody = typeof input.rawBody === "string" ? input.rawBody : "";
  if (!verifyHmac(registration.reverseRpcSecret, rawBody, signatureHeader)) {
    ctx.logger.warn("NoralVoice reverse-tool webhook: HMAC verification failed", {
      companyId,
    });
    return;
  }

  const envelope = input.parsedBody;
  if (!isReverseToolEnvelope(envelope)) {
    ctx.logger.warn("NoralVoice reverse-tool webhook: malformed envelope", { companyId });
    return;
  }

  // Restricted host-DB access (same cast pattern Phase 3 uses elsewhere).
  const hostDb = (ctx as unknown as { host?: { queryHostDb?: HostQuery } })
    .host?.queryHostDb;

  const result = await dispatchReverseTool(
    {
      companyId,
      hostDb,
      logger: ctx.logger,
    },
    envelope.tool_name,
    envelope.args ?? {},
  );

  // The webhook return shape is fire-and-forget, so for v1 we log the
  // result here. Calling-side NoralVoice surfaces the failure as a
  // tool error to the LLM via its own request/response loop; the host
  // doesn't yet thread the result back over this socket. A follow-up
  // can promote reverseTools to a host-routed apiRoute that returns
  // the result directly.
  if (result.ok) {
    ctx.logger.info("reverse-tool dispatched ok", {
      tool: envelope.tool_name,
      company: companyId,
    });
  } else {
    ctx.logger.warn("reverse-tool dispatch returned error", {
      tool: envelope.tool_name,
      company: companyId,
      code: result.code,
      error: result.error,
    });
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

    // ---- Phase 3: list_voices --------------------------------------------
    const NORALVOICE_PROVIDERS: readonly NoralVoiceTTSProvider[] = [
      "elevenlabs",
      "deepgram",
      "sarvam",
      "cartesia",
      "dograh",
      "rime",
    ];
    registerTool<{ provider?: NoralVoiceTTSProvider }>(
      LIST_VOICES_TOOL_NAME,
      (raw) => {
        let provider: NoralVoiceTTSProvider | undefined;
        if (raw.provider !== undefined) {
          if (!isNonEmptyString(raw.provider)) {
            return { ok: false, error: `${LIST_VOICES_TOOL_NAME}.provider must be a string.` };
          }
          if (!(NORALVOICE_PROVIDERS as readonly string[]).includes(raw.provider)) {
            return {
              ok: false,
              error: `${LIST_VOICES_TOOL_NAME}.provider must be one of: ${NORALVOICE_PROVIDERS.join(", ")}.`,
            };
          }
          provider = raw.provider as NoralVoiceTTSProvider;
        }
        return { ok: true, value: { provider } };
      },
      async (params, config) => executeListVoices(config, params),
    );

    // Per-company DB query helper for the voice-config mirror write.
    // The plugin SDK exposes `ctx.host.queryHostDb` for plugins with
    // the appropriate capability declared in their manifest; we cast
    // through here because the SDK types are wider than the plumbing
    // we exercise.
    type HostQuery = (sql: string, params: unknown[]) => Promise<unknown>;
    const hostDb = (
      ctx as unknown as { host?: { queryHostDb?: HostQuery } }
    ).host?.queryHostDb;

    // Tier-3 side-effect context builders. Each closure captures the
    // worker `ctx` so the tools themselves stay SDK-free.
    async function resolveVoiceAgentUuid(
      companyId: string,
      agentId: string,
    ): Promise<string | null> {
      if (!hostDb) return null;
      const rows = (await hostDb(
        `SELECT voice_agent_uuid FROM public.agents WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [agentId, companyId],
      )) as Array<{ voice_agent_uuid: string | null }> | null;
      const row = Array.isArray(rows) ? rows[0] : null;
      return row?.voice_agent_uuid ?? null;
    }

    async function resolveAgentName(
      companyId: string,
      agentId: string,
    ): Promise<string | null> {
      if (!hostDb) return null;
      const rows = (await hostDb(
        `SELECT name FROM public.agents WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [agentId, companyId],
      )) as Array<{ name: string | null }> | null;
      const row = Array.isArray(rows) ? rows[0] : null;
      return row?.name ?? null;
    }

    async function writeVoiceAgentUuid(
      companyId: string,
      agentId: string,
      uuid: string,
    ): Promise<void> {
      if (!hostDb) {
        throw new Error(
          "NoralVoice plugin: ctx.host.queryHostDb unavailable; cannot write voice_agent_uuid.",
        );
      }
      await hostDb(
        `UPDATE public.agents SET voice_agent_uuid = $1, updated_at = now() WHERE id = $2::uuid AND company_id = $3::uuid`,
        [uuid, agentId, companyId],
      );
    }

    // ---- Phase 3: set_agent_voice ----------------------------------------
    registerTool<{
      noralosAgentId: string;
      provider: NoralVoiceTTSProvider;
      voiceId: string;
      voiceOptions?: Record<string, unknown>;
    }>(
      SET_AGENT_VOICE_TOOL_NAME,
      (raw) => {
        const agentId = isNonEmptyString(raw.noralosAgentId) ? raw.noralosAgentId : "";
        if (!agentId) {
          return { ok: false, error: `${SET_AGENT_VOICE_TOOL_NAME}.noralosAgentId is required.` };
        }
        const provider = raw.provider;
        if (!isNonEmptyString(provider) || !(NORALVOICE_PROVIDERS as readonly string[]).includes(provider)) {
          return {
            ok: false,
            error: `${SET_AGENT_VOICE_TOOL_NAME}.provider must be one of: ${NORALVOICE_PROVIDERS.join(", ")}.`,
          };
        }
        const voiceId = isNonEmptyString(raw.voiceId) ? raw.voiceId : "";
        if (!voiceId) {
          return { ok: false, error: `${SET_AGENT_VOICE_TOOL_NAME}.voiceId is required.` };
        }
        let voiceOptions: Record<string, unknown> | undefined;
        if (raw.voiceOptions !== undefined) {
          if (typeof raw.voiceOptions !== "object" || Array.isArray(raw.voiceOptions) || raw.voiceOptions === null) {
            return {
              ok: false,
              error: `${SET_AGENT_VOICE_TOOL_NAME}.voiceOptions must be an object.`,
            };
          }
          voiceOptions = raw.voiceOptions as Record<string, unknown>;
        }
        return {
          ok: true,
          value: { noralosAgentId: agentId, provider: provider as NoralVoiceTTSProvider, voiceId, voiceOptions },
        };
      },
      async (params, config, runCtx) => {
        const companyId = runCtx.companyId!;
        const result = await executeSetAgentVoice(config, params, {
          companyId,
          resolveVoiceAgentUuid: (agentId) => resolveVoiceAgentUuid(companyId, agentId),
          mirrorToVoiceConfig: async (args) => {
            if (!hostDb) return { mirrored: false };
            return mirrorToVoiceConfig(hostDb, args);
          },
        });
        if (!result.ok) {
          ctx.logger.info("NoralVoice set_agent_voice precondition failed", {
            companyId,
            agentId: params.noralosAgentId,
            error: result.error,
          });
          return { error: result.message, data: { code: result.error } };
        }
        ctx.logger.info("NoralVoice set_agent_voice ok", {
          companyId,
          agentId: params.noralosAgentId,
          provider: params.provider,
          mirrored: result.data.mirrored,
        });
        return { content: result.content, data: result.data };
      },
    );

    // ---- Phase 3: provision_voice_agent ----------------------------------
    registerTool<{ noralosAgentId: string; displayName?: string; template?: "blank" | "conversational" }>(
      PROVISION_VOICE_AGENT_TOOL_NAME,
      (raw) => {
        const agentId = isNonEmptyString(raw.noralosAgentId) ? raw.noralosAgentId : "";
        if (!agentId) {
          return {
            ok: false,
            error: `${PROVISION_VOICE_AGENT_TOOL_NAME}.noralosAgentId is required.`,
          };
        }
        let displayName: string | undefined;
        if (raw.displayName !== undefined) {
          if (!isNonEmptyString(raw.displayName)) {
            return {
              ok: false,
              error: `${PROVISION_VOICE_AGENT_TOOL_NAME}.displayName must be a non-empty string.`,
            };
          }
          if (raw.displayName.length > 200) {
            return {
              ok: false,
              error: `${PROVISION_VOICE_AGENT_TOOL_NAME}.displayName exceeds the 200-char limit.`,
            };
          }
          displayName = raw.displayName;
        }
        let template: "blank" | "conversational" | undefined;
        if (raw.template !== undefined) {
          if (raw.template !== "blank" && raw.template !== "conversational") {
            return {
              ok: false,
              error: `${PROVISION_VOICE_AGENT_TOOL_NAME}.template must be 'blank' or 'conversational'.`,
            };
          }
          template = raw.template;
        }
        return { ok: true, value: { noralosAgentId: agentId, displayName, template } };
      },
      async (params, config, runCtx) => {
        const companyId = runCtx.companyId!;
        const result = await executeProvisionVoiceAgent(config, params, {
          resolveVoiceAgentUuid: (agentId) => resolveVoiceAgentUuid(companyId, agentId),
          resolveAgentName: (agentId) => resolveAgentName(companyId, agentId),
          writeVoiceAgentUuid: (agentId, uuid) => writeVoiceAgentUuid(companyId, agentId, uuid),
        });
        if (!result.ok) {
          ctx.logger.info("NoralVoice provision_voice_agent precondition failed", {
            companyId,
            agentId: params.noralosAgentId,
            error: result.error,
          });
          return {
            error: result.message,
            data: { code: result.error, voice_agent_uuid: result.voice_agent_uuid },
          };
        }
        ctx.logger.info("NoralVoice provision_voice_agent ok", {
          companyId,
          agentId: params.noralosAgentId,
          voiceAgentUuid: result.data.voice_agent_uuid,
        });
        return { content: result.content, data: result.data };
      },
    );

    // ---- Phase 7: list_runs --------------------------------------------------
    registerTool<{ workflowUuid: string; limit?: number; cursor?: string | null }>(
      LIST_RUNS_TOOL_NAME,
      (raw) => {
        const workflowUuid = isNonEmptyString(raw.workflowUuid) ? raw.workflowUuid : "";
        if (!workflowUuid) {
          return { ok: false, error: `${LIST_RUNS_TOOL_NAME}.workflowUuid is required.` };
        }
        let limit: number | undefined;
        if (raw.limit !== undefined) {
          if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 100) {
            return { ok: false, error: `${LIST_RUNS_TOOL_NAME}.limit must be an integer 1..100.` };
          }
          limit = raw.limit;
        }
        const cursor = isNonEmptyString(raw.cursor) ? raw.cursor : null;
        return { ok: true, value: { workflowUuid, limit, cursor } };
      },
      async (params, config, runCtx) => {
        const result = await executeListRuns(config, params);
        ctx.logger.info("NoralVoice list_runs ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          count: result.data.runs.length,
        });
        return result;
      },
    );

    // ---- Phase 7: list_campaigns --------------------------------------------
    registerTool<{ status?: string; limit?: number }>(
      LIST_CAMPAIGNS_TOOL_NAME,
      (raw) => {
        const status = isNonEmptyString(raw.status) ? raw.status : undefined;
        let limit: number | undefined;
        if (raw.limit !== undefined) {
          if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 100) {
            return { ok: false, error: `${LIST_CAMPAIGNS_TOOL_NAME}.limit must be an integer 1..100.` };
          }
          limit = raw.limit;
        }
        return { ok: true, value: { status, limit } };
      },
      async (params, config, runCtx) => {
        const result = await executeListCampaigns(config, params);
        ctx.logger.info("NoralVoice list_campaigns ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          count: result.data.items.length,
        });
        return result;
      },
    );

    // ---- Phase 7: get_campaign ----------------------------------------------
    registerTool<{ campaignId: number }>(
      GET_CAMPAIGN_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.campaignId !== "number" ||
          !Number.isInteger(raw.campaignId) ||
          raw.campaignId < 1
        ) {
          return {
            ok: false,
            error: `${GET_CAMPAIGN_TOOL_NAME}.campaignId must be a positive integer.`,
          };
        }
        return { ok: true, value: { campaignId: raw.campaignId } };
      },
      async (params, config, runCtx) => {
        const result = await executeGetCampaign(config, params);
        ctx.logger.info("NoralVoice get_campaign ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          campaignId: params.campaignId,
        });
        return result;
      },
    );

    // ---- Phase 7: search_kb -------------------------------------------------
    registerTool<{ query: string; limit?: number }>(
      SEARCH_KB_TOOL_NAME,
      (raw) => {
        const query = isNonEmptyString(raw.query) ? raw.query : "";
        if (!query) {
          return { ok: false, error: `${SEARCH_KB_TOOL_NAME}.query is required.` };
        }
        if (query.length > 1000) {
          return { ok: false, error: `${SEARCH_KB_TOOL_NAME}.query exceeds 1000-char limit.` };
        }
        let limit: number | undefined;
        if (raw.limit !== undefined) {
          if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 50) {
            return { ok: false, error: `${SEARCH_KB_TOOL_NAME}.limit must be an integer 1..50.` };
          }
          limit = raw.limit;
        }
        return { ok: true, value: { query, limit } };
      },
      async (params, config, runCtx) => {
        const result = await executeSearchKb(config, params);
        ctx.logger.info("NoralVoice search_kb ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          hits: result.data.hits.length,
        });
        return result;
      },
    );

    // ---- Phase 7 PR-J: add_telephony_credential --------------------------
    // High-stakes write: stores a provider credential (e.g. Twilio account
    // SID + auth token) in NoralVoice. Tier gate enforced above.
    registerTool<{
      name: string;
      provider: NoralVoiceTelephonyProvider;
      credentials: Record<string, string>;
      isDefaultOutbound?: boolean;
    }>(
      ADD_TELEPHONY_CREDENTIAL_TOOL_NAME,
      (raw) => {
        const name = isNonEmptyString(raw.name) ? raw.name : "";
        if (!name) return { ok: false, error: `${ADD_TELEPHONY_CREDENTIAL_TOOL_NAME}.name is required.` };
        if (name.length > 64) {
          return { ok: false, error: `${ADD_TELEPHONY_CREDENTIAL_TOOL_NAME}.name exceeds 64-char limit.` };
        }
        const provider = isNonEmptyString(raw.provider) ? raw.provider : "";
        if (!provider) {
          return { ok: false, error: `${ADD_TELEPHONY_CREDENTIAL_TOOL_NAME}.provider is required.` };
        }
        if (!(NORALVOICE_TELEPHONY_PROVIDERS as readonly string[]).includes(provider)) {
          return {
            ok: false,
            error: `${ADD_TELEPHONY_CREDENTIAL_TOOL_NAME}.provider must be one of: ${NORALVOICE_TELEPHONY_PROVIDERS.join(", ")}.`,
          };
        }
        if (
          !raw.credentials ||
          typeof raw.credentials !== "object" ||
          Array.isArray(raw.credentials)
        ) {
          return {
            ok: false,
            error: `${ADD_TELEPHONY_CREDENTIAL_TOOL_NAME}.credentials must be an object of string fields.`,
          };
        }
        // Coerce every credential field to a string. Refuse non-string values
        // up front — the discriminated-union request schema on NV expects
        // string-typed account_sid / auth_token / etc., and passing booleans
        // or numbers would 422 with a confusing error.
        const credentials: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw.credentials)) {
          if (typeof v !== "string") {
            return {
              ok: false,
              error: `${ADD_TELEPHONY_CREDENTIAL_TOOL_NAME}.credentials.${k} must be a string.`,
            };
          }
          if (v.length === 0) {
            return {
              ok: false,
              error: `${ADD_TELEPHONY_CREDENTIAL_TOOL_NAME}.credentials.${k} must not be empty.`,
            };
          }
          credentials[k] = v;
        }
        const isDefaultOutbound =
          raw.isDefaultOutbound === undefined ? undefined : Boolean(raw.isDefaultOutbound);
        return {
          ok: true,
          value: {
            name,
            provider: provider as NoralVoiceTelephonyProvider,
            credentials,
            isDefaultOutbound,
          },
        };
      },
      async (params, config, runCtx) => {
        const result = await executeAddTelephonyCredential(config, params);
        // Log only non-secret fields. `credentials` MUST NOT appear here.
        ctx.logger.info("NoralVoice add_telephony_credential ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          provider: result.data.provider,
          configId: result.data.configId,
          isDefaultOutbound: result.data.isDefaultOutbound,
        });
        return result;
      },
    );

    // ---- Phase 7 PR-J: list_telephony_credentials ------------------------
    // Read-only. NV's list endpoint omits credentials entirely so there's
    // no secret surface in the response.
    registerTool<Record<string, never>>(
      LIST_TELEPHONY_CREDENTIALS_TOOL_NAME,
      () => ({ ok: true, value: {} }),
      async (_params, config, runCtx) => {
        const result = await executeListTelephonyCredentials(config);
        ctx.logger.info("NoralVoice list_telephony_credentials ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          count: result.data.configs.length,
        });
        return result;
      },
    );

    // ---- Phase 7 PR-J: assign_phone_number_to_workflow -------------------
    // High-stakes write: routes inbound calls on a phone number to a
    // workflow + (when supplied) attempts a provider-side webhook sync.
    registerTool<{
      configId: number;
      address: string;
      inboundWorkflowId?: number;
      countryCode?: string;
      label?: string;
      isDefaultCallerId?: boolean;
    }>(
      ASSIGN_PHONE_NUMBER_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.configId !== "number" ||
          !Number.isInteger(raw.configId) ||
          raw.configId < 1
        ) {
          return {
            ok: false,
            error: `${ASSIGN_PHONE_NUMBER_TOOL_NAME}.configId must be a positive integer.`,
          };
        }
        const address = isNonEmptyString(raw.address) ? raw.address : "";
        if (!address) {
          return { ok: false, error: `${ASSIGN_PHONE_NUMBER_TOOL_NAME}.address is required.` };
        }
        if (!/^\+[1-9]\d{6,14}$/.test(address)) {
          return {
            ok: false,
            error: `${ASSIGN_PHONE_NUMBER_TOOL_NAME}.address must be E.164 (e.g. +15555550100).`,
          };
        }
        let inboundWorkflowId: number | undefined;
        if (raw.inboundWorkflowId !== undefined) {
          if (
            typeof raw.inboundWorkflowId !== "number" ||
            !Number.isInteger(raw.inboundWorkflowId) ||
            raw.inboundWorkflowId < 1
          ) {
            return {
              ok: false,
              error: `${ASSIGN_PHONE_NUMBER_TOOL_NAME}.inboundWorkflowId must be a positive integer.`,
            };
          }
          inboundWorkflowId = raw.inboundWorkflowId;
        }
        let countryCode: string | undefined;
        if (raw.countryCode !== undefined) {
          if (typeof raw.countryCode !== "string" || raw.countryCode.length !== 2) {
            return {
              ok: false,
              error: `${ASSIGN_PHONE_NUMBER_TOOL_NAME}.countryCode must be ISO-3166-1 alpha-2 (2 chars).`,
            };
          }
          countryCode = raw.countryCode;
        }
        let label: string | undefined;
        if (raw.label !== undefined) {
          if (typeof raw.label !== "string") {
            return { ok: false, error: `${ASSIGN_PHONE_NUMBER_TOOL_NAME}.label must be a string.` };
          }
          if (raw.label.length > 64) {
            return {
              ok: false,
              error: `${ASSIGN_PHONE_NUMBER_TOOL_NAME}.label exceeds 64-char limit.`,
            };
          }
          label = raw.label;
        }
        const isDefaultCallerId =
          raw.isDefaultCallerId === undefined ? undefined : Boolean(raw.isDefaultCallerId);
        return {
          ok: true,
          value: {
            configId: raw.configId,
            address,
            inboundWorkflowId,
            countryCode,
            label,
            isDefaultCallerId,
          },
        };
      },
      async (params, config, runCtx) => {
        const result = await executeAssignPhoneNumber(config, params);
        ctx.logger.info("NoralVoice assign_phone_number_to_workflow ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          configId: params.configId,
          address: params.address,
          inboundWorkflowId: params.inboundWorkflowId,
          providerSyncOk: result.data.providerSyncOk,
        });
        return result;
      },
    );

    // ---- Phase 9C: Tier-1 write tools ------------------------------------

    // ---- create_workflow -------------------------------------------------
    registerTool<{ name: string; workflowDefinition?: Record<string, unknown> }>(
      CREATE_WORKFLOW_TOOL_NAME,
      (raw) => {
        const name = isNonEmptyString(raw.name) ? raw.name.trim() : "";
        if (!name) return { ok: false, error: `${CREATE_WORKFLOW_TOOL_NAME}.name is required.` };
        if (name.length > 200) {
          return { ok: false, error: `${CREATE_WORKFLOW_TOOL_NAME}.name exceeds 200-char limit.` };
        }
        let workflowDefinition: Record<string, unknown> | undefined;
        if (raw.workflowDefinition !== undefined) {
          if (
            typeof raw.workflowDefinition !== "object" ||
            Array.isArray(raw.workflowDefinition) ||
            raw.workflowDefinition === null
          ) {
            return { ok: false, error: `${CREATE_WORKFLOW_TOOL_NAME}.workflowDefinition must be an object.` };
          }
          workflowDefinition = raw.workflowDefinition as Record<string, unknown>;
        }
        return { ok: true, value: { name, workflowDefinition } };
      },
      async (params, config, runCtx) => {
        const result = await executeCreateWorkflow(config, params);
        ctx.logger.info("NoralVoice create_workflow ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          workflowId: result.data.id,
          workflowUuid: result.data.workflow_uuid,
        });
        return result;
      },
    );

    // ---- save_workflow ----------------------------------------------------
    registerTool<{
      workflowId: number;
      name?: string;
      workflowDefinition: Record<string, unknown>;
    }>(
      SAVE_WORKFLOW_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.workflowId !== "number" ||
          !Number.isInteger(raw.workflowId) ||
          raw.workflowId < 1
        ) {
          return { ok: false, error: `${SAVE_WORKFLOW_TOOL_NAME}.workflowId must be a positive integer.` };
        }
        let name: string | undefined;
        if (raw.name !== undefined) {
          if (!isNonEmptyString(raw.name)) {
            return { ok: false, error: `${SAVE_WORKFLOW_TOOL_NAME}.name must be a non-empty string.` };
          }
          if (raw.name.length > 200) {
            return { ok: false, error: `${SAVE_WORKFLOW_TOOL_NAME}.name exceeds 200-char limit.` };
          }
          name = raw.name;
        }
        if (
          !raw.workflowDefinition ||
          typeof raw.workflowDefinition !== "object" ||
          Array.isArray(raw.workflowDefinition)
        ) {
          return { ok: false, error: `${SAVE_WORKFLOW_TOOL_NAME}.workflowDefinition is required and must be an object.` };
        }
        return {
          ok: true,
          value: {
            workflowId: raw.workflowId,
            name,
            workflowDefinition: raw.workflowDefinition as Record<string, unknown>,
          },
        };
      },
      async (params, config, runCtx) => {
        const result = await executeSaveWorkflow(config, params);
        ctx.logger.info("NoralVoice save_workflow ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          workflowId: params.workflowId,
        });
        return result;
      },
    );

    // ---- create_campaign -------------------------------------------------
    registerTool<{
      name: string;
      workflowId: number;
      sourceType: "google-sheet" | "csv";
      sourceId: string;
      telephonyConfigurationId?: number;
      maxConcurrency?: number;
    }>(
      CREATE_CAMPAIGN_TOOL_NAME,
      (raw) => {
        const name = isNonEmptyString(raw.name) ? raw.name.trim() : "";
        if (!name) return { ok: false, error: `${CREATE_CAMPAIGN_TOOL_NAME}.name is required.` };
        if (name.length > 200) {
          return { ok: false, error: `${CREATE_CAMPAIGN_TOOL_NAME}.name exceeds 200-char limit.` };
        }
        if (
          typeof raw.workflowId !== "number" ||
          !Number.isInteger(raw.workflowId) ||
          raw.workflowId < 1
        ) {
          return { ok: false, error: `${CREATE_CAMPAIGN_TOOL_NAME}.workflowId must be a positive integer.` };
        }
        if (raw.sourceType !== "google-sheet" && raw.sourceType !== "csv") {
          return { ok: false, error: `${CREATE_CAMPAIGN_TOOL_NAME}.sourceType must be 'google-sheet' or 'csv'.` };
        }
        const sourceId = isNonEmptyString(raw.sourceId) ? raw.sourceId : "";
        if (!sourceId) return { ok: false, error: `${CREATE_CAMPAIGN_TOOL_NAME}.sourceId is required.` };
        let telephonyConfigurationId: number | undefined;
        if (raw.telephonyConfigurationId !== undefined) {
          if (
            typeof raw.telephonyConfigurationId !== "number" ||
            !Number.isInteger(raw.telephonyConfigurationId) ||
            raw.telephonyConfigurationId < 1
          ) {
            return { ok: false, error: `${CREATE_CAMPAIGN_TOOL_NAME}.telephonyConfigurationId must be a positive integer.` };
          }
          telephonyConfigurationId = raw.telephonyConfigurationId;
        }
        let maxConcurrency: number | undefined;
        if (raw.maxConcurrency !== undefined) {
          if (
            typeof raw.maxConcurrency !== "number" ||
            !Number.isInteger(raw.maxConcurrency) ||
            raw.maxConcurrency < 1 ||
            raw.maxConcurrency > 100
          ) {
            return { ok: false, error: `${CREATE_CAMPAIGN_TOOL_NAME}.maxConcurrency must be an integer 1..100.` };
          }
          maxConcurrency = raw.maxConcurrency;
        }
        return {
          ok: true,
          value: {
            name,
            workflowId: raw.workflowId,
            sourceType: raw.sourceType,
            sourceId,
            telephonyConfigurationId,
            maxConcurrency,
          },
        };
      },
      async (params, config, runCtx) => {
        const result = await executeCreateCampaign(config, params);
        ctx.logger.info("NoralVoice create_campaign ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          campaignId: result.data.id,
        });
        return result;
      },
    );

    // ---- start_campaign --------------------------------------------------
    registerTool<{ campaignId: number }>(
      START_CAMPAIGN_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.campaignId !== "number" ||
          !Number.isInteger(raw.campaignId) ||
          raw.campaignId < 1
        ) {
          return { ok: false, error: `${START_CAMPAIGN_TOOL_NAME}.campaignId must be a positive integer.` };
        }
        return { ok: true, value: { campaignId: raw.campaignId } };
      },
      async (params, config, runCtx) => {
        const result = await executeStartCampaign(config, params);
        ctx.logger.info("NoralVoice start_campaign ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          campaignId: params.campaignId,
          status: result.data.status,
        });
        return result;
      },
    );

    // ---- upload_kb_document ----------------------------------------------
    registerTool<{ filename: string; contentBase64: string; contentType?: string }>(
      UPLOAD_KB_DOCUMENT_TOOL_NAME,
      (raw) => {
        const filename = isNonEmptyString(raw.filename) ? raw.filename : "";
        if (!filename) {
          return { ok: false, error: `${UPLOAD_KB_DOCUMENT_TOOL_NAME}.filename is required.` };
        }
        if (filename.length > 256) {
          return { ok: false, error: `${UPLOAD_KB_DOCUMENT_TOOL_NAME}.filename exceeds 256-char limit.` };
        }
        const contentBase64 = isNonEmptyString(raw.contentBase64) ? raw.contentBase64 : "";
        if (!contentBase64) {
          return {
            ok: false,
            error: `${UPLOAD_KB_DOCUMENT_TOOL_NAME}.contentBase64 is required (base64-encoded bytes; URL uploads are not supported).`,
          };
        }
        let contentType: string | undefined;
        if (raw.contentType !== undefined) {
          if (!isNonEmptyString(raw.contentType) || raw.contentType.length > 128) {
            return { ok: false, error: `${UPLOAD_KB_DOCUMENT_TOOL_NAME}.contentType must be a non-empty string ≤128 chars.` };
          }
          contentType = raw.contentType;
        }
        return { ok: true, value: { filename, contentBase64, contentType } };
      },
      async (params, config, runCtx) => {
        const result = await executeUploadKbDocument(config, params);
        ctx.logger.info("NoralVoice upload_kb_document ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          documentUuid: result.data.document_uuid,
          filename: params.filename,
        });
        return result;
      },
    );

    // ---- add_workflow_tool -----------------------------------------------
    registerTool<{ name: string; description: string; toolDefinition: Record<string, unknown> }>(
      ADD_WORKFLOW_TOOL_TOOL_NAME,
      (raw) => {
        const name = isNonEmptyString(raw.name) ? raw.name : "";
        if (!name) return { ok: false, error: `${ADD_WORKFLOW_TOOL_TOOL_NAME}.name is required.` };
        if (name.length > 128) {
          return { ok: false, error: `${ADD_WORKFLOW_TOOL_TOOL_NAME}.name exceeds 128-char limit.` };
        }
        const description = isNonEmptyString(raw.description) ? raw.description : "";
        if (!description) {
          return { ok: false, error: `${ADD_WORKFLOW_TOOL_TOOL_NAME}.description is required.` };
        }
        if (description.length > 1000) {
          return { ok: false, error: `${ADD_WORKFLOW_TOOL_TOOL_NAME}.description exceeds 1000-char limit.` };
        }
        if (
          !raw.toolDefinition ||
          typeof raw.toolDefinition !== "object" ||
          Array.isArray(raw.toolDefinition)
        ) {
          return { ok: false, error: `${ADD_WORKFLOW_TOOL_TOOL_NAME}.toolDefinition is required and must be an object.` };
        }
        return {
          ok: true,
          value: {
            name,
            description,
            toolDefinition: raw.toolDefinition as Record<string, unknown>,
          },
        };
      },
      async (params, config, runCtx) => {
        const result = await executeAddWorkflowTool(config, params);
        ctx.logger.info("NoralVoice add_workflow_tool ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          toolUuid: result.data.tool_uuid,
        });
        return result;
      },
    );

    // ---- update_workflow_tool --------------------------------------------
    registerTool<{
      toolUuid: string;
      name?: string;
      description?: string;
      toolDefinition?: Record<string, unknown>;
    }>(
      UPDATE_WORKFLOW_TOOL_TOOL_NAME,
      (raw) => {
        const toolUuid = isNonEmptyString(raw.toolUuid) ? raw.toolUuid : "";
        if (!toolUuid) {
          return { ok: false, error: `${UPDATE_WORKFLOW_TOOL_TOOL_NAME}.toolUuid is required.` };
        }
        if (toolUuid.length > 64) {
          return { ok: false, error: `${UPDATE_WORKFLOW_TOOL_TOOL_NAME}.toolUuid exceeds 64-char limit.` };
        }
        let name: string | undefined;
        if (raw.name !== undefined) {
          if (!isNonEmptyString(raw.name) || raw.name.length > 128) {
            return { ok: false, error: `${UPDATE_WORKFLOW_TOOL_TOOL_NAME}.name must be a non-empty string ≤128 chars.` };
          }
          name = raw.name;
        }
        let description: string | undefined;
        if (raw.description !== undefined) {
          if (!isNonEmptyString(raw.description) || raw.description.length > 1000) {
            return { ok: false, error: `${UPDATE_WORKFLOW_TOOL_TOOL_NAME}.description must be a non-empty string ≤1000 chars.` };
          }
          description = raw.description;
        }
        let toolDefinition: Record<string, unknown> | undefined;
        if (raw.toolDefinition !== undefined) {
          if (
            typeof raw.toolDefinition !== "object" ||
            Array.isArray(raw.toolDefinition) ||
            raw.toolDefinition === null
          ) {
            return { ok: false, error: `${UPDATE_WORKFLOW_TOOL_TOOL_NAME}.toolDefinition must be an object.` };
          }
          toolDefinition = raw.toolDefinition as Record<string, unknown>;
        }
        return { ok: true, value: { toolUuid, name, description, toolDefinition } };
      },
      async (params, config, runCtx) => {
        const result = await executeUpdateWorkflowTool(config, params);
        ctx.logger.info("NoralVoice update_workflow_tool ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          toolUuid: params.toolUuid,
        });
        return result;
      },
    );

    // ---- delete_workflow_tool --------------------------------------------
    registerTool<{ toolUuid: string }>(
      DELETE_WORKFLOW_TOOL_TOOL_NAME,
      (raw) => {
        const toolUuid = isNonEmptyString(raw.toolUuid) ? raw.toolUuid : "";
        if (!toolUuid) {
          return { ok: false, error: `${DELETE_WORKFLOW_TOOL_TOOL_NAME}.toolUuid is required.` };
        }
        if (toolUuid.length > 64) {
          return { ok: false, error: `${DELETE_WORKFLOW_TOOL_TOOL_NAME}.toolUuid exceeds 64-char limit.` };
        }
        return { ok: true, value: { toolUuid } };
      },
      async (params, config, runCtx) => {
        const result = await executeDeleteWorkflowTool(config, params);
        ctx.logger.info("NoralVoice delete_workflow_tool ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          toolUuid: params.toolUuid,
        });
        return result;
      },
    );

    // ---- Phase 9C: Tier-2 read tools -------------------------------------

    // ---- get_run_detail --------------------------------------------------
    registerTool<{ runId: string }>(
      GET_RUN_DETAIL_TOOL_NAME,
      (raw) => {
        const runId = isNonEmptyString(raw.runId) ? raw.runId : "";
        if (!runId) {
          return { ok: false, error: `${GET_RUN_DETAIL_TOOL_NAME}.runId is required.` };
        }
        if (runId.length > 64) {
          return { ok: false, error: `${GET_RUN_DETAIL_TOOL_NAME}.runId exceeds 64-char limit.` };
        }
        return { ok: true, value: { runId } };
      },
      async (params, config) => executeGetRunDetail(config, params),
    );

    // ---- list_recordings -------------------------------------------------
    registerTool<{ workflowId?: number; limit?: number }>(
      LIST_RECORDINGS_TOOL_NAME,
      (raw) => {
        let workflowId: number | undefined;
        if (raw.workflowId !== undefined) {
          if (
            typeof raw.workflowId !== "number" ||
            !Number.isInteger(raw.workflowId) ||
            raw.workflowId < 1
          ) {
            return { ok: false, error: `${LIST_RECORDINGS_TOOL_NAME}.workflowId must be a positive integer.` };
          }
          workflowId = raw.workflowId;
        }
        let limit: number | undefined;
        if (raw.limit !== undefined) {
          if (
            typeof raw.limit !== "number" ||
            !Number.isInteger(raw.limit) ||
            raw.limit < 1 ||
            raw.limit > 100
          ) {
            return { ok: false, error: `${LIST_RECORDINGS_TOOL_NAME}.limit must be an integer 1..100.` };
          }
          limit = raw.limit;
        }
        return { ok: true, value: { workflowId, limit } };
      },
      async (params, config) => executeListRecordings(config, params),
    );

    // ---- get_recording_download_url -------------------------------------
    registerTool<{ recordingId: number }>(
      GET_RECORDING_DOWNLOAD_URL_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.recordingId !== "number" ||
          !Number.isInteger(raw.recordingId) ||
          raw.recordingId < 1
        ) {
          return {
            ok: false,
            error: `${GET_RECORDING_DOWNLOAD_URL_TOOL_NAME}.recordingId must be a positive integer.`,
          };
        }
        return { ok: true, value: { recordingId: raw.recordingId } };
      },
      async (params, config) => executeGetRecordingDownloadUrl(config, params),
    );

    // ---- list_kb_documents -----------------------------------------------
    registerTool<{ status?: string; limit?: number }>(
      LIST_KB_DOCUMENTS_TOOL_NAME,
      (raw) => {
        const status = isNonEmptyString(raw.status) ? raw.status : undefined;
        if (status !== undefined && status.length > 32) {
          return { ok: false, error: `${LIST_KB_DOCUMENTS_TOOL_NAME}.status exceeds 32-char limit.` };
        }
        let limit: number | undefined;
        if (raw.limit !== undefined) {
          if (
            typeof raw.limit !== "number" ||
            !Number.isInteger(raw.limit) ||
            raw.limit < 1 ||
            raw.limit > 100
          ) {
            return { ok: false, error: `${LIST_KB_DOCUMENTS_TOOL_NAME}.limit must be an integer 1..100.` };
          }
          limit = raw.limit;
        }
        return { ok: true, value: { status, limit } };
      },
      async (params, config) => executeListKbDocuments(config, params),
    );

    // ---- get_daily_report -----------------------------------------------
    registerTool<{ date?: string }>(
      GET_DAILY_REPORT_TOOL_NAME,
      (raw) => {
        let date: string | undefined;
        if (raw.date !== undefined) {
          if (!isNonEmptyString(raw.date) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
            return {
              ok: false,
              error: `${GET_DAILY_REPORT_TOOL_NAME}.date must be an ISO-8601 date (YYYY-MM-DD).`,
            };
          }
          date = raw.date;
        }
        return { ok: true, value: { date } };
      },
      async (params, config) => executeGetDailyReport(config, params),
    );

    // ---- pause_campaign --------------------------------------------------
    registerTool<{ campaignId: number }>(
      PAUSE_CAMPAIGN_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.campaignId !== "number" ||
          !Number.isInteger(raw.campaignId) ||
          raw.campaignId < 1
        ) {
          return { ok: false, error: `${PAUSE_CAMPAIGN_TOOL_NAME}.campaignId must be a positive integer.` };
        }
        return { ok: true, value: { campaignId: raw.campaignId } };
      },
      async (params, config, runCtx) => {
        const result = await executePauseCampaign(config, params);
        ctx.logger.info("NoralVoice pause_campaign ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          campaignId: params.campaignId,
          status: result.data.status,
        });
        return result;
      },
    );

    // ---- resume_campaign -------------------------------------------------
    registerTool<{ campaignId: number }>(
      RESUME_CAMPAIGN_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.campaignId !== "number" ||
          !Number.isInteger(raw.campaignId) ||
          raw.campaignId < 1
        ) {
          return { ok: false, error: `${RESUME_CAMPAIGN_TOOL_NAME}.campaignId must be a positive integer.` };
        }
        return { ok: true, value: { campaignId: raw.campaignId } };
      },
      async (params, config, runCtx) => {
        const result = await executeResumeCampaign(config, params);
        ctx.logger.info("NoralVoice resume_campaign ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          campaignId: params.campaignId,
          status: result.data.status,
        });
        return result;
      },
    );

    // ---- redial_campaign -------------------------------------------------
    registerTool<{
      campaignId: number;
      name?: string;
      retryOnVoicemail?: boolean;
      retryOnNoAnswer?: boolean;
      retryOnBusy?: boolean;
    }>(
      REDIAL_CAMPAIGN_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.campaignId !== "number" ||
          !Number.isInteger(raw.campaignId) ||
          raw.campaignId < 1
        ) {
          return { ok: false, error: `${REDIAL_CAMPAIGN_TOOL_NAME}.campaignId must be a positive integer.` };
        }
        let name: string | undefined;
        if (raw.name !== undefined) {
          if (typeof raw.name !== "string" || raw.name.length === 0 || raw.name.length > 256) {
            return { ok: false, error: `${REDIAL_CAMPAIGN_TOOL_NAME}.name must be a non-empty string ≤256 chars.` };
          }
          name = raw.name;
        }
        const retryOnVoicemail =
          raw.retryOnVoicemail !== undefined ? Boolean(raw.retryOnVoicemail) : undefined;
        const retryOnNoAnswer =
          raw.retryOnNoAnswer !== undefined ? Boolean(raw.retryOnNoAnswer) : undefined;
        const retryOnBusy =
          raw.retryOnBusy !== undefined ? Boolean(raw.retryOnBusy) : undefined;
        return {
          ok: true,
          value: { campaignId: raw.campaignId, name, retryOnVoicemail, retryOnNoAnswer, retryOnBusy },
        };
      },
      async (params, config, runCtx) => {
        const result = await executeRedialCampaign(config, params);
        ctx.logger.info("NoralVoice redial_campaign ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          sourceCampaignId: params.campaignId,
          newCampaignId: result.data.id,
        });
        return result;
      },
    );

    // ---- create_persistent_embed_token -----------------------------------
    registerTool<{ workflowId: number; expiresInDays?: number }>(
      CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.workflowId !== "number" ||
          !Number.isInteger(raw.workflowId) ||
          raw.workflowId < 1
        ) {
          return { ok: false, error: `${CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME}.workflowId must be a positive integer.` };
        }
        let expiresInDays: number | undefined;
        if (raw.expiresInDays !== undefined) {
          if (
            typeof raw.expiresInDays !== "number" ||
            !Number.isInteger(raw.expiresInDays) ||
            raw.expiresInDays < 1 ||
            raw.expiresInDays > 365
          ) {
            return { ok: false, error: `${CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME}.expiresInDays must be an integer 1..365.` };
          }
          expiresInDays = raw.expiresInDays;
        }
        return { ok: true, value: { workflowId: raw.workflowId, expiresInDays } };
      },
      async (params, config, runCtx) => {
        const result = await executeCreatePersistentEmbedToken(
          config,
          params,
          ctx.state,
          runCtx.companyId,
        );
        ctx.logger.info("NoralVoice create_persistent_embed_token ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          workflowId: params.workflowId,
          ref: result.data.embed_token_ref,
        });
        return result;
      },
    );

    // ---- get_persistent_embed_token --------------------------------------
    registerTool<{ workflowId: number }>(
      GET_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.workflowId !== "number" ||
          !Number.isInteger(raw.workflowId) ||
          raw.workflowId < 1
        ) {
          return { ok: false, error: `${GET_PERSISTENT_EMBED_TOKEN_TOOL_NAME}.workflowId must be a positive integer.` };
        }
        return { ok: true, value: { workflowId: raw.workflowId } };
      },
      async (params, config, runCtx) => {
        const result = await executeGetPersistentEmbedToken(
          config,
          params,
          ctx.state,
          runCtx.companyId,
        );
        ctx.logger.info("NoralVoice get_persistent_embed_token ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          workflowId: params.workflowId,
          found: result.data.embed_token_ref !== null,
        });
        return result;
      },
    );

    // ---- revoke_persistent_embed_token -----------------------------------
    registerTool<{ workflowId: number }>(
      REVOKE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
      (raw) => {
        if (
          typeof raw.workflowId !== "number" ||
          !Number.isInteger(raw.workflowId) ||
          raw.workflowId < 1
        ) {
          return { ok: false, error: `${REVOKE_PERSISTENT_EMBED_TOKEN_TOOL_NAME}.workflowId must be a positive integer.` };
        }
        return { ok: true, value: { workflowId: raw.workflowId } };
      },
      async (params, config, runCtx) => {
        const result = await executeRevokePersistentEmbedToken(
          config,
          params,
          ctx.state,
          runCtx.companyId,
        );
        ctx.logger.info("NoralVoice revoke_persistent_embed_token ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          workflowId: params.workflowId,
        });
        return result;
      },
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
    // Phase 5d — also publish the reverse-RPC callback URL so
    // NoralVoice's `noralos://` tool executor knows where to POST.
    // The URL reuses the webhook pattern (so we don't need a host-
    // side apiRoute registration); HMAC verification lives in the
    // `onWebhook` handler keyed on
    // REVERSE_TOOL_WEBHOOK_ENDPOINT_KEY.
    const reverseRpcUrl =
      `${hostBaseUrl.replace(/\/+$/, "")}` +
      `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/webhooks/${REVERSE_TOOL_WEBHOOK_ENDPOINT_KEY}` +
      `?company=${encodeURIComponent(companyId)}`;
    // Per-company HMAC key for reverse-RPC inbound dispatches.
    // Generated server-side — NoralVoice stores it but never shares
    // it back to anyone; the plugin uses it to verify
    // `X-Noralos-Signature` on inbound POSTs.
    const reverseRpcSecret = randomBytes(32).toString("base64url");

    try {
      const registration = await registerIntegrationWebhook(
        { baseUrl: parsed.baseUrl, apiKey },
        {
          eventType: "run.completed",
          targetUrl,
          reverseRpcUrl,
          reverseRpcSecret,
        },
      );
      // Prefer the secret echoed by NoralVoice (in case the server
      // assigned one); fall back to the one we generated.
      const persistedReverseSecret =
        registration.reverseRpcSecret ?? reverseRpcSecret;
      await ctx.state.set(stateScope, {
        webhookId: registration.id,
        secret: registration.secret,
        reverseRpcSecret: persistedReverseSecret,
      });
      ctx.logger.info("NoralVoice onConfigChanged: webhook + reverse-RPC registered", {
        webhookId: registration.id,
        reverseRpcEnabled: true,
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
    // Phase 5d — route inbound `noralos://` reverse-RPC dispatches
    // through the reverse-tool handler. The host doesn't know how to
    // verify per-company HMAC on these (the secret is plugin-owned),
    // so the worker does it inline before invoking onReverseTool.
    if (input.endpointKey === REVERSE_TOOL_WEBHOOK_ENDPOINT_KEY) {
      await handleReverseToolWebhook(input);
      return;
    }
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

    // Phase 4 B4 dedup: the live transcript pump (server-side service)
    // may have already streamed extracted_variable events for keys
    // present in this webhook's `extracted_variables` blob. Ask the
    // pump for the set of keys it emitted and strip them from the
    // webhook payload before re-emitting, so the originating agent
    // doesn't see duplicates.
    //
    // The pump exposes its set via an HTTP query against the host
    // ('/internal/voice-transcript-pump/emitted-keys?runId=...'); we
    // skip it if the host doesn't surface that endpoint (graceful
    // degradation — duplicates are annoying but not broken).
    const runId =
      typeof (payload as { run_id?: unknown }).run_id === "string"
        ? ((payload as { run_id?: string }).run_id as string)
        : null;
    let dedupPayload: Record<string, unknown> = payload as Record<string, unknown>;
    if (runId) {
      try {
        const probe = await fetch(
          `/internal/voice-transcript-pump/emitted-keys?companyId=${encodeURIComponent(companyId)}&runId=${encodeURIComponent(runId)}`,
          { headers: { Accept: "application/json" } },
        );
        if (probe.ok) {
          const body = (await probe.json().catch(() => ({}))) as { keys?: string[] };
          const emittedKeys = new Set(Array.isArray(body.keys) ? body.keys : []);
          const evRaw = (dedupPayload as { extracted_variables?: unknown }).extracted_variables;
          if (evRaw && typeof evRaw === "object" && !Array.isArray(evRaw)) {
            const ev = evRaw as Record<string, unknown>;
            const filtered: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(ev)) {
              if (!emittedKeys.has(k)) filtered[k] = v;
            }
            dedupPayload = { ...dedupPayload, extracted_variables: filtered };
          }
        }
      } catch {
        // Best-effort — proceed with the un-deduped payload.
      }
    }

    // Emit on the NoralOS event bus — this is what wakes the originating
    // agent. The payload keys mirror the v1 schema PR-A defined.
    await ctx.events.emit(
      "noralai.noralvoice.run.completed",
      companyId,
      dedupPayload,
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

    // ---- Phase 3 board routes -------------------------------------------
    //
    // The plugin SDK doesn't expose direct DB to onApiRequest closures
    // (the per-tool side-effect helpers I bound during `setup` aren't
    // in scope here), so these routes call the SDK's queryHostDb path
    // through the same casting pattern used in setup().
    type HostQuery = (sql: string, params: unknown[]) => Promise<unknown>;
    const hostDb = (
      ctx as unknown as { host?: { queryHostDb?: HostQuery } }
    ).host?.queryHostDb;

    async function lookupVoiceAgentUuidForAgent(
      companyId: string,
      agentId: string,
    ): Promise<string | null> {
      if (!hostDb) return null;
      const rows = (await hostDb(
        `SELECT voice_agent_uuid FROM public.agents WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [agentId, companyId],
      )) as Array<{ voice_agent_uuid: string | null }> | null;
      return (Array.isArray(rows) ? rows[0]?.voice_agent_uuid : null) ?? null;
    }

    if (input.routeKey === "get_agent_voice_config") {
      const agentId = input.params?.agentId as string | undefined;
      const companyId = (input as unknown as { companyId?: string }).companyId;
      if (!agentId || !companyId) {
        return { status: 400, body: { error: "agentId path param and companyId query are required" } };
      }
      const uuid = await lookupVoiceAgentUuidForAgent(companyId, agentId);
      if (!uuid) {
        return { status: 200, body: { voice_agent_uuid: null } };
      }
      const config = await resolveClientConfig(ctx, null);
      if ("error" in config) return { status: 400, body: { error: config.error } };
      try {
        const workflow = await getWorkflowByUuid(config, uuid);
        if (!workflow) {
          // Stored uuid but NV doesn't recognise it — likely deleted from
          // the NV side. Surface as 404 so the UI can prompt re-provisioning.
          return {
            status: 404,
            body: {
              voice_agent_uuid: uuid,
              error: "voice agent not found in NoralVoice",
            },
          };
        }
        const voice = extractVoiceSettings(workflow);
        return {
          status: 200,
          body: {
            voice_agent_uuid: uuid,
            workflow_name: workflow.name,
            provider: voice.provider,
            voice_id: voice.voiceId,
            provider_options: voice.providerOptions ?? null,
          },
        };
      } catch (err) {
        const { safe, httpStatus } = normaliseFailure(err);
        return {
          status: httpStatus && httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
          body: { error: safe },
        };
      }
    }

    if (input.routeKey === "provision_voice_for_agent") {
      const agentId = input.params?.agentId as string | undefined;
      const companyId = (input as unknown as { companyId?: string }).companyId;
      if (!agentId || !companyId) {
        return { status: 400, body: { error: "agentId path param and companyId query are required" } };
      }
      const body =
        input.body && typeof input.body === "object"
          ? (input.body as Record<string, unknown>)
          : {};
      const displayName =
        typeof body.displayName === "string" ? (body.displayName as string) : undefined;

      const config = await resolveClientConfig(ctx, null);
      if ("error" in config) return { status: 400, body: { error: config.error } };
      if (!hostDb) return { status: 500, body: { error: "Host DB unavailable" } };

      const result = await executeProvisionVoiceAgent(
        config,
        { noralosAgentId: agentId, displayName },
        {
          resolveVoiceAgentUuid: async (id) => lookupVoiceAgentUuidForAgent(companyId, id),
          resolveAgentName: async (id) => {
            const rows = (await hostDb(
              `SELECT name FROM public.agents WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
              [id, companyId],
            )) as Array<{ name: string | null }> | null;
            return (Array.isArray(rows) ? rows[0]?.name : null) ?? null;
          },
          writeVoiceAgentUuid: async (id, uuid) => {
            await hostDb(
              `UPDATE public.agents SET voice_agent_uuid = $1, updated_at = now() WHERE id = $2::uuid AND company_id = $3::uuid`,
              [uuid, id, companyId],
            );
          },
        },
      );
      if (!result.ok) {
        return {
          status: result.error === "ALREADY_PROVISIONED" ? 409 : 400,
          body: { error: result.message, code: result.error, voice_agent_uuid: result.voice_agent_uuid },
        };
      }
      return { status: 200, body: result.data };
    }

    if (input.routeKey === "list_voices_board") {
      const providerParam =
        typeof input.query.provider === "string" ? (input.query.provider as string) : undefined;
      if (
        providerParam &&
        !["elevenlabs", "deepgram", "sarvam", "cartesia", "dograh", "rime"].includes(providerParam)
      ) {
        return { status: 400, body: { error: "Unknown provider filter" } };
      }
      const config = await resolveClientConfig(ctx, null);
      if ("error" in config) return { status: 400, body: { error: config.error } };
      try {
        const result = await executeListVoices(config, {
          provider: providerParam as NoralVoiceTTSProvider | undefined,
        });
        return { status: 200, body: { voices: result.data.voices } };
      } catch (err) {
        const { safe, httpStatus } = normaliseFailure(err);
        return {
          status: httpStatus && httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
          body: { error: safe },
        };
      }
    }

    if (input.routeKey === "set_agent_voice_config") {
      const agentId = input.params?.agentId as string | undefined;
      const companyId = (input as unknown as { companyId?: string }).companyId;
      if (!agentId || !companyId) {
        return { status: 400, body: { error: "agentId path param and companyId query are required" } };
      }
      const body =
        input.body && typeof input.body === "object"
          ? (input.body as Record<string, unknown>)
          : {};
      const provider = body.provider;
      const voiceId = body.voiceId;
      const voiceOptions =
        body.voiceOptions && typeof body.voiceOptions === "object" && !Array.isArray(body.voiceOptions)
          ? (body.voiceOptions as Record<string, unknown>)
          : undefined;
      if (
        typeof provider !== "string" ||
        !["elevenlabs", "deepgram", "sarvam", "cartesia", "dograh", "rime"].includes(provider)
      ) {
        return { status: 400, body: { error: "provider must be one of the six supported TTS providers" } };
      }
      if (typeof voiceId !== "string" || voiceId.length === 0) {
        return { status: 400, body: { error: "voiceId is required" } };
      }
      const config = await resolveClientConfig(ctx, null);
      if ("error" in config) return { status: 400, body: { error: config.error } };
      if (!hostDb) return { status: 500, body: { error: "Host DB unavailable" } };

      const result = await executeSetAgentVoice(
        config,
        {
          noralosAgentId: agentId,
          provider: provider as NoralVoiceTTSProvider,
          voiceId,
          voiceOptions,
        },
        {
          companyId,
          resolveVoiceAgentUuid: async (id) => lookupVoiceAgentUuidForAgent(companyId, id),
          mirrorToVoiceConfig: async (args) => mirrorToVoiceConfig(hostDb, args),
        },
      );
      if (!result.ok) {
        return { status: 409, body: { error: result.message, code: result.error } };
      }
      return { status: 200, body: result.data };
    }

    // ── Phase 4 PR-A: browse surfaces ────────────────────────────────
    //
    // Each route follows the same shape:
    //   1. Resolve client config (apiKey from secrets).
    //   2. Translate inputs to typed params.
    //   3. Call the noralvoice-client helper.
    //   4. Map NV errors to a uniform `{ ok: false, error, status, message }`
    //      response so the UI's react-query layer renders consistent
    //      error states.
    if (
      input.routeKey === "list_runs" ||
      input.routeKey === "get_run_detail" ||
      input.routeKey === "list_recordings" ||
      input.routeKey === "get_recording_download_url" ||
      input.routeKey === "search_kb" ||
      input.routeKey === "list_kb_documents" ||
      input.routeKey === "list_campaigns" ||
      input.routeKey === "get_campaign" ||
      input.routeKey === "list_telephony_numbers" ||
      input.routeKey === "list_telephony_providers" ||
      input.routeKey === "get_usage_current"
    ) {
      const config = await resolveClientConfig(ctx, null);
      if ("error" in config) {
        return {
          status: 400,
          body: { ok: false, error: "NO_API_KEY", message: config.error },
        };
      }

      const handler = async (): Promise<{ status: number; body: unknown }> => {
        try {
          // Lazy import — avoids name churn on the top of the worker
          // module while exposing every Phase 4 helper.
          const mod = await import("./noralvoice-client.js");
          switch (input.routeKey) {
            case "list_runs": {
              const workflowUuid =
                typeof input.query.workflowUuid === "string"
                  ? (input.query.workflowUuid as string)
                  : "";
              if (!workflowUuid) {
                return {
                  status: 400,
                  body: { ok: false, error: "BAD_REQUEST", message: "workflowUuid required" },
                };
              }
              const wf = await mod.getWorkflowByUuid(config, workflowUuid);
              if (!wf) {
                return {
                  status: 404,
                  body: { ok: false, error: "NOT_FOUND", message: "workflow not found in NoralVoice" },
                };
              }
              const limit = parseLimit(input.query.limit);
              const cursor =
                typeof input.query.cursor === "string" ? (input.query.cursor as string) : null;
              const page = await mod.listWorkflowRuns(config, wf.id, { limit, cursor });
              return { status: 200, body: page };
            }
            case "get_run_detail": {
              const workflowUuid =
                typeof input.query.workflowUuid === "string"
                  ? (input.query.workflowUuid as string)
                  : "";
              const runId = Number(input.params.runId);
              if (!workflowUuid || !Number.isFinite(runId) || runId <= 0) {
                return {
                  status: 400,
                  body: { ok: false, error: "BAD_REQUEST", message: "workflowUuid + valid runId required" },
                };
              }
              const wf = await mod.getWorkflowByUuid(config, workflowUuid);
              if (!wf) {
                return { status: 404, body: { ok: false, error: "NOT_FOUND" } };
              }
              const run = await mod.getWorkflowRun(config, wf.id, runId);
              return { status: 200, body: run };
            }
            case "list_recordings": {
              const limit = parseLimit(input.query.limit);
              const workflowIdRaw = input.query.workflowId;
              const workflowId =
                typeof workflowIdRaw === "string" && /^\d+$/.test(workflowIdRaw)
                  ? Number.parseInt(workflowIdRaw, 10)
                  : undefined;
              const page = await mod.listRecordings(config, { limit, workflowId });
              return { status: 200, body: page };
            }
            case "get_recording_download_url": {
              const id = Number(input.params.id);
              if (!Number.isFinite(id) || id <= 0) {
                return {
                  status: 400,
                  body: { ok: false, error: "BAD_REQUEST", message: "valid recording id required" },
                };
              }
              const result = await mod.getRecordingDownloadUrl(config, id);
              return { status: 200, body: result };
            }
            case "search_kb": {
              const body =
                input.body && typeof input.body === "object"
                  ? (input.body as Record<string, unknown>)
                  : {};
              const query = typeof body.query === "string" ? body.query : "";
              if (!query) {
                return {
                  status: 400,
                  body: { ok: false, error: "BAD_REQUEST", message: "query is required" },
                };
              }
              const limit = typeof body.limit === "number" ? body.limit : 10;
              const hits = await mod.searchKbDocuments(config, { query, limit });
              return { status: 200, body: hits };
            }
            case "list_kb_documents": {
              const limit = parseLimit(input.query.limit);
              const page = await mod.listKbDocuments(config, { limit });
              return { status: 200, body: page };
            }
            case "list_campaigns": {
              const status =
                typeof input.query.status === "string" ? (input.query.status as string) : undefined;
              const limit = parseLimit(input.query.limit);
              const page = await mod.listCampaigns(config, { status, limit });
              return { status: 200, body: page };
            }
            case "get_campaign": {
              const id = Number(input.params.id);
              if (!Number.isFinite(id) || id <= 0) {
                return {
                  status: 400,
                  body: { ok: false, error: "BAD_REQUEST", message: "valid campaign id required" },
                };
              }
              const campaign = await mod.getCampaign(config, id);
              return { status: 200, body: campaign };
            }
            case "list_telephony_numbers": {
              const numbers = await mod.listTelephonyNumbers(config);
              return { status: 200, body: { numbers } };
            }
            case "list_telephony_providers": {
              const providers = await mod.listTelephonyProviders(config);
              return { status: 200, body: { providers } };
            }
            case "get_usage_current": {
              const usage = await mod.getCurrentPeriodUsage(config);
              return { status: 200, body: usage };
            }
            default:
              return { status: 404, body: { ok: false, error: "Unknown route" } };
          }
        } catch (err) {
          const { safe, category, httpStatus } = normaliseFailure(err);
          const status = httpStatus && httpStatus >= 400 && httpStatus < 500 ? 400 : 502;
          ctx.logger.warn(`NoralVoice route ${input.routeKey} failed`, {
            category,
            httpStatus,
          });
          return {
            status,
            body: {
              ok: false,
              error: category === "HTTP_4XX" ? "NORALVOICE_4XX" : "NORALVOICE_5XX",
              status: httpStatus,
              message: safe,
            },
          };
        }
      };
      return handler();
    }

    // ── Phase 4 PR-B: interact surfaces ──────────────────────────────
    if (input.routeKey === "create_workflow_embed_token") {
      const workflowUuid = input.params.uuid;
      if (!workflowUuid) {
        return {
          status: 400,
          body: { ok: false, error: "BAD_REQUEST", message: "workflow uuid required" },
        };
      }
      const userId =
        (input as unknown as { actor?: { userId?: string | null } }).actor?.userId ?? null;
      if (!userId) {
        return {
          status: 400,
          body: { ok: false, error: "BAD_REQUEST", message: "embed token requires a user-actor context" },
        };
      }
      const config = await resolveClientConfig(ctx, null);
      if ("error" in config) {
        return { status: 400, body: { ok: false, error: "NO_API_KEY", message: config.error } };
      }
      // Resolve the operator's email from better-auth's user table so
      // we can hand it to NoralVoice as target_user_email. The plugin
      // SDK doesn't expose a typed accessor for this; we use the host
      // SQL helper.
      if (!hostDb) {
        return {
          status: 500,
          body: {
            ok: false,
            error: "HOST_DB_UNAVAILABLE",
            message: "ctx.host.queryHostDb is required for embed-token lookups",
          },
        };
      }
      const userRows = (await hostDb(
        `SELECT email FROM "user" WHERE id = $1 LIMIT 1`,
        [userId],
      )) as Array<{ email: string | null }> | null;
      const email = Array.isArray(userRows) ? userRows[0]?.email ?? null : null;
      if (!email) {
        return {
          status: 400,
          body: {
            ok: false,
            error: "NO_OPERATOR_EMAIL",
            message: "Calling user has no email on record",
          },
        };
      }
      try {
        const mod = await import("./noralvoice-client.js");
        const result = await mod.createEmbedExchangeToken(config, {
          targetUserEmail: email,
          targetPath: `/workflow/${workflowUuid}`,
          ttlSeconds: 90,
        });
        return { status: 200, body: result };
      } catch (err) {
        const { safe, category, httpStatus } = normaliseFailure(err);
        return {
          status: httpStatus && httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
          body: {
            ok: false,
            error: category === "HTTP_4XX" ? "NORALVOICE_4XX" : "NORALVOICE_5XX",
            status: httpStatus,
            message: safe,
          },
        };
      }
    }

    // Phase 6 PR-2 — TTS proxy for Dashboard agent-voice autoplay.
    //
    // Browser-side hook posts {text, voiceOverride?}; worker forwards
    // to NoralVoice's /api/v1/public/embed/synthesize via the dual-auth
    // X-API-Key path. The apiKey never reaches the browser. NV returns
    // a pre-signed audio URL with 5-minute TTL.
    //
    // 422 `text_blocked_exfiltration` is surfaced as
    // `{ok: false, reason: "exfiltration-blocked"}` — same contract
    // the autoplay hook expects from voice-cascade. Other errors
    // come back as HTTP 4XX/5XX from the wrapper.
    if (input.routeKey === "synthesize") {
      const body =
        input.body && typeof input.body === "object"
          ? (input.body as {
              text?: unknown;
              voiceOverride?: {
                provider?: unknown;
                voiceId?: unknown;
                model?: unknown;
              };
            })
          : {};
      const text = typeof body.text === "string" ? body.text : "";
      if (!text || text.length === 0) {
        return {
          status: 400,
          body: { ok: false, error: "BAD_REQUEST", message: "text required" },
        };
      }
      const config = await resolveClientConfig(ctx, null);
      if ("error" in config) {
        return { status: 400, body: { ok: false, error: "NO_API_KEY", message: config.error } };
      }
      let voiceOverride: { provider: string; voiceId: string; model: string } | undefined;
      if (body.voiceOverride && typeof body.voiceOverride === "object") {
        const ov = body.voiceOverride;
        if (
          typeof ov.provider === "string" &&
          typeof ov.voiceId === "string" &&
          typeof ov.model === "string"
        ) {
          voiceOverride = {
            provider: ov.provider,
            voiceId: ov.voiceId,
            model: ov.model,
          };
        }
      }
      try {
        const mod = await import("./noralvoice-client.js");
        const result = await mod.synthesizeAudio(config, { text, voiceOverride });
        if (!result.ok) {
          // Exfiltration block — not an error to the caller, just a
          // signal that no audio will be returned for this message.
          return {
            status: 200,
            body: {
              ok: false,
              reason: "exfiltration-blocked",
              matchTypes: result.matchTypes,
            },
          };
        }
        return {
          status: 200,
          body: {
            ok: true,
            audioUrl: result.audioUrl,
            expiresAt: result.expiresAt,
            contentType: result.contentType,
            durationSeconds: result.durationSeconds,
            charCount: result.charCount,
            provider: result.provider,
          },
        };
      } catch (err) {
        const { safe, category, httpStatus } = normaliseFailure(err);
        return {
          status: httpStatus && httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
          body: {
            ok: false,
            error: category === "HTTP_4XX" ? "NORALVOICE_4XX" : "NORALVOICE_5XX",
            status: httpStatus,
            message: safe,
          },
        };
      }
    }

    if (input.routeKey === "transcript_pump_control") {
      // The transcript pump lives in a NoralOS server service
      // (server/src/services/voice-transcript-pump.ts) because the
      // plugin worker model is RPC-shaped — workers respond to
      // discrete calls, not long-lived subscriptions (architecture
      // call documented in the PR description). The plugin's role
      // here is to pass start/stop signals through to the host via
      // events.emit; the real work happens in the host service.
      const body =
        input.body && typeof input.body === "object"
          ? (input.body as { action?: string; runId?: string; workflowUuid?: string })
          : {};
      const action = typeof body.action === "string" ? body.action : "";
      if (action !== "start" && action !== "stop") {
        return {
          status: 400,
          body: { ok: false, error: "BAD_REQUEST", message: "action must be 'start' or 'stop'" },
        };
      }
      try {
        await ctx.events.emit(
          `noralai.noralvoice.transcript_pump.${action}`,
          input.companyId,
          { runId: body.runId, workflowUuid: body.workflowUuid },
        );
      } catch (err) {
        ctx.logger.warn("NoralVoice transcript pump control emit failed", {
          action,
          err: err instanceof Error ? err.message : "unknown",
        });
        return {
          status: 500,
          body: { ok: false, error: "EMIT_FAILED", message: "Could not signal the pump service" },
        };
      }
      return { status: 200, body: { ok: true, action } };
    }

    return { status: 404, body: { error: "Unknown route" } };
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_ID} ready` };
  },

  // ---------------------------------------------------------------------------
  // Phase 5d — onReverseTool. Declarative entrypoint for inbound
  // `noralos://` reverse-tool dispatches. The webhook handler
  // (`handleReverseToolWebhook` above) currently calls
  // `dispatchReverseTool` directly because the host doesn't yet route
  // reverseTools natively; this hook exists for SDK-type consistency
  // and as the future-proof entry point if a later host version
  // promotes reverseTools to a first-class routed surface.
  // ---------------------------------------------------------------------------
  async onReverseTool(input: PluginReverseToolInput): Promise<PluginReverseToolResult> {
    const ctx = requireCtx();
    if (!ctx) {
      return {
        ok: false,
        error: "Plugin context not initialised",
        code: "WORKER_NOT_READY",
      };
    }
    const hostDb = (ctx as unknown as { host?: { queryHostDb?: HostQuery } })
      .host?.queryHostDb;
    return dispatchReverseTool(
      {
        companyId: input.companyId,
        hostDb,
        logger: ctx.logger,
      },
      input.toolName,
      input.args,
    );
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
