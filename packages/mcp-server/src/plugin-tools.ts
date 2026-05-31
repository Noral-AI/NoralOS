import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { NoralosApiClient } from "./client.js";
import type { NoralosMcpConfig } from "./config.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";

// The host's `AgentToolDescriptor` (`server/src/services/plugin-tool-dispatcher.ts`)
// returned by `GET /api/plugins/tools`: `{ name (fully namespaced, e.g.
// "noralai.noralvoice:run_call"), displayName, description, parametersSchema,
// pluginId }`. Read defensively from loose records since this crosses a
// package boundary.

type Logger = (message: string) => void;

const defaultLogger: Logger = (message) => {
  // MCP servers speak JSON-RPC on stdout — diagnostics must go to stderr.
  console.error(`[noralos-mcp] ${message}`);
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * OpenCode / MCP tool names are surfaced to the model and must be limited to
 * `[a-zA-Z0-9_-]`. The host namespaces tools as `<pluginKey>:<tool>` (the `:`
 * and `.` are illegal here), so sanitize for the wire while keeping a reverse
 * map back to the original namespaced name the execute route expects.
 */
function sanitizeToolName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return base.length > 0 ? base : "tool";
}

/** Map a single JSON-Schema property node to a permissive Zod type. */
function jsonSchemaPropertyToZod(prop: unknown): ZodTypeAny {
  if (!isObject(prop)) return z.any();

  if (
    Array.isArray(prop.enum) &&
    prop.enum.length > 0 &&
    prop.enum.every((value) => typeof value === "string")
  ) {
    return z.enum(prop.enum as [string, ...string[]]);
  }

  const rawType = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  let zodType: ZodTypeAny;
  switch (rawType) {
    case "string":
      zodType = z.string();
      break;
    case "number":
      zodType = z.number();
      break;
    case "integer":
      zodType = z.number().int();
      break;
    case "boolean":
      zodType = z.boolean();
      break;
    case "array":
      zodType = z.array(z.any());
      break;
    case "object":
      zodType = z.record(z.any());
      break;
    default:
      zodType = z.any();
  }

  if (typeof prop.description === "string" && prop.description.length > 0) {
    zodType = zodType.describe(prop.description);
  }
  return zodType;
}

/**
 * Build a Zod raw shape from a tool's JSON-Schema `parametersSchema`. The MCP
 * SDK's `server.tool(name, desc, shape, cb)` overload requires Zod, not raw
 * JSON Schema. This shim is intentionally permissive — the owning plugin
 * worker re-validates every argument against the real schema at execute time,
 * so loose typing here cannot bypass validation.
 */
function buildZodShape(parametersSchema: Record<string, unknown> | undefined): ZodRawShape {
  const properties = isObject(parametersSchema?.properties) ? parametersSchema!.properties : {};
  const required = new Set(
    Array.isArray(parametersSchema?.required)
      ? (parametersSchema!.required as unknown[]).filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );

  const shape: ZodRawShape = {};
  for (const [key, prop] of Object.entries(properties)) {
    let zodType = jsonSchemaPropertyToZod(prop);
    if (!required.has(key)) zodType = zodType.optional();
    shape[key] = zodType;
  }
  return shape;
}

function extractToolResult(executionResult: unknown): unknown {
  // The execute route returns ToolExecutionResult `{ pluginId, toolName, result }`
  // where `result` is the plugin's ToolResult `{ content?, data?, error? }`.
  const result =
    isObject(executionResult) && "result" in executionResult
      ? executionResult.result
      : executionResult;

  if (isObject(result)) {
    if (typeof result.error === "string" && result.error.length > 0) {
      return { error: result.error };
    }
    if (typeof result.content === "string") {
      return result.data !== undefined
        ? `${result.content}\n\n${JSON.stringify(result.data, null, 2)}`
        : result.content;
    }
    if (result.data !== undefined) return result.data;
  }
  return result;
}

/**
 * Discover the agent's host plugin tools and register each as a bound MCP tool
 * that proxies to `POST /api/plugins/tools/execute`. Requires an agent run
 * context (agentId/runId/companyId); in non-agent contexts it is a no-op so
 * the static core tools still work. Network/list failures are logged and
 * swallowed — a transient host hiccup must not take down the MCP server.
 *
 * @returns the number of plugin tools registered.
 */
export async function registerPluginTools(
  server: McpServer,
  client: NoralosApiClient,
  config: NoralosMcpConfig,
  log: Logger = defaultLogger,
): Promise<number> {
  const { agentId, runId, companyId } = config;
  if (!agentId || !runId || !companyId) {
    log("skipping plugin tools: NORALOS_AGENT_ID / NORALOS_RUN_ID / NORALOS_COMPANY_ID not all set");
    return 0;
  }

  let descriptors: Array<Record<string, unknown>>;
  try {
    descriptors = await client.listPluginTools();
  } catch (error) {
    log(`failed to list plugin tools: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }

  const usedNames = new Set<string>();
  let registered = 0;

  for (const descriptor of descriptors) {
    if (!isObject(descriptor) || typeof descriptor.name !== "string" || descriptor.name.length === 0) {
      continue;
    }
    const originalName = descriptor.name;

    let mcpName = sanitizeToolName(originalName);
    if (usedNames.has(mcpName)) {
      let suffix = 2;
      while (usedNames.has(`${mcpName}_${suffix}`)) suffix += 1;
      mcpName = `${mcpName}_${suffix}`;
    }
    usedNames.add(mcpName);

    const descriptionText =
      typeof descriptor.description === "string" && descriptor.description.length > 0
        ? descriptor.description
        : undefined;
    const displayName =
      typeof descriptor.displayName === "string" && descriptor.displayName.length > 0
        ? descriptor.displayName
        : undefined;
    const description = descriptionText ?? displayName ?? originalName;
    const shape = buildZodShape(
      isObject(descriptor.parametersSchema) ? descriptor.parametersSchema : undefined,
    );

    try {
      server.tool(mcpName, description, shape, async (args: Record<string, unknown>) => {
        try {
          const executionResult = await client.executePluginTool(originalName, args ?? {}, {
            agentId,
            runId,
            companyId,
          });
          return formatTextResponse(extractToolResult(executionResult));
        } catch (error) {
          return formatErrorResponse(error);
        }
      });
      registered += 1;
    } catch (error) {
      log(`failed to register tool "${originalName}" as "${mcpName}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  log(`registered ${registered} plugin tool(s)`);
  return registered;
}
