import { describe, expect, it } from "vitest";

import {
  GSHEETS_APPEND_ROWS_TOOL_NAME,
  GSHEETS_GET_SPREADSHEET_TOOL_NAME,
  GSHEETS_LIST_SPREADSHEETS_TOOL_NAME,
  GSHEETS_READ_RANGE_TOOL_NAME,
  GSHEETS_UPDATE_RANGE_TOOL_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
  TOOL_MIN_TIER,
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
      GSHEETS_LIST_SPREADSHEETS_TOOL_NAME,
      GSHEETS_GET_SPREADSHEET_TOOL_NAME,
      GSHEETS_READ_RANGE_TOOL_NAME,
      GSHEETS_APPEND_ROWS_TOOL_NAME,
      GSHEETS_UPDATE_RANGE_TOOL_NAME,
    ]);
    expect(TOOL_NAMES).toEqual(names);
  });

  it("requires only secretRef in instanceConfig (Google has no regional split)", () => {
    const schema = manifest.instanceConfigSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toEqual(["secretRef"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["secretRef"]);
  });

  it("gates writes to manager tier and admits worker on reads", () => {
    expect(TOOL_MIN_TIER[GSHEETS_LIST_SPREADSHEETS_TOOL_NAME]).toBe("worker");
    expect(TOOL_MIN_TIER[GSHEETS_GET_SPREADSHEET_TOOL_NAME]).toBe("worker");
    expect(TOOL_MIN_TIER[GSHEETS_READ_RANGE_TOOL_NAME]).toBe("worker");
    expect(TOOL_MIN_TIER[GSHEETS_APPEND_ROWS_TOOL_NAME]).toBe("manager");
    expect(TOOL_MIN_TIER[GSHEETS_UPDATE_RANGE_TOOL_NAME]).toBe("manager");
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
    expect(manifest.capabilities).not.toContain("ui.page.register");
    expect(manifest.capabilities).not.toContain("api.routes.register");
    expect(manifest.capabilities).not.toContain("webhooks.receive");
  });

  it("pins the spreadsheetId pattern on every tool that takes one", () => {
    const expectedPattern = "^[A-Za-z0-9_-]{20,128}$";
    for (const toolName of [
      GSHEETS_GET_SPREADSHEET_TOOL_NAME,
      GSHEETS_READ_RANGE_TOOL_NAME,
      GSHEETS_APPEND_ROWS_TOOL_NAME,
      GSHEETS_UPDATE_RANGE_TOOL_NAME,
    ]) {
      const tool = manifest.tools?.find((t) => t.name === toolName);
      const schema = tool?.parametersSchema as {
        required?: string[];
        properties?: Record<string, { pattern?: string }>;
      };
      expect(schema.required).toContain("spreadsheetId");
      expect(schema.properties?.spreadsheetId?.pattern).toBe(expectedPattern);
    }
  });

  it("requires range on every tool that takes one", () => {
    for (const toolName of [
      GSHEETS_READ_RANGE_TOOL_NAME,
      GSHEETS_APPEND_ROWS_TOOL_NAME,
      GSHEETS_UPDATE_RANGE_TOOL_NAME,
    ]) {
      const tool = manifest.tools?.find((t) => t.name === toolName);
      const schema = tool?.parametersSchema as { required?: string[] };
      expect(schema.required).toContain("range");
    }
  });
});
