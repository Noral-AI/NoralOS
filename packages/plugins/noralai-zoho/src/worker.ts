/**
 * Zoho CRM plugin worker entrypoint.
 *
 * Registers the v0.1.0 agent-tool surface against a per-company Zoho
 * credential. All requests run through {@link createZohoClient}, which
 * owns its own access-token cache and 401 retry logic.
 *
 * Boundaries:
 *   - Reads `secretRef`, `dataCenter`, optional `apiDomain` from the
 *     resolved plugin config. The `secretRef` is a host-secret reference
 *     (e.g. `company-secret:<credential-id>`) resolved through
 *     `ctx.secrets.resolve()` per call — never cached in module state.
 *   - Tier gate: `create` / `update` require `manager` tier or above;
 *     read tools admit any tier (mirrors NoralVoice's pattern).
 *   - Logging hygiene: never log resolved tokens, refresh tokens, or
 *     record-payload values. Errors capture only the plugin-level
 *     category, upstream HTTP status, and Zoho error code.
 *
 * Per-company client cache: each (companyId, configHash) gets a single
 * {@link ZohoClient} so the access-token cache survives across tool
 * calls within a worker process. The cache is keyed on a small hash of
 * the resolved config so a credential rotation (which changes the
 * secretRef and hence the resolved material) drops the stale entry on
 * the next call.
 */

import { definePlugin, runWorker } from "@noralos/plugin-sdk";
import type { PluginContext, ToolRunContext, ToolResult } from "@noralos/plugin-sdk";

import {
  PLUGIN_ID,
  ROLE_TO_TIER,
  TIER_RANK,
  TOOL_MIN_TIER,
  ZOHO_CREATE_RECORD_TOOL_NAME,
  ZOHO_GET_RECORD_TOOL_NAME,
  ZOHO_LIST_MODULES_TOOL_NAME,
  ZOHO_SEARCH_RECORDS_TOOL_NAME,
  ZOHO_UPDATE_RECORD_TOOL_NAME,
  type AgentTier,
  type ZohoDataCenter,
} from "./constants.js";
import { manifest } from "./manifest.js";
import {
  ZohoProviderError,
  createZohoClient,
  type ZohoClient,
  type ZohoOAuthMaterial,
} from "./zoho-client.js";

// ---------------------------------------------------------------------------
// Module-scoped plugin context + client cache
// ---------------------------------------------------------------------------

let pluginCtx: PluginContext | null = null;

interface ClientCacheEntry {
  hash: string;
  client: ZohoClient;
}

/** Cache key: companyId. Value: the last-built client + its config hash. */
const clientCache = new Map<string, ClientCacheEntry>();

/** Exposed for tests so each suite starts from a clean cache. */
export function _resetForTests(): void {
  pluginCtx = null;
  clientCache.clear();
}

function requireCtx(): PluginContext | null {
  return pluginCtx;
}

// ---------------------------------------------------------------------------
// Tier gate
// ---------------------------------------------------------------------------

function tierOf(role: string | undefined | null): AgentTier {
  if (!role) return "worker";
  return ROLE_TO_TIER[role.toLowerCase()] ?? "worker";
}

async function assertTier(
  ctx: PluginContext,
  runCtx: ToolRunContext,
  toolName: string,
): Promise<{ error: string } | null> {
  const requiredTier = TOOL_MIN_TIER[toolName] ?? "manager";
  if (!runCtx.agentId || !runCtx.companyId) {
    return { error: "Zoho CRM tools require an agent-scoped run context." };
  }
  if (requiredTier === "worker") return null;
  let agent;
  try {
    agent = await ctx.agents.get(runCtx.agentId, runCtx.companyId);
  } catch (err) {
    ctx.logger.warn("Zoho tier-gate agent lookup failed", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
      err: err instanceof Error ? err.message : "unknown",
    });
    return { error: "Zoho CRM could not verify calling agent." };
  }
  if (!agent) return { error: "Zoho CRM could not verify calling agent." };
  const actualTier = tierOf(agent.role);
  if (TIER_RANK[actualTier] < TIER_RANK[requiredTier]) {
    ctx.logger.info("Zoho tier-gate denial", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
      role: agent.role,
      actualTier,
      requiredTier,
      toolName,
    });
    return {
      error:
        `Zoho ${toolName} is restricted to ${requiredTier}-tier agents and above. ` +
        `Ask a director/manager to run this, or escalate.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Config + secret resolution + client cache
// ---------------------------------------------------------------------------

interface ResolvedConfig {
  secretRef: string;
  dataCenter: ZohoDataCenter;
  apiDomain?: string;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const VALID_DCS: ReadonlyArray<ZohoDataCenter> = ["us", "eu", "in", "au", "jp", "ca"];

function readConfig(raw: Record<string, unknown>): ResolvedConfig | { error: string } {
  const secretRef = isString(raw.secretRef) ? raw.secretRef.trim() : "";
  const dcRaw = isString(raw.dataCenter) ? raw.dataCenter.trim() : "";
  const apiDomain = isString(raw.apiDomain) ? raw.apiDomain.trim() : undefined;
  const missing: string[] = [];
  if (!secretRef) missing.push("secretRef");
  if (!dcRaw) missing.push("dataCenter");
  if (missing.length > 0) {
    return { error: `Zoho plugin config is missing: ${missing.join(", ")}.` };
  }
  if (!(VALID_DCS as readonly string[]).includes(dcRaw)) {
    return {
      error: `Zoho plugin config.dataCenter '${dcRaw}' is not a recognised data center (expected: ${VALID_DCS.join(", ")}).`,
    };
  }
  return { secretRef, dataCenter: dcRaw as ZohoDataCenter, apiDomain };
}

function parseMaterial(raw: string): ZohoOAuthMaterial | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Zoho credential material is not valid JSON. Reconnect from Settings → Integrations." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Zoho credential material has an unexpected shape." };
  }
  const o = parsed as Record<string, unknown>;
  if (!isString(o.clientId) || !isString(o.clientSecret) || !isString(o.refreshToken)) {
    return {
      error:
        "Zoho credential is missing clientId, clientSecret, or refreshToken. Reconnect from Settings → Integrations → Zoho CRM.",
    };
  }
  return {
    clientId: o.clientId,
    clientSecret: o.clientSecret,
    refreshToken: o.refreshToken,
  };
}

/**
 * Compute a short non-secret-leaking hash of the resolved config so the
 * client cache can detect rotations and rebuild. The refreshToken is
 * length-prefixed and last-4'd to bind the hash to a specific token
 * generation without putting the token in process state outside the
 * client instance itself.
 */
function configHash(config: ResolvedConfig, material: ZohoOAuthMaterial): string {
  const tail =
    material.refreshToken.length > 4
      ? material.refreshToken.slice(-4)
      : material.refreshToken;
  return `${config.dataCenter}|${config.apiDomain ?? ""}|${material.refreshToken.length}|${tail}`;
}

interface ResolvedClient {
  client: ZohoClient;
  /** Resolved config for downstream observability — never log values. */
  resolved: ResolvedConfig;
}

async function resolveClient(
  ctx: PluginContext,
  runCtx: ToolRunContext,
): Promise<ResolvedClient | { error: string }> {
  const config = readConfig(await ctx.config.get());
  if ("error" in config) return { error: config.error };

  let secretJson: string;
  try {
    secretJson = await ctx.secrets.resolve(config.secretRef);
  } catch {
    ctx.logger.error("Zoho secretRef resolution failed", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
    });
    return {
      error:
        "Zoho could not resolve the credential. Check Settings → Integrations → Zoho CRM.",
    };
  }
  if (!secretJson) {
    return {
      error:
        "Zoho credential is empty. Reconnect from Settings → Integrations → Zoho CRM.",
    };
  }

  const material = parseMaterial(secretJson);
  if ("error" in material) return { error: material.error };

  const hash = configHash(config, material);
  if (runCtx.companyId) {
    const cached = clientCache.get(runCtx.companyId);
    if (cached && cached.hash === hash) {
      return { client: cached.client, resolved: config };
    }
  }
  let client: ZohoClient;
  try {
    client = createZohoClient({
      material,
      dataCenter: config.dataCenter,
      apiDomain: config.apiDomain,
    });
  } catch (err) {
    if (err instanceof ZohoProviderError) {
      return { error: err.message };
    }
    throw err;
  }
  if (runCtx.companyId) clientCache.set(runCtx.companyId, { hash, client });
  return { client, resolved: config };
}

// ---------------------------------------------------------------------------
// Per-tool param readers
// ---------------------------------------------------------------------------

type ParamResult<T> = { ok: true; value: T } | { ok: false; error: string };

function readParamsObject(
  raw: unknown,
  tool: string,
): ParamResult<Record<string, unknown>> {
  if (raw == null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${tool} parameters must be an object.` };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

function requireString(
  raw: Record<string, unknown>,
  key: string,
  maxLen: number,
  tool: string,
): ParamResult<string> {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: `${tool}.\`${key}\` must be a non-empty string.` };
  }
  if (value.length > maxLen) {
    return { ok: false, error: `${tool}.\`${key}\` exceeds the ${maxLen}-char limit.` };
  }
  return { ok: true, value };
}

function optionalString(
  raw: Record<string, unknown>,
  key: string,
  maxLen: number,
  tool: string,
): ParamResult<string | undefined> {
  const value = raw[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: `${tool}.\`${key}\` must be a non-empty string when set.` };
  }
  if (value.length > maxLen) {
    return { ok: false, error: `${tool}.\`${key}\` exceeds the ${maxLen}-char limit.` };
  }
  return { ok: true, value };
}

function optionalIntegerInRange(
  raw: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  tool: string,
): ParamResult<number | undefined> {
  const value = raw[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return {
      ok: false,
      error: `${tool}.\`${key}\` must be an integer between ${min} and ${max}.`,
    };
  }
  return { ok: true, value };
}

function requireObject(
  raw: Record<string, unknown>,
  key: string,
  tool: string,
): ParamResult<Record<string, unknown>> {
  const value = raw[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `${tool}.\`${key}\` must be an object.` };
  }
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length === 0) {
    return { ok: false, error: `${tool}.\`${key}\` must include at least one field.` };
  }
  return { ok: true, value: obj };
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

interface NormalisedFailure {
  safe: string;
  category: string;
  httpStatus?: number;
  zohoCode?: string;
}

function normaliseFailure(err: unknown): NormalisedFailure {
  if (err instanceof ZohoProviderError) {
    return {
      safe: err.message,
      category: err.category,
      httpStatus: err.status,
      zohoCode: err.zohoCode,
    };
  }
  return { safe: "Zoho CRM request failed for an unknown reason.", category: "unknown" };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;

    const findTool = (name: string) => {
      const tool = manifest.tools?.find((t) => t.name === name);
      if (!tool) throw new Error(`Zoho worker: tool '${name}' missing from manifest.`);
      return tool;
    };

    type ToolExecutor<T> = (
      params: T,
      client: ZohoClient,
      runCtx: ToolRunContext,
    ) => Promise<ToolResult>;
    type ParamReader<T> = (raw: Record<string, unknown>) => ParamResult<T>;

    function registerTool<T>(
      toolName: string,
      readParams: ParamReader<T>,
      executor: ToolExecutor<T>,
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
          const denied = await assertTier(ctx, runCtx, toolName);
          if (denied) return denied;
          const paramObj = readParamsObject(rawParams, toolName);
          if (!paramObj.ok) return { error: paramObj.error };
          const parsed = readParams(paramObj.value);
          if (!parsed.ok) return { error: parsed.error };
          const resolved = await resolveClient(ctx, runCtx);
          if ("error" in resolved) return { error: resolved.error };
          try {
            return await executor(parsed.value, resolved.client, runCtx);
          } catch (err) {
            const { safe, category, httpStatus, zohoCode } = normaliseFailure(err);
            ctx.logger.warn(`Zoho ${toolName} failed`, {
              companyId: runCtx.companyId,
              agentId: runCtx.agentId,
              category,
              httpStatus,
              zohoCode,
            });
            return { error: safe };
          }
        },
      );
    }

    // ---- zoho_list_modules ---------------------------------------------
    registerTool<Record<string, never>>(
      ZOHO_LIST_MODULES_TOOL_NAME,
      () => ({ ok: true, value: {} }),
      async (_params, client, runCtx) => {
        const { modules, latencyMs } = await client.listModules();
        ctx.logger.info("Zoho list_modules ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          count: modules.length,
          latencyMs,
        });
        return {
          content:
            modules.length === 0
              ? "No Zoho CRM modules visible to this credential."
              : `Found ${modules.length} Zoho CRM module${modules.length === 1 ? "" : "s"}.`,
          data: { modules, latencyMs },
        };
      },
    );

    // ---- zoho_search_records -------------------------------------------
    interface SearchParams {
      module: string;
      criteria?: string;
      word?: string;
      email?: string;
      phone?: string;
      limit?: number;
      page?: number;
    }
    registerTool<SearchParams>(
      ZOHO_SEARCH_RECORDS_TOOL_NAME,
      (raw) => {
        const module = requireString(raw, "module", 64, ZOHO_SEARCH_RECORDS_TOOL_NAME);
        if (!module.ok) return module;
        const criteria = optionalString(raw, "criteria", 2000, ZOHO_SEARCH_RECORDS_TOOL_NAME);
        if (!criteria.ok) return criteria;
        const word = optionalString(raw, "word", 200, ZOHO_SEARCH_RECORDS_TOOL_NAME);
        if (!word.ok) return word;
        const email = optionalString(raw, "email", 320, ZOHO_SEARCH_RECORDS_TOOL_NAME);
        if (!email.ok) return email;
        const phone = optionalString(raw, "phone", 64, ZOHO_SEARCH_RECORDS_TOOL_NAME);
        if (!phone.ok) return phone;
        const limit = optionalIntegerInRange(raw, "limit", 1, 200, ZOHO_SEARCH_RECORDS_TOOL_NAME);
        if (!limit.ok) return limit;
        const page = optionalIntegerInRange(raw, "page", 1, 10_000, ZOHO_SEARCH_RECORDS_TOOL_NAME);
        if (!page.ok) return page;
        return {
          ok: true,
          value: {
            module: module.value,
            criteria: criteria.value,
            word: word.value,
            email: email.value,
            phone: phone.value,
            limit: limit.value,
            page: page.value,
          },
        };
      },
      async (params, client, runCtx) => {
        const result = await client.searchRecords(params);
        ctx.logger.info("Zoho search_records ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          module: params.module,
          count: result.records.length,
          moreRecords: result.moreRecords,
          latencyMs: result.latencyMs,
        });
        return {
          content:
            result.records.length === 0
              ? `No ${params.module} records matched.`
              : `Found ${result.records.length} ${params.module} record${result.records.length === 1 ? "" : "s"}${result.moreRecords ? " (more available)" : ""}.`,
          data: {
            records: result.records,
            moreRecords: result.moreRecords,
            latencyMs: result.latencyMs,
          },
        };
      },
    );

    // ---- zoho_get_record -----------------------------------------------
    interface GetParams {
      module: string;
      id: string;
    }
    registerTool<GetParams>(
      ZOHO_GET_RECORD_TOOL_NAME,
      (raw) => {
        const module = requireString(raw, "module", 64, ZOHO_GET_RECORD_TOOL_NAME);
        if (!module.ok) return module;
        const id = requireString(raw, "id", 32, ZOHO_GET_RECORD_TOOL_NAME);
        if (!id.ok) return id;
        return { ok: true, value: { module: module.value, id: id.value } };
      },
      async (params, client) => {
        const record = await client.getRecord(params.module, params.id);
        return {
          content: record.name
            ? `${params.module} record ${record.id} (${record.name}).`
            : `${params.module} record ${record.id}.`,
          data: { record },
        };
      },
    );

    // ---- zoho_create_record --------------------------------------------
    interface CreateParams {
      module: string;
      values: Record<string, unknown>;
    }
    registerTool<CreateParams>(
      ZOHO_CREATE_RECORD_TOOL_NAME,
      (raw) => {
        const module = requireString(raw, "module", 64, ZOHO_CREATE_RECORD_TOOL_NAME);
        if (!module.ok) return module;
        const values = requireObject(raw, "values", ZOHO_CREATE_RECORD_TOOL_NAME);
        if (!values.ok) return values;
        return { ok: true, value: { module: module.value, values: values.value } };
      },
      async (params, client, runCtx) => {
        const record = await client.createRecord(params);
        ctx.logger.info("Zoho create_record ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          module: params.module,
          recordId: record.id,
          // Intentionally NOT logging the values payload.
        });
        return {
          content: `Created ${params.module} record ${record.id}.`,
          data: { record },
        };
      },
    );

    // ---- zoho_update_record --------------------------------------------
    interface UpdateParams {
      module: string;
      id: string;
      values: Record<string, unknown>;
    }
    registerTool<UpdateParams>(
      ZOHO_UPDATE_RECORD_TOOL_NAME,
      (raw) => {
        const module = requireString(raw, "module", 64, ZOHO_UPDATE_RECORD_TOOL_NAME);
        if (!module.ok) return module;
        const id = requireString(raw, "id", 32, ZOHO_UPDATE_RECORD_TOOL_NAME);
        if (!id.ok) return id;
        const values = requireObject(raw, "values", ZOHO_UPDATE_RECORD_TOOL_NAME);
        if (!values.ok) return values;
        return {
          ok: true,
          value: { module: module.value, id: id.value, values: values.value },
        };
      },
      async (params, client, runCtx) => {
        const record = await client.updateRecord(params);
        ctx.logger.info("Zoho update_record ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          module: params.module,
          recordId: record.id,
        });
        return {
          content: `Updated ${params.module} record ${record.id}.`,
          data: { record },
        };
      },
    );

    // Silence unused-import lint complaints; the type is used for the
    // generic constraint above but tsc still emits the import.
    void (null as unknown as ToolExecutor<unknown>);

    ctx.logger.info(`${PLUGIN_ID} plugin setup complete`);
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_ID} ready` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

// Re-export the requireCtx accessor so any future webhook/route handler
// inside this plugin can grab the captured ctx without duplicating the
// module-state plumbing.
export { requireCtx };
