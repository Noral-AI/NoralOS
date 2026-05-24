/**
 * Google Sheets plugin worker entrypoint.
 *
 * Registers the v0.1.0 agent-tool surface against a per-company Google
 * OAuth credential. All requests run through {@link createGoogleSheetsClient},
 * which owns its own access-token cache and 401 retry logic.
 *
 * Boundaries:
 *   - Reads `secretRef` from the resolved plugin config. The `secretRef`
 *     is a host-secret reference resolved through `ctx.secrets.resolve()`
 *     per call — never cached in module state.
 *   - Tier gate: `append` / `update` require `manager` tier or above;
 *     read tools admit any tier (mirrors Zoho + NoralVoice).
 *   - Logging hygiene: never log resolved tokens, refresh tokens,
 *     spreadsheet titles, or cell values. Errors capture only the
 *     plugin-level category, upstream HTTP status, and Google's status
 *     enum (e.g. `PERMISSION_DENIED`).
 *
 * Per-company client cache: each companyId gets a single
 * {@link GoogleSheetsClient} so the access-token cache survives across
 * tool calls within a worker process. The cache key includes a hash of
 * the resolved refresh token so a credential rotation drops the stale
 * entry on the next call.
 */

import { definePlugin, runWorker } from "@noralos/plugin-sdk";
import type { PluginContext, ToolRunContext, ToolResult } from "@noralos/plugin-sdk";

import {
  GSHEETS_APPEND_ROWS_TOOL_NAME,
  GSHEETS_GET_SPREADSHEET_TOOL_NAME,
  GSHEETS_LIST_SPREADSHEETS_TOOL_NAME,
  GSHEETS_READ_RANGE_TOOL_NAME,
  GSHEETS_UPDATE_RANGE_TOOL_NAME,
  PLUGIN_ID,
  ROLE_TO_TIER,
  TIER_RANK,
  TOOL_MIN_TIER,
  type AgentTier,
} from "./constants.js";
import { manifest } from "./manifest.js";
import {
  GoogleProviderError,
  createGoogleSheetsClient,
  type GoogleOAuthMaterial,
  type GoogleSheetsClient,
} from "./sheets-client.js";

// ---------------------------------------------------------------------------
// Module-scoped plugin context + client cache
// ---------------------------------------------------------------------------

let pluginCtx: PluginContext | null = null;

interface ClientCacheEntry {
  hash: string;
  client: GoogleSheetsClient;
}

const clientCache = new Map<string, ClientCacheEntry>();

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
    return { error: "Google Sheets tools require an agent-scoped run context." };
  }
  if (requiredTier === "worker") return null;
  let agent;
  try {
    agent = await ctx.agents.get(runCtx.agentId, runCtx.companyId);
  } catch (err) {
    ctx.logger.warn("Google Sheets tier-gate agent lookup failed", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
      err: err instanceof Error ? err.message : "unknown",
    });
    return { error: "Google Sheets could not verify calling agent." };
  }
  if (!agent) return { error: "Google Sheets could not verify calling agent." };
  const actualTier = tierOf(agent.role);
  if (TIER_RANK[actualTier] < TIER_RANK[requiredTier]) {
    ctx.logger.info("Google Sheets tier-gate denial", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
      role: agent.role,
      actualTier,
      requiredTier,
      toolName,
    });
    return {
      error:
        `Google Sheets ${toolName} is restricted to ${requiredTier}-tier agents and above. ` +
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
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readConfig(raw: Record<string, unknown>): ResolvedConfig | { error: string } {
  const secretRef = isString(raw.secretRef) ? raw.secretRef.trim() : "";
  if (!secretRef) {
    return { error: "Google Sheets plugin config is missing: secretRef." };
  }
  return { secretRef };
}

function parseMaterial(raw: string): GoogleOAuthMaterial | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      error: "Google credential material is not valid JSON. Reconnect from Settings → Integrations.",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Google credential material has an unexpected shape." };
  }
  const o = parsed as Record<string, unknown>;
  if (!isString(o.clientId) || !isString(o.clientSecret) || !isString(o.refreshToken)) {
    return {
      error:
        "Google credential is missing clientId, clientSecret, or refreshToken. Reconnect from Settings → Integrations → Google Sheets.",
    };
  }
  return {
    clientId: o.clientId,
    clientSecret: o.clientSecret,
    refreshToken: o.refreshToken,
  };
}

function configHash(material: GoogleOAuthMaterial): string {
  const tail =
    material.refreshToken.length > 4
      ? material.refreshToken.slice(-4)
      : material.refreshToken;
  return `${material.refreshToken.length}|${tail}`;
}

interface ResolvedClient {
  client: GoogleSheetsClient;
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
    ctx.logger.error("Google Sheets secretRef resolution failed", {
      companyId: runCtx.companyId,
      agentId: runCtx.agentId,
    });
    return {
      error:
        "Google Sheets could not resolve the credential. Check Settings → Integrations → Google Sheets.",
    };
  }
  if (!secretJson) {
    return {
      error:
        "Google Sheets credential is empty. Reconnect from Settings → Integrations → Google Sheets.",
    };
  }
  const material = parseMaterial(secretJson);
  if ("error" in material) return { error: material.error };

  const hash = configHash(material);
  if (runCtx.companyId) {
    const cached = clientCache.get(runCtx.companyId);
    if (cached && cached.hash === hash) {
      return { client: cached.client, resolved: config };
    }
  }
  let client: GoogleSheetsClient;
  try {
    client = createGoogleSheetsClient({ material });
  } catch (err) {
    if (err instanceof GoogleProviderError) {
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

function optionalEnum<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  tool: string,
): ParamResult<T | undefined> {
  const value = raw[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return {
      ok: false,
      error: `${tool}.\`${key}\` must be one of: ${allowed.join(", ")}.`,
    };
  }
  return { ok: true, value: value as T };
}

function requireValues(
  raw: Record<string, unknown>,
  tool: string,
): ParamResult<unknown[][]> {
  const value = raw.values;
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: `${tool}.\`values\` must be a non-empty 2D array of rows.` };
  }
  for (let i = 0; i < value.length; i += 1) {
    if (!Array.isArray(value[i])) {
      return { ok: false, error: `${tool}.\`values[${i}]\` must be an array (row).` };
    }
  }
  return { ok: true, value: value as unknown[][] };
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

interface NormalisedFailure {
  safe: string;
  category: string;
  httpStatus?: number;
  googleStatus?: string;
}

function normaliseFailure(err: unknown): NormalisedFailure {
  if (err instanceof GoogleProviderError) {
    return {
      safe: err.message,
      category: err.category,
      httpStatus: err.status,
      googleStatus: err.googleStatus,
    };
  }
  return { safe: "Google Sheets request failed for an unknown reason.", category: "unknown" };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;

    const findTool = (name: string) => {
      const tool = manifest.tools?.find((t) => t.name === name);
      if (!tool) throw new Error(`Google Sheets worker: tool '${name}' missing from manifest.`);
      return tool;
    };

    type ToolExecutor<T> = (
      params: T,
      client: GoogleSheetsClient,
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
            const { safe, category, httpStatus, googleStatus } = normaliseFailure(err);
            ctx.logger.warn(`Google Sheets ${toolName} failed`, {
              companyId: runCtx.companyId,
              agentId: runCtx.agentId,
              category,
              httpStatus,
              googleStatus,
            });
            return { error: safe };
          }
        },
      );
    }

    // ---- gsheets_list_spreadsheets -------------------------------------
    interface ListParams {
      query?: string;
      limit?: number;
      pageToken?: string;
    }
    registerTool<ListParams>(
      GSHEETS_LIST_SPREADSHEETS_TOOL_NAME,
      (raw) => {
        const query = optionalString(raw, "query", 200, GSHEETS_LIST_SPREADSHEETS_TOOL_NAME);
        if (!query.ok) return query;
        const limit = optionalIntegerInRange(raw, "limit", 1, 100, GSHEETS_LIST_SPREADSHEETS_TOOL_NAME);
        if (!limit.ok) return limit;
        const pageToken = optionalString(raw, "pageToken", 4_096, GSHEETS_LIST_SPREADSHEETS_TOOL_NAME);
        if (!pageToken.ok) return pageToken;
        return {
          ok: true,
          value: { query: query.value, limit: limit.value, pageToken: pageToken.value },
        };
      },
      async (params, client, runCtx) => {
        const result = await client.listSpreadsheets(params);
        ctx.logger.info("Google Sheets list_spreadsheets ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          count: result.spreadsheets.length,
          hasNextPage: !!result.nextPageToken,
          latencyMs: result.latencyMs,
        });
        return {
          content:
            result.spreadsheets.length === 0
              ? "No Google spreadsheets matched."
              : `Found ${result.spreadsheets.length} Google spreadsheet${result.spreadsheets.length === 1 ? "" : "s"}${result.nextPageToken ? " (more available)" : ""}.`,
          data: {
            spreadsheets: result.spreadsheets,
            nextPageToken: result.nextPageToken,
            latencyMs: result.latencyMs,
          },
        };
      },
    );

    // ---- gsheets_get_spreadsheet ---------------------------------------
    interface GetParams {
      spreadsheetId: string;
    }
    registerTool<GetParams>(
      GSHEETS_GET_SPREADSHEET_TOOL_NAME,
      (raw) => {
        const spreadsheetId = requireString(
          raw,
          "spreadsheetId",
          128,
          GSHEETS_GET_SPREADSHEET_TOOL_NAME,
        );
        if (!spreadsheetId.ok) return spreadsheetId;
        return { ok: true, value: { spreadsheetId: spreadsheetId.value } };
      },
      async (params, client) => {
        const detail = await client.getSpreadsheet(params.spreadsheetId);
        return {
          content: `Spreadsheet ${detail.id} has ${detail.sheets.length} sheet tab${detail.sheets.length === 1 ? "" : "s"}.`,
          data: { spreadsheet: detail },
        };
      },
    );

    // ---- gsheets_read_range --------------------------------------------
    interface ReadParams {
      spreadsheetId: string;
      range: string;
      valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
    }
    registerTool<ReadParams>(
      GSHEETS_READ_RANGE_TOOL_NAME,
      (raw) => {
        const spreadsheetId = requireString(
          raw,
          "spreadsheetId",
          128,
          GSHEETS_READ_RANGE_TOOL_NAME,
        );
        if (!spreadsheetId.ok) return spreadsheetId;
        const range = requireString(raw, "range", 200, GSHEETS_READ_RANGE_TOOL_NAME);
        if (!range.ok) return range;
        const valueRenderOption = optionalEnum(
          raw,
          "valueRenderOption",
          ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] as const,
          GSHEETS_READ_RANGE_TOOL_NAME,
        );
        if (!valueRenderOption.ok) return valueRenderOption;
        return {
          ok: true,
          value: {
            spreadsheetId: spreadsheetId.value,
            range: range.value,
            valueRenderOption: valueRenderOption.value,
          },
        };
      },
      async (params, client, runCtx) => {
        const result = await client.readRange(params);
        ctx.logger.info("Google Sheets read_range ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          rangeLength: result.values.length,
          latencyMs: result.latencyMs,
        });
        return {
          content:
            result.values.length === 0
              ? `Range ${result.range} is empty.`
              : `Read ${result.values.length} row${result.values.length === 1 ? "" : "s"} from ${result.range}.`,
          data: result,
        };
      },
    );

    // ---- gsheets_append_rows -------------------------------------------
    interface AppendParams {
      spreadsheetId: string;
      range: string;
      values: unknown[][];
      valueInputOption?: "RAW" | "USER_ENTERED";
      insertDataOption?: "OVERWRITE" | "INSERT_ROWS";
    }
    registerTool<AppendParams>(
      GSHEETS_APPEND_ROWS_TOOL_NAME,
      (raw) => {
        const spreadsheetId = requireString(
          raw,
          "spreadsheetId",
          128,
          GSHEETS_APPEND_ROWS_TOOL_NAME,
        );
        if (!spreadsheetId.ok) return spreadsheetId;
        const range = requireString(raw, "range", 200, GSHEETS_APPEND_ROWS_TOOL_NAME);
        if (!range.ok) return range;
        const values = requireValues(raw, GSHEETS_APPEND_ROWS_TOOL_NAME);
        if (!values.ok) return values;
        const valueInputOption = optionalEnum(
          raw,
          "valueInputOption",
          ["RAW", "USER_ENTERED"] as const,
          GSHEETS_APPEND_ROWS_TOOL_NAME,
        );
        if (!valueInputOption.ok) return valueInputOption;
        const insertDataOption = optionalEnum(
          raw,
          "insertDataOption",
          ["OVERWRITE", "INSERT_ROWS"] as const,
          GSHEETS_APPEND_ROWS_TOOL_NAME,
        );
        if (!insertDataOption.ok) return insertDataOption;
        return {
          ok: true,
          value: {
            spreadsheetId: spreadsheetId.value,
            range: range.value,
            values: values.value,
            valueInputOption: valueInputOption.value,
            insertDataOption: insertDataOption.value,
          },
        };
      },
      async (params, client, runCtx) => {
        const result = await client.appendRows(params);
        ctx.logger.info("Google Sheets append_rows ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          updatedRows: result.updatedRows,
          updatedCells: result.updatedCells,
          latencyMs: result.latencyMs,
        });
        return {
          content: `Appended ${result.updatedRows} row${result.updatedRows === 1 ? "" : "s"} (${result.updatedCells} cell${result.updatedCells === 1 ? "" : "s"}) to ${result.updatedRange ?? params.range}.`,
          data: result,
        };
      },
    );

    // ---- gsheets_update_range ------------------------------------------
    interface UpdateParams {
      spreadsheetId: string;
      range: string;
      values: unknown[][];
      valueInputOption?: "RAW" | "USER_ENTERED";
    }
    registerTool<UpdateParams>(
      GSHEETS_UPDATE_RANGE_TOOL_NAME,
      (raw) => {
        const spreadsheetId = requireString(
          raw,
          "spreadsheetId",
          128,
          GSHEETS_UPDATE_RANGE_TOOL_NAME,
        );
        if (!spreadsheetId.ok) return spreadsheetId;
        const range = requireString(raw, "range", 200, GSHEETS_UPDATE_RANGE_TOOL_NAME);
        if (!range.ok) return range;
        const values = requireValues(raw, GSHEETS_UPDATE_RANGE_TOOL_NAME);
        if (!values.ok) return values;
        const valueInputOption = optionalEnum(
          raw,
          "valueInputOption",
          ["RAW", "USER_ENTERED"] as const,
          GSHEETS_UPDATE_RANGE_TOOL_NAME,
        );
        if (!valueInputOption.ok) return valueInputOption;
        return {
          ok: true,
          value: {
            spreadsheetId: spreadsheetId.value,
            range: range.value,
            values: values.value,
            valueInputOption: valueInputOption.value,
          },
        };
      },
      async (params, client, runCtx) => {
        const result = await client.updateRange(params);
        ctx.logger.info("Google Sheets update_range ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          updatedRows: result.updatedRows,
          updatedCells: result.updatedCells,
          latencyMs: result.latencyMs,
        });
        return {
          content: `Updated ${result.updatedRows} row${result.updatedRows === 1 ? "" : "s"} (${result.updatedCells} cell${result.updatedCells === 1 ? "" : "s"}) at ${result.updatedRange ?? params.range}.`,
          data: result,
        };
      },
    );

    void (null as unknown as ToolExecutor<unknown>);

    ctx.logger.info(`${PLUGIN_ID} plugin setup complete`);
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_ID} ready` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

export { requireCtx };
