/**
 * Phase 5d — reverse-RPC handler implementations.
 *
 * The plugin's `onReverseTool` hook dispatches to one of these
 * functions keyed on `input.toolName`. Each handler returns a
 * `PluginReverseToolResult` shaped envelope so the NoralVoice executor
 * can surface the result (or error) back to the calling voice
 * agent's LLM.
 *
 * Handlers are kept SDK-free at the type level — they receive the
 * caller-resolved `companyId` plus a typed `args` object and an
 * optional `hostDb` query function for restricted reads/writes
 * against the host's `agents` / `tasks` tables.
 *
 * v1 surface (declared in manifest.reverseTools):
 *   - get_agent_status   — read-only; queries the agents table.
 *   - create_task_for_agent — stubbed; needs a tasks-insert path on
 *     the SDK (`ctx.tasks.create`) that doesn't exist yet. Returns
 *     `NOT_IMPLEMENTED` with a clear follow-up message until then.
 *   - lookup_customer    — stubbed; no canonical core-side customer
 *     model exists. Returns `NOT_CONFIGURED` so calling voice agents
 *     can branch on the code and fall back gracefully.
 *
 * Bigger surface comes in Phase 7 ("Full tool coverage" per
 * docs/audit/consolidation-plan.md). Phase 5 ships the mechanism
 * (HMAC verify, dispatch, error envelopes) so the plumbing is proven
 * before the breadth expansion.
 */

import type { PluginReverseToolResult } from "@noralos/plugin-sdk";

import {
  REVERSE_TOOL_CREATE_TASK_FOR_AGENT,
  REVERSE_TOOL_GET_AGENT_STATUS,
  REVERSE_TOOL_LOOKUP_CUSTOMER,
} from "./constants.js";

// Restricted host-DB query function — same shape the worker already
// casts to from `ctx.host.queryHostDb` for Phase 3's voice_agent_uuid
// reads.
export type HostQuery = (sql: string, params: unknown[]) => Promise<unknown>;

export interface ReverseToolHandlerContext {
  companyId: string;
  hostDb?: HostQuery;
  logger: {
    info: (msg: string, fields?: Record<string, unknown>) => void;
    warn: (msg: string, fields?: Record<string, unknown>) => void;
    error: (msg: string, fields?: Record<string, unknown>) => void;
  };
}

// ---------------------------------------------------------------------------
// get_agent_status
// ---------------------------------------------------------------------------

interface GetAgentStatusArgs {
  agent_id: string;
}

function parseGetAgentStatusArgs(args: Record<string, unknown>):
  | { ok: true; value: GetAgentStatusArgs }
  | { ok: false; error: string } {
  const raw = args.agent_id;
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "`agent_id` is required and must be a string" };
  }
  return { ok: true, value: { agent_id: raw } };
}

export async function handleGetAgentStatus(
  ctx: ReverseToolHandlerContext,
  args: Record<string, unknown>,
): Promise<PluginReverseToolResult> {
  const parsed = parseGetAgentStatusArgs(args);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, code: "INVALID_ARGS" };
  }
  if (!ctx.hostDb) {
    return {
      ok: false,
      error: "ctx.host.queryHostDb is not available — cannot resolve agent status.",
      code: "HOST_DB_UNAVAILABLE",
    };
  }
  try {
    // The agents table carries `last_seen_at` (heartbeat timestamp,
    // null on first sight) and a soft `status` column; concrete column
    // shapes are documented in NoralOS's packages/db schema. We
    // project the minimum the calling voice agent needs to decide
    // whether to page the agent.
    const rows = (await ctx.hostDb(
      `SELECT id, status, last_seen_at FROM public.agents
       WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
      [parsed.value.agent_id, ctx.companyId],
    )) as Array<{ id: string; status: string | null; last_seen_at: string | null }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "Agent not found in this company.", code: "AGENT_NOT_FOUND" };
    }
    const row = rows[0];
    // Heuristic: an agent is "active" if it's been seen in the last
    // 5 minutes. Otherwise "idle". Pageable iff status != offline.
    const lastSeenAt = row.last_seen_at ? new Date(row.last_seen_at) : null;
    const minutesSinceSeen =
      lastSeenAt ? (Date.now() - lastSeenAt.getTime()) / 60_000 : null;
    const derivedStatus =
      row.status === "offline"
        ? "offline"
        : minutesSinceSeen !== null && minutesSinceSeen < 5
        ? "active"
        : "idle";
    return {
      ok: true,
      result: {
        agent_id: row.id,
        status: derivedStatus,
        last_seen_at: row.last_seen_at,
        can_be_paged: row.status !== "offline",
      },
    };
  } catch (err) {
    ctx.logger.error("get_agent_status: queryHostDb failed", {
      err: err instanceof Error ? err.message : "unknown",
    });
    return {
      ok: false,
      error: "Host DB query failed while resolving agent status.",
      code: "HOST_DB_QUERY_FAILED",
    };
  }
}

// ---------------------------------------------------------------------------
// create_task_for_agent — stub pending an SDK ctx.tasks.create surface.
// ---------------------------------------------------------------------------

export async function handleCreateTaskForAgent(
  _ctx: ReverseToolHandlerContext,
  _args: Record<string, unknown>,
): Promise<PluginReverseToolResult> {
  // Phase 5 ships the mechanism. The host SDK doesn't expose a clean
  // `ctx.tasks.create` surface yet, and queryHostDb-based INSERTs
  // against `public.tasks` couple the plugin to a schema that's owned
  // by the host. Flagged as a Phase 5 follow-up (or natural fit for
  // Phase 7's "Full tool coverage").
  return {
    ok: false,
    error:
      "create_task_for_agent is declared but not yet implemented. The plugin SDK needs a ctx.tasks.create surface; filed as a Phase 5 follow-up.",
    code: "NOT_IMPLEMENTED",
  };
}

// ---------------------------------------------------------------------------
// lookup_customer — stub pending a canonical customer model on the host.
// ---------------------------------------------------------------------------

export async function handleLookupCustomer(
  _ctx: ReverseToolHandlerContext,
  _args: Record<string, unknown>,
): Promise<PluginReverseToolResult> {
  // NoralOS core doesn't have a canonical `customers` model — that
  // shape lives in tenant data (CRM imports, plugin tables, etc.). A
  // future Phase 5 follow-up could let other plugins register a
  // customer-lookup hook that this handler delegates to; for now we
  // return NOT_CONFIGURED so calling voice agents can branch and fall
  // back gracefully.
  return {
    ok: false,
    error:
      "No customer-lookup integration is configured for this company. Register a customer-lookup hook on the host to enable this tool.",
    code: "NOT_CONFIGURED",
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function dispatchReverseTool(
  ctx: ReverseToolHandlerContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<PluginReverseToolResult> {
  switch (toolName) {
    case REVERSE_TOOL_GET_AGENT_STATUS:
      return handleGetAgentStatus(ctx, args);
    case REVERSE_TOOL_CREATE_TASK_FOR_AGENT:
      return handleCreateTaskForAgent(ctx, args);
    case REVERSE_TOOL_LOOKUP_CUSTOMER:
      return handleLookupCustomer(ctx, args);
    default:
      return {
        ok: false,
        error: `Unknown reverse-tool '${toolName}'`,
        code: "UNKNOWN_REVERSE_TOOL",
      };
  }
}
