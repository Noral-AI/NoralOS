/**
 * NoralSign plugin worker entrypoint.
 *
 * Registers the full contract-routing tool surface against a self-hosted
 * DocuSeal instance, an inbound webhook receiver that republishes
 * lifecycle events on the NoralOS event bus, and a scoped API route the
 * dashboard UI calls to render the templates page.
 *
 * Boundaries:
 *   - Reads `apiUrl` and `apiTokenRef` from the resolved plugin config.
 *     The `apiTokenRef` is a host-secret reference (e.g.
 *     `company-secret:<credential-id>`) resolved through
 *     `ctx.secrets.resolve()` per call — never cached in module state.
 *   - Executive-tier gate: every tool refuses calls from agents whose
 *     role is not in {ceo, cto, cmo, cfo}.
 *   - Logging hygiene: never log resolved tokens, signer emails or
 *     names, custom invitation message bodies, or template/field text.
 *     Errors capture only the plugin-level category and the upstream
 *     HTTP status.
 */

import { definePlugin, runWorker } from "@noralos/plugin-sdk";
import type { PluginContext, ToolRunContext, ToolResult } from "@noralos/plugin-sdk";

import {
  CREATE_SUBMISSION_TOOL_NAME,
  DOCUSEAL_WEBHOOK_ENDPOINT_KEY,
  DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME,
  GET_SUBMISSION_TOOL_NAME,
  GET_TEMPLATE_TOOL_NAME,
  LIST_SUBMISSIONS_TOOL_NAME,
  LIST_TEMPLATES_TOOL_NAME,
  NORALSIGN_ALLOWED_ROLES,
  PLUGIN_ID,
  REMIND_SIGNER_TOOL_NAME,
  VOID_SUBMISSION_TOOL_NAME,
} from "./constants.js";
import {
  type DocusealClientConfig,
  DocusealProviderError,
  createSubmission,
  downloadSignedDocuments,
  getSubmission,
  getTemplate,
  listSubmissions,
  listTemplates,
  remindSigner,
  voidSubmission,
} from "./docuseal-client.js";
import { manifest } from "./manifest.js";

// ---------------------------------------------------------------------------
// Module-scoped plugin context
//
// `setup` is the only hook where the host hands us a `PluginContext`. The
// webhook and api-request hooks are siblings of `setup` in the
// `definePlugin` shape and don't receive ctx, so we capture it here on
// first activation and reuse it from those handlers.
// ---------------------------------------------------------------------------

let pluginCtx: PluginContext | null = null;

function requireCtx(): PluginContext | null {
  return pluginCtx;
}

// ---------------------------------------------------------------------------
// Tier gate
// ---------------------------------------------------------------------------

async function assertExecutiveTier(
  ctx: PluginContext,
  runCtx: ToolRunContext,
): Promise<{ error: string } | null> {
  if (!runCtx.agentId || !runCtx.companyId) {
    return { error: "NoralSign tools require an agent-scoped run context." };
  }
  let agent;
  try {
    agent = await ctx.agents.get(runCtx.agentId, runCtx.companyId);
  } catch (err) {
    ctx.logger.warn("NoralSign tier-gate agent lookup failed", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
      err: err instanceof Error ? err.message : "unknown",
    });
    return { error: "NoralSign could not verify calling agent." };
  }
  if (!agent) return { error: "NoralSign could not verify calling agent." };
  const allowed = (NORALSIGN_ALLOWED_ROLES as readonly string[]).includes(agent.role);
  if (!allowed) {
    ctx.logger.info("NoralSign tier-gate denial", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
      role: agent.role,
    });
    return {
      error:
        "NoralSign tools are restricted to executive-tier agents (CEO, CTO, CMO, CFO). " +
        "Ask an authorised agent to send the contract, or escalate to a human.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Config + secret resolution
// ---------------------------------------------------------------------------

interface ResolvedConfig {
  apiUrl: string;
  apiTokenRef: string;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readConfig(raw: Record<string, unknown>): ResolvedConfig | { error: string } {
  const apiUrl = isString(raw.apiUrl) ? raw.apiUrl.trim() : "";
  const apiTokenRef = isString(raw.apiTokenRef) ? raw.apiTokenRef.trim() : "";
  const missing: string[] = [];
  if (!apiUrl) missing.push("apiUrl");
  if (!apiTokenRef) missing.push("apiTokenRef");
  if (missing.length > 0) {
    return { error: `NoralSign plugin config is missing: ${missing.join(", ")}.` };
  }
  return { apiUrl, apiTokenRef };
}

async function resolveClientConfig(
  ctx: PluginContext,
  runCtx: ToolRunContext,
): Promise<DocusealClientConfig | { error: string }> {
  const config = readConfig(await ctx.config.get());
  if ("error" in config) return { error: config.error };
  let apiToken: string;
  try {
    apiToken = await ctx.secrets.resolve(config.apiTokenRef);
  } catch {
    ctx.logger.error("NoralSign apiToken resolution failed", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
    });
    return {
      error:
        "NoralSign could not resolve the DocuSeal API token. Check Settings → Integrations → NoralSign.",
    };
  }
  if (!apiToken) {
    return {
      error:
        "NoralSign DocuSeal API token credential is empty. Re-enter the credential in Settings → Integrations.",
    };
  }
  return { apiUrl: config.apiUrl, apiToken };
}

// ---------------------------------------------------------------------------
// Per-tool param readers
// ---------------------------------------------------------------------------

type ReadParamsObjectResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

function readParamsObject(raw: unknown, tool: string): ReadParamsObjectResult {
  if (raw == null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${tool} parameters must be an object.` };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

function requirePositiveInteger(
  raw: Record<string, unknown>,
  key: string,
  tool: string,
): number | { error: string } {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return { error: `${tool}.\`${key}\` must be a positive integer.` };
  }
  return value;
}

function optionalString(
  raw: Record<string, unknown>,
  key: string,
  maxLen: number,
  tool: string,
): string | undefined | { error: string } {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    return { error: `${tool}.\`${key}\` must be a non-empty string.` };
  }
  if (value.length > maxLen) {
    return { error: `${tool}.\`${key}\` exceeds the ${maxLen}-char limit.` };
  }
  return value;
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

interface NormalisedFailure {
  safe: string;
  category: string;
  httpStatus?: number;
}

function normaliseFailure(err: unknown): NormalisedFailure {
  if (err instanceof DocusealProviderError) {
    return { safe: err.message, category: err.category, httpStatus: err.status };
  }
  return { safe: "NoralSign request failed for an unknown reason.", category: "unknown" };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;
    const findTool = (name: string) => {
      const tool = manifest.tools?.find((t) => t.name === name);
      if (!tool) throw new Error(`NoralSign worker: tool '${name}' missing from manifest.`);
      return tool;
    };

    type ParamReadResult<T> = { ok: true; value: T } | { ok: false; error: string };
    type ParamReader<T> = (raw: Record<string, unknown>) => ParamReadResult<T>;

    // Common tool-registration wrapper: tier gate + param parse + config +
    // secret resolution + invoke handler. Keeps each tool body to a few lines.
    function registerTool<T>(
      toolName: string,
      readParams: ParamReader<T>,
      executor: (
        params: T,
        config: DocusealClientConfig,
        runCtx: ToolRunContext,
      ) => Promise<ToolResult>,
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
          const denied = await assertExecutiveTier(ctx, runCtx);
          if (denied) return denied;
          const paramObj = readParamsObject(rawParams, toolName);
          if (!paramObj.ok) return { error: paramObj.error };
          const parsed = readParams(paramObj.value);
          if (!parsed.ok) return { error: parsed.error };
          const config = await resolveClientConfig(ctx, runCtx);
          if ("error" in config) return { error: config.error };
          try {
            return await executor(parsed.value, config, runCtx);
          } catch (err) {
            const { safe, category, httpStatus } = normaliseFailure(err);
            ctx.logger.warn(`NoralSign ${toolName} failed`, {
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

    const ok = <T>(value: T): ParamReadResult<T> => ({ ok: true, value });
    const fail = <T>(error: string): ParamReadResult<T> => ({ ok: false, error });

    // ---- list_templates --------------------------------------------------
    registerTool<{ query?: string; limit?: number }>(
      LIST_TEMPLATES_TOOL_NAME,
      (raw) => {
        const query = optionalString(raw, "query", 200, LIST_TEMPLATES_TOOL_NAME);
        if (query && typeof query === "object" && "error" in query) return fail(query.error);
        let limit: number | undefined;
        if (raw.limit !== undefined) {
          if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 100) {
            return fail(`${LIST_TEMPLATES_TOOL_NAME}.\`limit\` must be an integer between 1 and 100.`);
          }
          limit = raw.limit;
        }
        return ok({ query: typeof query === "string" ? query : undefined, limit });
      },
      async (params, config, runCtx) => {
        const result = await listTemplates(config, { query: params.query, limit: params.limit });
        ctx.logger.info("NoralSign list_templates ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          count: result.templates.length,
          latencyMs: result.latencyMs,
        });
        return {
          content:
            result.templates.length === 0
              ? "No NoralSign templates matched."
              : `Found ${result.templates.length} NoralSign template${result.templates.length === 1 ? "" : "s"}.`,
          data: { templates: result.templates, latencyMs: result.latencyMs },
        };
      },
    );

    // ---- get_template ----------------------------------------------------
    registerTool<{ templateId: number }>(
      GET_TEMPLATE_TOOL_NAME,
      (raw) => {
        const templateId = requirePositiveInteger(raw, "templateId", GET_TEMPLATE_TOOL_NAME);
        if (typeof templateId === "object") return fail(templateId.error);
        return ok({ templateId });
      },
      async (params, config) => {
        const template = await getTemplate(config, params.templateId);
        return {
          content: `Template '${template.name}' has ${template.fields.length} fields across ${template.submitters.length || 1} signer role(s).`,
          data: { template },
        };
      },
    );

    // ---- create_submission_from_template ---------------------------------
    interface CreateSubmissionParams {
      templateId: number;
      submitters: Array<{
        name: string;
        email: string;
        role?: string;
        values?: Record<string, string | number | boolean>;
      }>;
      sendEmail?: boolean;
      message?: string;
    }
    registerTool<CreateSubmissionParams>(
      CREATE_SUBMISSION_TOOL_NAME,
      (raw) => {
        const templateId = requirePositiveInteger(raw, "templateId", CREATE_SUBMISSION_TOOL_NAME);
        if (typeof templateId === "object") return fail(templateId.error);
        if (!Array.isArray(raw.submitters) || raw.submitters.length === 0) {
          return fail(`${CREATE_SUBMISSION_TOOL_NAME}.\`submitters\` must be a non-empty array.`);
        }
        const submitters: CreateSubmissionParams["submitters"] = [];
        for (const [i, s] of raw.submitters.entries()) {
          if (!s || typeof s !== "object") {
            return fail(`${CREATE_SUBMISSION_TOOL_NAME}.\`submitters[${i}]\` must be an object.`);
          }
          const so = s as Record<string, unknown>;
          if (typeof so.name !== "string" || so.name.length === 0) {
            return fail(`${CREATE_SUBMISSION_TOOL_NAME}.\`submitters[${i}].name\` is required.`);
          }
          if (typeof so.email !== "string" || so.email.length === 0) {
            return fail(`${CREATE_SUBMISSION_TOOL_NAME}.\`submitters[${i}].email\` is required.`);
          }
          const entry: CreateSubmissionParams["submitters"][number] = {
            name: so.name,
            email: so.email,
          };
          if (typeof so.role === "string" && so.role.length > 0) entry.role = so.role;
          if (so.values && typeof so.values === "object" && !Array.isArray(so.values)) {
            const cleaned: Record<string, string | number | boolean> = {};
            for (const [k, v] of Object.entries(so.values as Record<string, unknown>)) {
              if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") cleaned[k] = v;
            }
            entry.values = cleaned;
          }
          submitters.push(entry);
        }
        const message = optionalString(raw, "message", 2000, CREATE_SUBMISSION_TOOL_NAME);
        if (message && typeof message === "object") return fail(message.error);
        const sendEmail = raw.sendEmail === undefined ? undefined : raw.sendEmail === true;
        return ok({
          templateId,
          submitters,
          sendEmail,
          message: typeof message === "string" ? message : undefined,
        });
      },
      async (params, config, runCtx) => {
        const submission = await createSubmission(config, {
          templateId: params.templateId,
          submitters: params.submitters,
          sendEmail: params.sendEmail,
          message: params.message,
        });
        ctx.logger.info("NoralSign submission created", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          submissionId: submission.id,
          templateId: submission.templateId,
          signerCount: submission.submitters.length,
          // Intentionally NOT logging signer emails/names.
        });
        return {
          content: `Submission ${submission.id} created with ${submission.submitters.length} signer(s).`,
          data: { submission },
        };
      },
    );

    // ---- get_submission --------------------------------------------------
    registerTool<{ submissionId: number }>(
      GET_SUBMISSION_TOOL_NAME,
      (raw) => {
        const submissionId = requirePositiveInteger(raw, "submissionId", GET_SUBMISSION_TOOL_NAME);
        if (typeof submissionId === "object") return fail(submissionId.error);
        return ok({ submissionId });
      },
      async (params, config) => {
        const submission = await getSubmission(config, params.submissionId);
        return {
          content: `Submission ${submission.id} is ${submission.status}.`,
          data: { submission },
        };
      },
    );

    // ---- list_submissions ------------------------------------------------
    registerTool<{ status?: "pending" | "completed" | "declined"; templateId?: number; limit?: number }>(
      LIST_SUBMISSIONS_TOOL_NAME,
      (raw) => {
        let status: "pending" | "completed" | "declined" | undefined;
        if (raw.status !== undefined) {
          if (raw.status !== "pending" && raw.status !== "completed" && raw.status !== "declined") {
            return fail(`${LIST_SUBMISSIONS_TOOL_NAME}.\`status\` must be one of pending, completed, declined.`);
          }
          status = raw.status;
        }
        let templateId: number | undefined;
        if (raw.templateId !== undefined) {
          const v = requirePositiveInteger(raw, "templateId", LIST_SUBMISSIONS_TOOL_NAME);
          if (typeof v === "object") return fail(v.error);
          templateId = v;
        }
        let limit: number | undefined;
        if (raw.limit !== undefined) {
          if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 100) {
            return fail(`${LIST_SUBMISSIONS_TOOL_NAME}.\`limit\` must be an integer between 1 and 100.`);
          }
          limit = raw.limit;
        }
        return ok({ status, templateId, limit });
      },
      async (params, config) => {
        const result = await listSubmissions(config, params);
        return {
          content: `Found ${result.submissions.length} submission${result.submissions.length === 1 ? "" : "s"}.`,
          data: { submissions: result.submissions, latencyMs: result.latencyMs },
        };
      },
    );

    // ---- void_submission -------------------------------------------------
    registerTool<{ submissionId: number; reason?: string }>(
      VOID_SUBMISSION_TOOL_NAME,
      (raw) => {
        const submissionId = requirePositiveInteger(raw, "submissionId", VOID_SUBMISSION_TOOL_NAME);
        if (typeof submissionId === "object") return fail(submissionId.error);
        const reason = optionalString(raw, "reason", 500, VOID_SUBMISSION_TOOL_NAME);
        if (reason && typeof reason === "object") return fail(reason.error);
        return ok({ submissionId, reason: typeof reason === "string" ? reason : undefined });
      },
      async (params, config, runCtx) => {
        await voidSubmission(config, { submissionId: params.submissionId, reason: params.reason });
        ctx.logger.info("NoralSign submission voided", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          submissionId: params.submissionId,
        });
        return {
          content: `Submission ${params.submissionId} voided.`,
          data: { submissionId: params.submissionId },
        };
      },
    );

    // ---- remind_signer ---------------------------------------------------
    registerTool<{ submissionId: number; signerEmail?: string }>(
      REMIND_SIGNER_TOOL_NAME,
      (raw) => {
        const submissionId = requirePositiveInteger(raw, "submissionId", REMIND_SIGNER_TOOL_NAME);
        if (typeof submissionId === "object") return fail(submissionId.error);
        const signerEmail = optionalString(raw, "signerEmail", 320, REMIND_SIGNER_TOOL_NAME);
        if (signerEmail && typeof signerEmail === "object") return fail(signerEmail.error);
        return ok({
          submissionId,
          signerEmail: typeof signerEmail === "string" ? signerEmail : undefined,
        });
      },
      async (params, config, runCtx) => {
        const result = await remindSigner(config, {
          submissionId: params.submissionId,
          signerEmail: params.signerEmail,
        });
        ctx.logger.info("NoralSign reminder sent", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          submissionId: result.submissionId,
          remindedCount: result.remindedEmails.length,
        });
        return {
          content: `Reminded ${result.remindedEmails.length} signer(s) on submission ${result.submissionId}.`,
          data: { submissionId: result.submissionId, remindedCount: result.remindedEmails.length },
        };
      },
    );

    // ---- download_signed_document ----------------------------------------
    registerTool<{ submissionId: number }>(
      DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME,
      (raw) => {
        const submissionId = requirePositiveInteger(raw, "submissionId", DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME);
        if (typeof submissionId === "object") return fail(submissionId.error);
        return ok({ submissionId });
      },
      async (params, config) => {
        const result = await downloadSignedDocuments(config, params.submissionId);
        return {
          content:
            result.documents.length === 0
              ? `No signed documents available for submission ${params.submissionId} yet.`
              : `Found ${result.documents.length} signed document(s) for submission ${params.submissionId}.`,
          data: { submissionId: result.submissionId, documents: result.documents },
        };
      },
    );

    ctx.logger.info(`${PLUGIN_ID} plugin setup complete`);
  },

  async onWebhook(input) {
    if (input.endpointKey !== DOCUSEAL_WEBHOOK_ENDPOINT_KEY) return;
    const ctx = requireCtx();
    if (!ctx) return;

    const payload = input.parsedBody;
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    const eventType = typeof obj.event_type === "string" ? obj.event_type : null;
    const data = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : {};
    const nestedSubmission = (data.submission as { id?: unknown } | undefined)?.id;
    const submissionId = typeof data.submission_id === "number"
      ? data.submission_id
      : typeof nestedSubmission === "number"
        ? nestedSubmission
        : null;
    if (!eventType || submissionId === null) return;

    const internalEvent = mapDocusealEvent(eventType);
    if (!internalEvent) {
      ctx.logger.info("NoralSign webhook ignored — unmapped event type", { eventType });
      return;
    }

    // NoralSign-internal events need a company scope, but the inbound
    // DocuSeal webhook is single-tenant from DocuSeal's perspective. The
    // company-aware fan-out (lookup submissionId → company via the
    // submission's external_id, then `events.emit` scoped to that
    // company) lands in milestone 1D when the sales-contract routing
    // skill consumes these events. Until then we log the receipt so
    // operators can see the wire is hot end-to-end.
    ctx.logger.info("NoralSign webhook received", {
      eventType,
      internalEvent,
      submissionId,
      requestId: input.requestId,
    });
  },

  async onApiRequest(input) {
    if (input.routeKey !== "list_templates") {
      return { status: 404, body: { error: "Unknown route" } };
    }
    const ctx = requireCtx();
    if (!ctx) return { status: 503, body: { error: "Plugin not yet initialised" } };

    const cfg = readConfig(await ctx.config.get());
    if ("error" in cfg) return { status: 400, body: { error: cfg.error } };
    let apiToken: string;
    try {
      apiToken = await ctx.secrets.resolve(cfg.apiTokenRef);
    } catch {
      return { status: 400, body: { error: "Could not resolve NoralSign credential." } };
    }
    if (!apiToken) {
      return { status: 400, body: { error: "NoralSign credential is empty." } };
    }

    const queryStr = typeof input.query.query === "string" ? input.query.query : undefined;
    const limitStr = typeof input.query.limit === "string" ? input.query.limit : undefined;
    const limitNum = limitStr !== undefined ? Number.parseInt(limitStr, 10) : Number.NaN;
    try {
      const result = await listTemplates(
        { apiUrl: cfg.apiUrl, apiToken },
        {
          query: queryStr,
          limit: Number.isFinite(limitNum) && limitNum > 0 ? Math.min(limitNum, 100) : undefined,
        },
      );
      return { status: 200, body: { templates: result.templates } };
    } catch (err) {
      ctx.logger.warn("NoralSign api list_templates failed", {
        category: err instanceof DocusealProviderError ? err.category : "unknown",
      });
      return {
        status: 502,
        body: {
          error: err instanceof DocusealProviderError ? err.message : "NoralSign upstream failure.",
        },
      };
    }
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_ID} ready` };
  },
});

/**
 * Maps DocuSeal webhook event names onto the NoralSign-internal event
 * namespace. Returns null for events we don't surface.
 *
 * DocuSeal events documented at https://www.docuseal.com/docs/webhooks.
 */
function mapDocusealEvent(eventType: string): string | null {
  switch (eventType) {
    case "form.viewed":
      return "noralsign.signature.viewed";
    case "form.started":
      return "noralsign.signature.started";
    case "form.completed":
      return "noralsign.signature.completed";
    case "form.declined":
      return "noralsign.signature.declined";
    case "submission.completed":
      return "noralsign.submission.completed";
    case "submission.expired":
      return "noralsign.submission.expired";
    default:
      return null;
  }
}

export default plugin;
runWorker(plugin, import.meta.url);
