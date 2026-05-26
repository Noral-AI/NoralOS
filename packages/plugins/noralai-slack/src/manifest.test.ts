import { describe, expect, it } from "vitest";

import { manifest } from "./manifest.js";
import {
  LIST_CHANNELS_TOOL_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
  POST_TO_THREAD_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SLACK_MAX_MESSAGE_CHARS,
} from "./constants.js";

describe("noralai-slack manifest", () => {
  it("identifies itself with the locked plugin id + version", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.id).toBe("noralai.slack");
    expect(manifest.version).toBe(PLUGIN_VERSION);
    expect(manifest.apiVersion).toBe(1);
  });

  it("declares the connector category", () => {
    expect(manifest.categories).toContain("connector");
  });

  it("declares the capabilities required for inbound + outbound + sessions", () => {
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining([
        "http.outbound",
        "secrets.read-ref",
        "agent.tools.register",
        "activity.log.write",
        "agents.read",
        "companies.read",
        "agent.sessions.create",
        "agent.sessions.send",
        "agent.sessions.list",
        "agent.sessions.close",
        "plugin.state.read",
        "plugin.state.write",
        "events.emit",
      ]),
    );
  });

  it("does NOT declare webhook receivers (Socket Mode replaces them)", () => {
    expect(manifest.webhooks).toBeUndefined();
  });

  it("points at the built worker entrypoint", () => {
    expect(manifest.entrypoints.worker).toBe("./dist/worker.js");
  });

  it("requires botToken, appToken, and defaultAgentId in instance config", () => {
    const schema = manifest.instanceConfigSchema as {
      type: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { minLength?: number }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining(["botToken", "appToken", "defaultAgentId"]),
    );
    expect(schema.properties.botToken.minLength).toBe(1);
    expect(schema.properties.appToken.minLength).toBe(1);
    expect(schema.properties.defaultAgentId.minLength).toBe(1);
  });

  it("declares the three v1 tools", () => {
    expect(manifest.tools).toHaveLength(3);
    const names = manifest.tools!.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([SEND_MESSAGE_TOOL_NAME, POST_TO_THREAD_TOOL_NAME, LIST_CHANNELS_TOOL_NAME]),
    );
  });

  it("send_message requires channel + text and caps body length", () => {
    const tool = manifest.tools!.find((t) => t.name === SEND_MESSAGE_TOOL_NAME)!;
    const schema = tool.parametersSchema as {
      required: string[];
      properties: Record<string, { maxLength?: number }>;
    };
    expect(schema.required).toEqual(expect.arrayContaining(["channel", "text"]));
    expect(schema.properties.text.maxLength).toBe(SLACK_MAX_MESSAGE_CHARS);
  });

  it("post_to_thread requires the threadTs anchor", () => {
    const tool = manifest.tools!.find((t) => t.name === POST_TO_THREAD_TOOL_NAME)!;
    const schema = tool.parametersSchema as { required: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining(["channel", "threadTs", "text"]),
    );
  });

  it("list_channels accepts an optional limit capped at 200", () => {
    const tool = manifest.tools!.find((t) => t.name === LIST_CHANNELS_TOOL_NAME)!;
    const schema = tool.parametersSchema as {
      properties: Record<string, { maximum?: number }>;
    };
    expect(schema.properties.limit.maximum).toBe(200);
  });

  it("does not declare apiRoutes, database, environment drivers, or UI (Phase 2)", () => {
    expect(manifest.apiRoutes).toBeUndefined();
    expect(manifest.database).toBeUndefined();
    expect(manifest.environmentDrivers).toBeUndefined();
    expect(manifest.ui).toBeUndefined();
  });
});
