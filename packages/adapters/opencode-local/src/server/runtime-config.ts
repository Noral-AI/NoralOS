import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asBoolean } from "@noralos/adapter-utils/server-utils";

const require = createRequire(import.meta.url);

type PreparedOpenCodeRuntimeConfig = {
  env: Record<string, string>;
  notes: string[];
  cleanup: () => Promise<void>;
};

function resolveXdgConfigHome(env: Record<string, string>): string {
  return (
    (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()) ||
    (typeof process.env.XDG_CONFIG_HOME === "string" && process.env.XDG_CONFIG_HOME.trim()) ||
    path.join(os.homedir(), ".config")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readJsonObject(filepath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filepath, "utf8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Resolve the built entrypoint of the `@noralos/mcp-server` stdio bridge.
 *
 * Order: explicit `NORALOS_MCP_SERVER_ENTRY` override → node resolution (if it
 * happens to be a declared dependency) → walk up the tree looking for the
 * sibling workspace package's `dist/stdio.js` (the layout in both the dev
 * worktree and the prod image). Returns null when nothing is found so the
 * caller skips MCP injection rather than writing a broken command.
 */
function resolveNoralosMcpServerEntry(env: Record<string, string>): string | null {
  const override = trimmed(env.NORALOS_MCP_SERVER_ENTRY);
  if (override && existsSync(override)) return override;

  try {
    const pkgJson = require.resolve("@noralos/mcp-server/package.json");
    const entry = path.join(path.dirname(pkgJson), "dist", "stdio.js");
    if (existsSync(entry)) return entry;
  } catch {
    // Not resolvable from this package — fall through to the layout walk.
  }

  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
      const entry = path.join(dir, "packages", "mcp-server", "dist", "stdio.js");
      if (existsSync(entry)) return entry;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Resolve the tsx ESM loader used to run the API server (see the image `CMD`:
 * `node --import .../tsx/dist/loader.mjs ...`). The spawned mcp-server imports
 * workspace packages exported as TS source (`@noralos/shared`), so it needs the
 * same loader. Order: explicit override → the server's tsx → a hoisted tsx.
 * Returns null when tsx can't be found (caller falls back to a bare node run).
 */
function resolveTsxLoader(env: Record<string, string>): string | null {
  const override = trimmed(env.NORALOS_MCP_TSX_LOADER);
  if (override && existsSync(override)) return override;

  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
      for (const candidate of [
        path.join(dir, "server", "node_modules", "tsx", "dist", "loader.mjs"),
        path.join(dir, "node_modules", "tsx", "dist", "loader.mjs"),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Build the OpenCode `mcp` map exposing this agent's NoralOS host plugin tools
 * (noralvoice:*, etc.) as bound tools. Empty unless a full agent run context is
 * present in the env AND the mcp-server entry is resolvable — so non-agent or
 * misconfigured runs simply get no plugin tools instead of a broken server.
 */
function buildNoralosMcpServers(env: Record<string, string>): Record<string, unknown> {
  const apiUrl = trimmed(env.NORALOS_API_URL);
  const apiKey = trimmed(env.NORALOS_API_KEY);
  const agentId = trimmed(env.NORALOS_AGENT_ID);
  const runId = trimmed(env.NORALOS_RUN_ID);
  if (!apiUrl || !apiKey || !agentId || !runId) return {};

  const entry = resolveNoralosMcpServerEntry(env);
  if (!entry) return {};

  const environment: Record<string, string> = {
    NORALOS_API_URL: apiUrl,
    NORALOS_API_KEY: apiKey,
    NORALOS_AGENT_ID: agentId,
    NORALOS_RUN_ID: runId,
  };
  const companyId = trimmed(env.NORALOS_COMPANY_ID);
  if (companyId) environment.NORALOS_COMPANY_ID = companyId;

  // The mcp-server entry imports workspace packages exported as TS source, so
  // run it under the same tsx loader the API server uses. Bare node otherwise.
  const tsxLoader = resolveTsxLoader(env);
  const command = tsxLoader ? ["node", "--import", tsxLoader, entry] : ["node", entry];

  return {
    noralos: {
      type: "local",
      command,
      environment,
      enabled: true,
    },
  };
}

export async function prepareOpenCodeRuntimeConfig(input: {
  env: Record<string, string>;
  config: Record<string, unknown>;
  targetIsRemote?: boolean;
}): Promise<PreparedOpenCodeRuntimeConfig> {
  const skipPermissions = asBoolean(input.config.dangerouslySkipPermissions, true);
  const mcpServers = buildNoralosMcpServers(input.env);
  const hasMcpServers = Object.keys(mcpServers).length > 0;

  // Nothing to inject (no permission relaxation and no MCP servers) → passthrough.
  if (!skipPermissions && !hasMcpServers) {
    return {
      env: input.env,
      notes: [],
      cleanup: async () => {},
    };
  }

  // For remote execution targets the host XDG_CONFIG_HOME path is meaningless
  // (and actively harmful — it leaks a macOS-only path into the remote Linux
  // env). Callers that need to ship a runtime opencode config to the remote
  // box do that via prepareAdapterExecutionTargetRuntime in execute.ts; this
  // host-fs helper is local-only. A local MCP `command` path also wouldn't
  // exist on the remote box, so MCP-on-remote is intentionally out of scope.
  if (input.targetIsRemote) {
    return {
      env: input.env,
      notes: [],
      cleanup: async () => {},
    };
  }

  const sourceConfigDir = path.join(resolveXdgConfigHome(input.env), "opencode");
  const runtimeConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-config-"));
  const runtimeConfigDir = path.join(runtimeConfigHome, "opencode");
  const runtimeConfigPath = path.join(runtimeConfigDir, "opencode.json");

  await fs.mkdir(runtimeConfigDir, { recursive: true });
  try {
    await fs.cp(sourceConfigDir, runtimeConfigDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
      dereference: false,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
      throw err;
    }
  }

  const existingConfig = await readJsonObject(runtimeConfigPath);
  const nextConfig: Record<string, unknown> = { ...existingConfig };
  const notes: string[] = [];

  if (skipPermissions) {
    const existingPermission = isPlainObject(existingConfig.permission)
      ? existingConfig.permission
      : {};
    nextConfig.permission = {
      ...existingPermission,
      external_directory: "allow",
    };
    notes.push(
      "Injected runtime OpenCode config with permission.external_directory=allow to avoid headless approval prompts.",
    );
  }

  if (hasMcpServers) {
    const existingMcp = isPlainObject(existingConfig.mcp) ? existingConfig.mcp : {};
    nextConfig.mcp = {
      ...existingMcp,
      ...mcpServers,
    };
    notes.push(
      "Injected NoralOS plugin-tools MCP server (noralos) into the runtime OpenCode config so host plugin tools (noralvoice:*, etc.) are bound for the agent.",
    );
  }

  await fs.writeFile(runtimeConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  return {
    env: {
      ...input.env,
      XDG_CONFIG_HOME: runtimeConfigHome,
    },
    notes,
    cleanup: async () => {
      await fs.rm(runtimeConfigHome, { recursive: true, force: true });
    },
  };
}
