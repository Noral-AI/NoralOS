import { describe, expect, it } from "vitest";

import { manifest } from "./manifest.js";
import {
  CREATE_SUBMISSION_TOOL_NAME,
  DOCUSEAL_WEBHOOK_ENDPOINT_KEY,
  DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME,
  GET_SUBMISSION_TOOL_NAME,
  GET_TEMPLATE_TOOL_NAME,
  LIST_SUBMISSIONS_TOOL_NAME,
  LIST_TEMPLATES_TOOL_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
  REMIND_SIGNER_TOOL_NAME,
  VOID_SUBMISSION_TOOL_NAME,
} from "./constants.js";

const EXPECTED_TOOL_NAMES = [
  LIST_TEMPLATES_TOOL_NAME,
  GET_TEMPLATE_TOOL_NAME,
  CREATE_SUBMISSION_TOOL_NAME,
  GET_SUBMISSION_TOOL_NAME,
  LIST_SUBMISSIONS_TOOL_NAME,
  VOID_SUBMISSION_TOOL_NAME,
  REMIND_SIGNER_TOOL_NAME,
  DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME,
];

describe("noralai-noralsign manifest", () => {
  it("identifies itself with the locked plugin id + version", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.id).toBe("noralai.noralsign");
    expect(manifest.version).toBe(PLUGIN_VERSION);
    expect(manifest.apiVersion).toBe(1);
  });

  it("declares the connector category and full capability set for tools+webhooks+events+routes", () => {
    expect(manifest.categories).toContain("connector");
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining([
        "http.outbound",
        "secrets.read-ref",
        "agent.tools.register",
        "activity.log.write",
        "agents.read",
        "webhooks.receive",
        "events.emit",
        "api.routes.register",
      ]),
    );
  });

  it("uses a NoralSign-branded display name (not DocuSeal)", () => {
    expect(manifest.displayName).toBe("NoralSign");
    expect(manifest.description).toMatch(/NoralOS-branded/i);
  });

  it("requires apiUrl + apiTokenRef in instance config", () => {
    const schema = manifest.instanceConfigSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { format?: string; minLength?: number }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["apiUrl", "apiTokenRef"]));
    expect(schema.properties.apiUrl.format).toBe("uri");
    expect(schema.properties.apiTokenRef.minLength).toBe(1);
  });

  it("declares the full eight-tool contract-routing surface", () => {
    expect(manifest.tools).toHaveLength(EXPECTED_TOOL_NAMES.length);
    const names = manifest.tools!.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_TOOL_NAMES));
  });

  it("create_submission_from_template requires templateId + non-empty submitters array", () => {
    const tool = manifest.tools!.find((t) => t.name === CREATE_SUBMISSION_TOOL_NAME)!;
    const schema = tool.parametersSchema as {
      required: string[];
      properties: Record<string, { type?: string; minItems?: number }>;
    };
    expect(schema.required).toEqual(expect.arrayContaining(["templateId", "submitters"]));
    expect(schema.properties.submitters.type).toBe("array");
    expect(schema.properties.submitters.minItems).toBe(1);
  });

  it("declares the docuseal-events webhook receiver", () => {
    expect(manifest.webhooks).toHaveLength(1);
    expect(manifest.webhooks![0]!.endpointKey).toBe(DOCUSEAL_WEBHOOK_ENDPOINT_KEY);
    expect(manifest.webhooks![0]!.endpointKey).toBe("docuseal-events");
  });

  it("declares the dashboard apiRoute for GET /templates", () => {
    expect(manifest.apiRoutes).toHaveLength(1);
    const route = manifest.apiRoutes![0]!;
    expect(route.routeKey).toBe("list_templates");
    expect(route.method).toBe("GET");
    expect(route.path).toBe("/templates");
    expect(route.auth).toBe("board");
  });

  it("declares both a sidebar slot and a company-scoped page slot", () => {
    const slots = manifest.ui?.slots ?? [];
    expect(slots).toHaveLength(2);
    const sidebar = slots.find((s) => s.type === "sidebar");
    const page = slots.find((s) => s.type === "page");
    expect(sidebar).toBeDefined();
    expect(sidebar!.exportName).toBe("NoralSignSidebarLink");
    expect(page).toBeDefined();
    expect(page!.exportName).toBe("NoralSignTemplatesPage");
    expect(page!.routePath).toBe("noralsign");
  });

  it("declares a UI entrypoint when UI slots exist (manifest validator requires it)", () => {
    expect(manifest.entrypoints.ui).toBeDefined();
    expect(manifest.entrypoints.ui).toBe("./dist/ui");
  });

  it("declares the UI capabilities required to render sidebar + page slots", () => {
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining(["ui.sidebar.register", "ui.page.register"]),
    );
  });

  it("does not declare database or environment drivers (out of scope for Phase 1)", () => {
    expect(manifest.database).toBeUndefined();
    expect(manifest.environmentDrivers).toBeUndefined();
  });
});
