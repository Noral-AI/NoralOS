import { describe, expect, it } from "vitest";

import { manifest } from "./manifest.js";
import { PLUGIN_ID, PLUGIN_VERSION, SEND_SMS_TOOL_NAME } from "./constants.js";

describe("noralai-twilio manifest", () => {
  it("identifies itself with the locked plugin id + version", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.id).toBe("noralai.twilio");
    expect(manifest.version).toBe(PLUGIN_VERSION);
    expect(manifest.apiVersion).toBe(1);
  });

  it("declares the connector category and required capabilities", () => {
    expect(manifest.categories).toContain("connector");
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining([
        "http.outbound",
        "secrets.read-ref",
        "agent.tools.register",
        "activity.log.write",
      ]),
    );
  });

  it("points at the built worker entrypoint", () => {
    expect(manifest.entrypoints.worker).toBe("./dist/worker.js");
  });

  it("declares exactly one tool: send_sms", () => {
    expect(manifest.tools).toHaveLength(1);
    const tool = manifest.tools![0]!;
    expect(tool.name).toBe(SEND_SMS_TOOL_NAME);
    expect(tool.displayName).toBeTruthy();
    expect(tool.description.length).toBeGreaterThan(20);
  });

  it("send_sms parameter schema requires E.164 to + non-empty body, accepts optional from", () => {
    const schema = manifest.tools![0]!.parametersSchema as {
      type: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { pattern?: string; minLength?: number; maxLength?: number }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["to", "body"]));
    expect(schema.required).not.toContain("from");

    expect(schema.properties.to.pattern).toBe("^\\+[1-9]\\d{1,14}$");
    expect(schema.properties.from.pattern).toBe("^\\+[1-9]\\d{1,14}$");
    expect(schema.properties.body.minLength).toBe(1);
    expect(schema.properties.body.maxLength).toBe(1600);
  });

  it("does not declare jobs, webhooks, database, environment drivers, or UI surfaces (PR 2 is tool-only)", () => {
    expect(manifest.jobs).toBeUndefined();
    expect(manifest.webhooks).toBeUndefined();
    expect(manifest.database).toBeUndefined();
    expect(manifest.environmentDrivers).toBeUndefined();
    expect(manifest.apiRoutes).toBeUndefined();
    expect(manifest.ui).toBeUndefined();
  });
});
