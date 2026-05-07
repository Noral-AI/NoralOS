// Participant isolation for Conference Room sessions.
//
// Decides who owns a Conference Room session and which agent_task_sessions
// row its model state belongs to. The two cases:
//
// 1. Authenticated user actor (`actorType === 'user'` with a non-empty
//    `userId`): the participant is `userId` and the session routes to the
//    per-user task key. Same human across browser tabs/refreshes converges
//    on a single Claude session; different humans never share state.
//
// 2. Anything else (agent caller, anonymous board session, missing userId):
//    the participant is null and the session routes to a per-conference-
//    session anonymous task key. Each anonymous session is isolated from
//    every other and never inherits the agent's most recent global state.
//
// The body's legacy `participantId` is honoured only when there is no
// authenticated user actor; an authenticated actor is always trusted ahead
// of caller-provided body values.

import {
  ISOLATION_TASK_KEY_PREFIX_ANON,
  ISOLATION_TASK_KEY_PREFIX_USER,
} from "./constants.js";

export type IsolationKeyType = "user" | "anon";

export interface IsolationActor {
  actorType?: "user" | "agent";
  userId?: string | null;
}

export interface IsolationBody {
  participantId?: unknown;
}

export interface ParticipantContext {
  participantId: string | null;
  taskKey: string;
  isolationKeyType: IsolationKeyType;
  /**
   * Subdirectory under the agent's home that scopes filesystem state for
   * this participant. Used to derive a per-participant working directory
   * so the Claude Code SDK auto-memory tree (which keys on cwd) does not
   * leak facts across users. Always relative; the host joins it onto the
   * agent home.
   */
  participantSubPath: string;
}

/**
 * Validate a path-segment string to keep derived filesystem paths safe.
 * Allows the conservative set used by other NoralOS workspace identifiers
 * (alphanumerics, hyphen, underscore). Anything else collapses to `_safe`.
 */
function safePathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "_safe";
  return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : "_safe";
}

export function deriveParticipantContext(
  actor: IsolationActor | undefined,
  body: IsolationBody,
  conferenceSessionId: string,
): ParticipantContext {
  const actorUserId =
    actor?.actorType === "user" && typeof actor.userId === "string" && actor.userId.length > 0
      ? actor.userId
      : null;
  if (actorUserId) {
    return {
      participantId: actorUserId,
      taskKey: `${ISOLATION_TASK_KEY_PREFIX_USER}${actorUserId}`,
      isolationKeyType: "user",
      participantSubPath: `participants/users/${safePathSegment(actorUserId)}`,
    };
  }
  const bodyParticipant =
    typeof body.participantId === "string" && body.participantId.length > 0
      ? body.participantId
      : null;
  return {
    participantId: bodyParticipant,
    taskKey: `${ISOLATION_TASK_KEY_PREFIX_ANON}${conferenceSessionId}`,
    isolationKeyType: "anon",
    participantSubPath: `participants/anon/${safePathSegment(conferenceSessionId)}`,
  };
}

/**
 * Resolve the absolute working directory the Claude Code subprocess should
 * run in for this Conference Room run. The Claude SDK auto-memory tree
 * lives under `~/.claude/projects/<cwd-encoded>/memory/` so giving each
 * participant a distinct cwd gives them a distinct memory tree.
 *
 * Falls back to `null` if the host environment did not expose
 * `NORALOS_HOME`, in which case the caller must omit the cwd override and
 * the legacy shared-agent-home behaviour is used.
 */
export function resolveParticipantCwd(
  participantSubPath: string,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const home = env.NORALOS_HOME?.trim();
  if (!home) return null;
  const instance = env.NORALOS_INSTANCE_ID?.trim() || "default";
  const safeAgent = safePathSegment(agentId);
  // No path.posix import here — the helper is meant to run inside the
  // worker process which is Linux-only at the moment. If/when the bridge
  // ships on Windows hosts we can swap to `node:path`.
  return `${home}/instances/${instance}/workspaces/${safeAgent}/${participantSubPath}`;
}
