import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { prepareOpenCodeRuntimeConfig } from "./runtime-config.js";

// An entry path that exists on disk so the MCP-server resolver accepts it
// (this test file). Avoids depending on the built mcp-server dist layout.
const ENTRY = fileURLToPath(import.meta.url);

const cleanupPaths = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...cleanupPaths].map(async (filepath) => {
      await fs.rm(filepath, { recursive: true, force: true });
      cleanupPaths.delete(filepath);
    }),
  );
});

async function makeConfigHome(initialConfig?: Record<string, unknown>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-test-"));
  cleanupPaths.add(root);
  const configDir = path.join(root, "opencode");
  await fs.mkdir(configDir, { recursive: true });
  if (initialConfig) {
    await fs.writeFile(
      path.join(configDir, "opencode.json"),
      `${JSON.stringify(initialConfig, null, 2)}\n`,
      "utf8",
    );
  }
  return root;
}

describe("prepareOpenCodeRuntimeConfig", () => {
  it("injects an external_directory allow rule by default", async () => {
    const configHome = await makeConfigHome({
      permission: {
        read: "allow",
      },
      theme: "system",
    });

    const prepared = await prepareOpenCodeRuntimeConfig({
      env: { XDG_CONFIG_HOME: configHome },
      config: {},
    });
    cleanupPaths.add(prepared.env.XDG_CONFIG_HOME);

    expect(prepared.env.XDG_CONFIG_HOME).not.toBe(configHome);
    const runtimeConfig = JSON.parse(
      await fs.readFile(
        path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "opencode.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(runtimeConfig).toMatchObject({
      theme: "system",
      permission: {
        read: "allow",
        external_directory: "allow",
      },
    });

    await prepared.cleanup();
    cleanupPaths.delete(prepared.env.XDG_CONFIG_HOME);
    await expect(fs.access(prepared.env.XDG_CONFIG_HOME)).rejects.toThrow();
  });

  it("respects explicit opt-out", async () => {
    const configHome = await makeConfigHome();
    const prepared = await prepareOpenCodeRuntimeConfig({
      env: { XDG_CONFIG_HOME: configHome },
      config: { dangerouslySkipPermissions: false },
    });

    expect(prepared.env).toEqual({ XDG_CONFIG_HOME: configHome });
    expect(prepared.notes).toEqual([]);
    await prepared.cleanup();
  });

  it("injects the noralos MCP server for an agent run", async () => {
    const configHome = await makeConfigHome();
    const prepared = await prepareOpenCodeRuntimeConfig({
      env: {
        XDG_CONFIG_HOME: configHome,
        NORALOS_API_URL: "http://host/api",
        NORALOS_API_KEY: "run-jwt",
        NORALOS_AGENT_ID: "agent-1",
        NORALOS_RUN_ID: "run-1",
        NORALOS_COMPANY_ID: "company-1",
        NORALOS_MCP_SERVER_ENTRY: ENTRY,
        NORALOS_MCP_TSX_LOADER: ENTRY,
      },
      config: {},
    });
    cleanupPaths.add(prepared.env.XDG_CONFIG_HOME);

    const runtimeConfig = JSON.parse(
      await fs.readFile(
        path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "opencode.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(runtimeConfig.mcp).toEqual({
      noralos: {
        type: "local",
        command: ["node", "--import", ENTRY, ENTRY],
        environment: {
          NORALOS_API_URL: "http://host/api",
          NORALOS_API_KEY: "run-jwt",
          NORALOS_AGENT_ID: "agent-1",
          NORALOS_RUN_ID: "run-1",
          NORALOS_COMPANY_ID: "company-1",
        },
        enabled: true,
      },
    });
    expect((runtimeConfig.permission as Record<string, unknown>).external_directory).toBe("allow");
    await prepared.cleanup();
  });

  it("injects MCP even when permissions are not skipped (no permission block)", async () => {
    const configHome = await makeConfigHome();
    const prepared = await prepareOpenCodeRuntimeConfig({
      env: {
        XDG_CONFIG_HOME: configHome,
        NORALOS_API_URL: "http://host/api",
        NORALOS_API_KEY: "run-jwt",
        NORALOS_AGENT_ID: "agent-1",
        NORALOS_RUN_ID: "run-1",
        NORALOS_MCP_SERVER_ENTRY: ENTRY,
      },
      config: { dangerouslySkipPermissions: false },
    });
    cleanupPaths.add(prepared.env.XDG_CONFIG_HOME);

    const runtimeConfig = JSON.parse(
      await fs.readFile(
        path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "opencode.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect((runtimeConfig.mcp as Record<string, unknown>).noralos).toBeDefined();
    expect(runtimeConfig.permission).toBeUndefined();
    await prepared.cleanup();
  });

  it("omits MCP when the agent run env is incomplete", async () => {
    const configHome = await makeConfigHome();
    const prepared = await prepareOpenCodeRuntimeConfig({
      env: {
        XDG_CONFIG_HOME: configHome,
        NORALOS_API_URL: "http://host/api",
        NORALOS_API_KEY: "run-jwt",
        NORALOS_AGENT_ID: "agent-1",
        // NORALOS_RUN_ID intentionally omitted
        NORALOS_MCP_SERVER_ENTRY: ENTRY,
      },
      config: {},
    });
    cleanupPaths.add(prepared.env.XDG_CONFIG_HOME);

    const runtimeConfig = JSON.parse(
      await fs.readFile(
        path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "opencode.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(runtimeConfig.mcp).toBeUndefined();
    expect((runtimeConfig.permission as Record<string, unknown>).external_directory).toBe("allow");
  });
});
