import os from "node:os";
import path from "node:path";

const DEFAULT_INSTANCE_ID = "default";
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;
const FRIENDLY_PATH_SEGMENT_RE = /[^a-zA-Z0-9._-]+/g;

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolveNoralosHomeDir(): string {
  const envHome = process.env.NORALOS_HOME?.trim();
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), ".paperclip");
}

export function resolveNoralosInstanceId(): string {
  const raw = process.env.NORALOS_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid NORALOS_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveNoralosInstanceRoot(): string {
  return path.resolve(resolveNoralosHomeDir(), "instances", resolveNoralosInstanceId());
}

export function resolveDefaultConfigPath(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "config.json");
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "db");
}

export function resolveDefaultLogsDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "logs");
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "secrets", "master.key");
}

export function resolveDefaultStorageDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "data", "storage");
}

export function resolveDefaultBackupDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "data", "backups");
}

export function resolveDefaultAgentWorkspaceDir(agentId: string): string {
  const trimmed = agentId.trim();
  if (!PATH_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Invalid agent id for workspace path '${agentId}'.`);
  }
  return path.resolve(resolveNoralosInstanceRoot(), "workspaces", trimmed);
}

/**
 * Company-scoped agent home root —
 * `<instance>/companies/<companyId>/agents/<agentId>/`. This is where
 * Brooklyn-class agents store durable facts (`life/`, `memory/`,
 * `instructions/` etc.). Use the participant variant below for
 * Conference Room runs so private facts don't leak across users.
 */
export function resolveDefaultAgentCompanyHomeDir(
  companyId: string,
  agentId: string,
): string {
  const trimmedCompanyId = companyId.trim();
  const trimmedAgentId = agentId.trim();
  if (!PATH_SEGMENT_RE.test(trimmedCompanyId)) {
    throw new Error(`Invalid company id for agent-home path '${companyId}'.`);
  }
  if (!PATH_SEGMENT_RE.test(trimmedAgentId)) {
    throw new Error(`Invalid agent id for agent-home path '${agentId}'.`);
  }
  return path.resolve(
    resolveNoralosInstanceRoot(),
    "companies",
    trimmedCompanyId,
    "agents",
    trimmedAgentId,
  );
}

/**
 * Translate a relative `participantSubPath` (validated to safe segments
 * only) into the absolute filesystem layout the host should pass through
 * to a Conference Room run:
 *
 * - `cwd`: under the agent workspace, used by the Claude Code SDK to
 *   isolate its auto-memory tree. (PR #43 plumbing.)
 * - `agentHome`: under the agent's company-scoped home, used as the
 *   `AGENT_HOME` env var so durable-fact paths the agent's instructions
 *   describe (`$AGENT_HOME/life/`, `$AGENT_HOME/memory/`) land in a
 *   per-participant directory instead of the shared one. (PR #44.)
 *
 * Returns null if any segment fails the safe-segment allowlist; callers
 * must surface that as an error to the plugin worker.
 */
export interface ParticipantRunPaths {
  cwd: string;
  agentHome: string;
  agentHomeLifeDir: string;
  agentHomeMemoryDir: string;
}

const PARTICIPANT_SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

export function resolveParticipantRunPaths(input: {
  companyId: string;
  agentId: string;
  participantSubPath: string;
}): ParticipantRunPaths | null {
  // Accept ONLY the well-formed shapes the bridge plugin produces:
  //   participants/users/<idSafe>
  //   participants/anon/<idSafe>
  // No leading or trailing slash, no `..`, no empty segments anywhere.
  // Reject anything else so a malicious caller can't widen the persistence
  // root by passing e.g. `/etc/passwd`, `..`, or `participants/users/u/x`.
  const trimmed = input.participantSubPath;
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) return null;
  const segments = trimmed.split("/");
  if (segments.length !== 3) return null;
  if (segments[0] !== "participants") return null;
  if (segments[1] !== "users" && segments[1] !== "anon") return null;
  if (!PARTICIPANT_SAFE_SEGMENT.test(segments[2])) return null;
  const cwd = path.join(
    resolveDefaultAgentWorkspaceDir(input.agentId),
    ...segments,
  );
  const agentHome = path.join(
    resolveDefaultAgentCompanyHomeDir(input.companyId, input.agentId),
    ...segments,
  );
  return {
    cwd,
    agentHome,
    agentHomeLifeDir: path.join(agentHome, "life"),
    agentHomeMemoryDir: path.join(agentHome, "memory"),
  };
}

function sanitizeFriendlyPathSegment(value: string | null | undefined, fallback = "_default"): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return fallback;
  const sanitized = trimmed
    .replace(FRIENDLY_PATH_SEGMENT_RE, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

export function resolveManagedProjectWorkspaceDir(input: {
  companyId: string;
  projectId: string;
  repoName?: string | null;
}): string {
  const companyId = input.companyId.trim();
  const projectId = input.projectId.trim();
  if (!companyId || !projectId) {
    throw new Error("Managed project workspace path requires companyId and projectId.");
  }
  return path.resolve(
    resolveNoralosInstanceRoot(),
    "projects",
    sanitizeFriendlyPathSegment(companyId, "company"),
    sanitizeFriendlyPathSegment(projectId, "project"),
    sanitizeFriendlyPathSegment(input.repoName, "_default"),
  );
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}
