/**
 * Agent routing + session management.
 *
 * Each inbound Slack interaction (a DM or an @-mention) maps to an
 * `(channelId, threadKey)` tuple. Threads are sticky: if the same Slack
 * user keeps DMing the bot, every message reuses the same
 * `agent.sessions` row so the agent has full conversation context.
 *
 * We persist that mapping in `ctx.state` keyed by company. The mapping
 * is small — `{ sessionId, agentId, lastUsedAt }` — and we expire after
 * `SLACK_SESSION_TTL_MS` to recover from sessions the host has GC'd.
 *
 * Failure modes are intentionally NON-fatal: if we can't load the cached
 * session, we open a new one. If we can't persist the mapping after
 * opening, the next message just starts another session — slightly more
 * expensive but correct.
 */

import type { PluginContext } from "@noralos/plugin-sdk";

import { SLACK_SESSION_NAMESPACE, SLACK_SESSION_TTL_MS } from "./constants.js";

/**
 * Key under which we store the (channel,thread) → session mapping.
 * Slack `channelId` is unique within a workspace; for DMs the channel
 * IS the conversation, so threadKey is the user id. For channel threads
 * we use the parent message `ts`.
 */
function buildStateKey(channelId: string, threadKey: string): string {
  return `${channelId}:${threadKey}`;
}

interface StoredSession {
  sessionId: string;
  agentId: string;
  /** ISO-8601 timestamp; we check this before reusing. */
  lastUsedAt: string;
}

function isStored(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.sessionId === "string" && typeof v.agentId === "string" && typeof v.lastUsedAt === "string";
}

export interface RouteContext {
  /** Plugin SDK context. */
  ctx: PluginContext;
  /** Calling company. */
  companyId: string;
  /** Default agent id (Brooklyn) configured on the plugin. */
  defaultAgentId: string;
  /** Slack channel id (`D…` for DMs, `C…` for channels). */
  channelId: string;
  /**
   * Conversation discriminator inside the channel:
   *   - DM: the slack user id (so different users DMing the bot
   *     don't share a session)
   *   - Channel mention: the parent message `thread_ts` (or, if there's
   *     no parent, the @-mention's own `ts` so a new thread opens)
   */
  threadKey: string;
}

export interface ResolvedSession {
  sessionId: string;
  agentId: string;
  /** True if this call opened a new session (vs. reusing). */
  fresh: boolean;
}

/**
 * Find (or create) the agent session for this Slack interaction.
 * Always returns a usable `(sessionId, agentId)` pair, opening a new
 * session if the cache is missing, stale, or unparseable.
 */
export async function resolveSession(opts: RouteContext): Promise<ResolvedSession> {
  const { ctx, companyId, defaultAgentId, channelId, threadKey } = opts;
  const stateKey = buildStateKey(channelId, threadKey);

  let stored: StoredSession | null = null;
  try {
    const raw = await ctx.state.get({
      scopeKind: "company",
      scopeId: companyId,
      stateKey,
      namespace: SLACK_SESSION_NAMESPACE,
    });
    if (isStored(raw)) stored = raw;
  } catch (err) {
    ctx.logger.warn("Slack agent-router: failed to read cached session; falling through to fresh", {
      err: err instanceof Error ? err.message : "unknown",
    });
  }

  if (stored) {
    const ageMs = Date.now() - new Date(stored.lastUsedAt).getTime();
    if (!Number.isNaN(ageMs) && ageMs < SLACK_SESSION_TTL_MS) {
      return { sessionId: stored.sessionId, agentId: stored.agentId, fresh: false };
    }
  }

  // Open a new session. We deliberately don't catch this — if the host
  // can't open a session, the caller should fail the message rather
  // than silently drop it.
  const session = await ctx.agents.sessions.create(defaultAgentId, companyId, {
    taskKey: `slack:${stateKey}`,
    reason: "Slack inbound message — opening agent session for thread",
  });

  const persist: StoredSession = {
    sessionId: session.sessionId,
    agentId: defaultAgentId,
    lastUsedAt: new Date().toISOString(),
  };
  try {
    await ctx.state.set(
      {
        scopeKind: "company",
        scopeId: companyId,
        stateKey,
        namespace: SLACK_SESSION_NAMESPACE,
      },
      persist,
    );
  } catch (err) {
    ctx.logger.warn("Slack agent-router: failed to persist new session mapping; next message will open another", {
      err: err instanceof Error ? err.message : "unknown",
    });
  }

  return { sessionId: session.sessionId, agentId: defaultAgentId, fresh: true };
}

/**
 * Mark a session as touched so its TTL window resets. Best-effort:
 * we never let a state-store hiccup fail the message-send path.
 */
export async function markSessionUsed(
  ctx: PluginContext,
  companyId: string,
  channelId: string,
  threadKey: string,
  sessionId: string,
  agentId: string,
): Promise<void> {
  try {
    await ctx.state.set(
      {
        scopeKind: "company",
        scopeId: companyId,
        stateKey: buildStateKey(channelId, threadKey),
        namespace: SLACK_SESSION_NAMESPACE,
      },
      {
        sessionId,
        agentId,
        lastUsedAt: new Date().toISOString(),
      } satisfies StoredSession,
    );
  } catch {
    // intentionally swallowed — the worst case is a stale TTL.
  }
}
