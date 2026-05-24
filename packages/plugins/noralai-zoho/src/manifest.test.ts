import { describe, expect, it } from "vitest";

import {
  PLUGIN_ID,
  PLUGIN_VERSION,
  TOOL_MIN_TIER,
  ZOHO_CREATE_RECORD_TOOL_NAME,
  ZOHO_GET_RECORD_TOOL_NAME,
  ZOHO_LIST_MODULES_TOOL_NAME,
  ZOHO_SEARCH_RECORDS_TOOL_NAME,
  ZOHO_UPDATE_RECORD_TOOL_NAME,
} from "./constants.js";
import { TOOL_NAMES, manifest } from "./manifest.js";

describe("manifest", () => {
  it("declares the stable plugin id and a valid version", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.version).toBe(PLUGIN_VERSION);
    expect(manifest.apiVersion).toBe(1);
  });

  it("exposes exactly the v0.1.0 tool surface", () => {
    const names = manifest.tools?.map((t) => t.name) ?? [];
    expect(names).toEqual([
      ZOHO_LIST_MODULES_TOOL_NAME,
      ZOHO_SEARCH_RECORDS_TOOL_NAME,
      ZOHO_GET_RECORD_TOOL_NAME,
      ZOHO_CREATE_RECORD_TOOL_NAME,
      ZOHO_UPDATE_RECORD_TOOL_NAME,
    ]);
    expect(TOOL_NAMES).toEqual(names);
  });

  it("requires secretRef + dataCenter in instanceConfig", () => {
    const schema = manifest.instanceConfigSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toContain("secretRef");
    expect(schema.required).toContain("dataCenter");
    expect(schema.properties).toHaveProperty("apiDomain");
  });

  it("gates writes to manager tier and admits worker on reads", () => {
    expect(TOOL_MIN_TIER[ZOHO_LIST_MODULES_TOOL_NAME]).toBe("worker");
    expect(TOOL_MIN_TIER[ZOHO_SEARCH_RECORDS_TOOL_NAME]).toBe("worker");
    expect(TOOL_MIN_TIER[ZOHO_GET_RECORD_TOOL_NAME]).toBe("worker");
    expect(TOOL_MIN_TIER[ZOHO_CREATE_RECORD_TOOL_NAME]).toBe("manager");
    expect(TOOL_MIN_TIER[ZOHO_UPDATE_RECORD_TOOL_NAME]).toBe("manager");
  });

  it("locks the capability set to the documented minimum", () => {
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining([
        "http.outbound",
        "secrets.read-ref",
        "agent.tools.register",
        "agents.read",
      ]),
    );
    // Zoho v0.1.0 doesn't ship UI, routes, or webhooks — make sure we
    // didn't accidentally request those broader capabilities.
    expect(manifest.capabilities).not.toContain("ui.page.register");
    expect(manifest.capabilities).not.toContain("api.routes.register");
    expect(manifest.capabilities).not.toContain("webhooks.receive");
  });

  it("pins module + id parameter shapes on every relevant tool", () => {
    for (const toolName of [
      ZOHO_SEARCH_RECORDS_TOOL_NAME,
      ZOHO_GET_RECORD_TOOL_NAME,
      ZOHO_CREATE_RECORD_TOOL_NAME,
      ZOHO_UPDATE_RECORD_TOOL_NAME,
    ]) {
      const tool = manifest.tools?.find((t) => t.name === toolName);
      const schema = tool?.parametersSchema as {
        required?: string[];
        properties?: Record<string, { pattern?: string }>;
      };
      expect(schema.required).toContain("module");
      expect(schema.properties?.module?.pattern).toBe("^[A-Za-z][A-Za-z0-9_]{0,63}$");
    }
    for (const toolName of [ZOHO_GET_RECORD_TOOL_NAME, ZOHO_UPDATE_RECORD_TOOL_NAME]) {
      const tool = manifest.tools?.find((t) => t.name === toolName);
      const schema = tool?.parametersSchema as {
        required?: string[];
        properties?: Record<string, { pattern?: string }>;
      };
      expect(schema.required).toContain("id");
      expect(schema.properties?.id?.pattern).toBe("^[0-9]{1,32}$");
    }
  });
});
