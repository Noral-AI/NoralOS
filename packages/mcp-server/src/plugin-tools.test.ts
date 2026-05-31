import { describe, it, expect, vi } from "vitest";

import type { NoralosApiClient } from "./client.js";
import type { NoralosMcpConfig } from "./config.js";
import { registerPluginTools } from "./plugin-tools.js";

type CapturedTool = {
  name: string;
  description: string;
  shape: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

function fakeServer() {
  const tools: CapturedTool[] = [];
  const server = {
    tool: (
      name: string,
      description: string,
      shape: Record<string, unknown>,
      handler: CapturedTool["handler"],
    ) => {
      tools.push({ name, description, shape, handler });
    },
  };
  return { server, tools };
}

function fakeClient(overrides: Partial<NoralosApiClient> = {}): NoralosApiClient {
  return {
    listPluginTools: vi.fn(async () => []),
    executePluginTool: vi.fn(async () => ({ result: { content: "ok" } })),
    ...overrides,
  } as unknown as NoralosApiClient;
}

const agentConfig: NoralosMcpConfig = {
  apiUrl: "http://host/api",
  apiKey: "run-jwt",
  companyId: "company-1",
  agentId: "agent-1",
  runId: "run-1",
};

const silent = () => {};

describe("registerPluginTools", () => {
  it("is a no-op without a full agent run context", async () => {
    const { server, tools } = fakeServer();
    const client = fakeClient();

    const count = await registerPluginTools(
      server as never,
      client,
      { ...agentConfig, agentId: null },
      silent,
    );

    expect(count).toBe(0);
    expect(tools).toHaveLength(0);
    expect(client.listPluginTools).not.toHaveBeenCalled();
  });

  it("registers a sanitized tool name and proxies execute to the original namespaced name", async () => {
    const { server, tools } = fakeServer();
    const executePluginTool = vi.fn(async () => ({ result: { content: "queued" } }));
    const client = fakeClient({
      listPluginTools: vi.fn(async () => [
        {
          name: "noralai.noralvoice:run_call",
          description: "Place an outbound call",
          parametersSchema: {
            type: "object",
            properties: {
              workflowUuid: { type: "string" },
              toNumber: { type: "string" },
              variables: { type: "object" },
            },
            required: ["workflowUuid", "toNumber"],
          },
        },
      ]) as never,
      executePluginTool: executePluginTool as never,
    });

    const count = await registerPluginTools(server as never, client, agentConfig, silent);

    expect(count).toBe(1);
    expect(tools[0].name).toBe("noralai_noralvoice_run_call");
    expect(Object.keys(tools[0].shape).sort()).toEqual(["toNumber", "variables", "workflowUuid"]);

    const result = await tools[0].handler({ workflowUuid: "wf", toNumber: "+15551230000" });
    expect(executePluginTool).toHaveBeenCalledWith(
      "noralai.noralvoice:run_call",
      { workflowUuid: "wf", toNumber: "+15551230000" },
      { agentId: "agent-1", runId: "run-1", companyId: "company-1" },
    );
    expect(result.content[0].text).toContain("queued");
  });

  it("de-duplicates colliding sanitized names", async () => {
    const { server, tools } = fakeServer();
    const client = fakeClient({
      listPluginTools: vi.fn(async () => [
        { name: "a.b:x", description: "one", parametersSchema: {} },
        { name: "a:b:x", description: "two", parametersSchema: {} },
      ]) as never,
    });

    await registerPluginTools(server as never, client, agentConfig, silent);

    expect(tools.map((t) => t.name)).toEqual(["a_b_x", "a_b_x_2"]);
  });

  it("swallows a list failure and registers nothing", async () => {
    const { server, tools } = fakeServer();
    const client = fakeClient({
      listPluginTools: vi.fn(async () => {
        throw new Error("boom");
      }) as never,
    });

    const count = await registerPluginTools(server as never, client, agentConfig, silent);

    expect(count).toBe(0);
    expect(tools).toHaveLength(0);
  });

  it("returns an MCP error payload when the proxied execute fails", async () => {
    const { server, tools } = fakeServer();
    const client = fakeClient({
      listPluginTools: vi.fn(async () => [
        { name: "p:fail", description: "d", parametersSchema: {} },
      ]) as never,
      executePluginTool: vi.fn(async () => {
        throw new Error("worker unavailable");
      }) as never,
    });

    await registerPluginTools(server as never, client, agentConfig, silent);
    const result = await tools[0].handler({});

    expect(result.content[0].text).toContain("worker unavailable");
  });
});
