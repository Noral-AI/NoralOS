import { describe, expect, it } from "vitest";

import {
  GET_RUN_TOOL_NAME,
  LIST_WORKFLOWS_TOOL_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
  RUN_CALL_TOOL_NAME,
  RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY,
  TOOL_MIN_TIER,
} from "./constants.js";
import { manifest } from "./manifest.js";

const EXPECTED_TOOLS = [LIST_WORKFLOWS_TOOL_NAME, RUN_CALL_TOOL_NAME, GET_RUN_TOOL_NAME];

describe("noralai-noralvoice manifest", () => {
  it("identifies itself with the locked plugin id + version", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.id).toBe("noralai.noralvoice");
    expect(manifest.version).toBe(PLUGIN_VERSION);
    expect(manifest.apiVersion).toBe(1);
  });

  it("uses the NoralVoice display name + the voice + connector categories", () => {
    expect(manifest.displayName).toBe("NoralVoice");
    expect(manifest.categories).toEqual(expect.arrayContaining(["connector", "voice"]));
  });

  it("declares the capability set required for tools, webhooks, agents.write, and UI slots", () => {
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining([
        "http.outbound",
        "secrets.read-ref",
        "agent.tools.register",
        "activity.log.write",
        "agents.read",
        "agents.write",
        "webhooks.receive",
        "events.emit",
        "api.routes.register",
        "ui.sidebar.register",
        "ui.page.register",
      ]),
    );
  });

  it("requires baseUrl + apiKeyRef + organizationId in instance config", () => {
    const schema = manifest.instanceConfigSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { format?: string; minLength?: number; minimum?: number }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining(["baseUrl", "apiKeyRef", "organizationId"]),
    );
    expect(schema.properties.baseUrl.format).toBe("uri");
    expect(schema.properties.apiKeyRef.format).toBe("secret-ref");
    expect(schema.properties.organizationId.minimum).toBe(1);
  });

  it("declares the run-completed webhook endpoint key", () => {
    expect(manifest.webhooks).toBeDefined();
    const keys = manifest.webhooks!.map((w) => w.endpointKey);
    expect(keys).toContain(RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY);
  });

  it("declares the list_workflows board apiRoute with companyId from query", () => {
    const route = manifest.apiRoutes!.find((r) => r.routeKey === "list_workflows")!;
    expect(route).toBeDefined();
    expect(route.method).toBe("GET");
    expect(route.path).toBe("/workflows");
    expect(route.auth).toBe("board");
    expect(route.companyResolution).toEqual({ from: "query", key: "companyId" });
  });

  it("declares all 35 agent tools across phases 1B, 3, 7-read, 7-PR-J telephony, 9C, 9D, 10A, and 11", () => {
    // Phase 1B starters (list_workflows, run_call, get_run) +
    // Phase 3 voice-config (list_voices, set_agent_voice, provision_voice_agent) +
    // Phase 7 read tools (list_runs, list_campaigns, get_campaign, search_kb) +
    // Phase 7 PR-J telephony (add_telephony_credential, list_telephony_credentials,
    // assign_phone_number_to_workflow) +
    // Phase 9C Tier-1 writes (create_workflow, save_workflow, create_campaign,
    // start_campaign, upload_kb_document, add_workflow_tool, update_workflow_tool,
    // delete_workflow_tool) +
    // Phase 9C Tier-2 reads (get_run_detail, list_recordings,
    // get_recording_download_url, list_kb_documents, get_daily_report) +
    // Phase 9D Tier-3 writes (pause_campaign, resume_campaign, redial_campaign,
    // create_persistent_embed_token, get_persistent_embed_token,
    // revoke_persistent_embed_token) +
    // Phase 10A workflow lifecycle (validate_workflow, publish_workflow) +
    // Phase 11 seed-template builder (apply_workflow_parameters).
    expect(manifest.tools).toHaveLength(35);
    const names = manifest.tools!.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_TOOLS));
    expect(names).toEqual(
      expect.arrayContaining(["list_voices", "set_agent_voice", "provision_voice_agent"]),
    );
    expect(names).toEqual(
      expect.arrayContaining(["list_runs", "list_campaigns", "get_campaign", "search_kb"]),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "add_telephony_credential",
        "list_telephony_credentials",
        "assign_phone_number_to_workflow",
      ]),
    );
    // Phase 9C Tier-1 writes
    expect(names).toEqual(
      expect.arrayContaining([
        "create_workflow",
        "save_workflow",
        "create_campaign",
        "start_campaign",
        "upload_kb_document",
        "add_workflow_tool",
        "update_workflow_tool",
        "delete_workflow_tool",
      ]),
    );
    // Phase 9C Tier-2 reads
    expect(names).toEqual(
      expect.arrayContaining([
        "get_run_detail",
        "list_recordings",
        "get_recording_download_url",
        "list_kb_documents",
        "get_daily_report",
      ]),
    );
    // Phase 9D Tier-3 writes
    expect(names).toEqual(
      expect.arrayContaining([
        "pause_campaign",
        "resume_campaign",
        "redial_campaign",
        "create_persistent_embed_token",
        "get_persistent_embed_token",
        "revoke_persistent_embed_token",
      ]),
    );
    // Phase 10A — workflow lifecycle (close the agent-authoring loop)
    expect(names).toEqual(
      expect.arrayContaining(["validate_workflow", "publish_workflow"]),
    );
    // Phase 11 — seed-template builder (fill named parameters on a clone)
    expect(names).toEqual(expect.arrayContaining(["apply_workflow_parameters"]));
  });

  it("run_call parametersSchema enforces E.164 + requires workflowUuid+toNumber", () => {
    const tool = manifest.tools!.find((t) => t.name === RUN_CALL_TOOL_NAME)!;
    const schema = tool.parametersSchema as {
      required: string[];
      properties: Record<string, { pattern?: string; type?: string }>;
    };
    expect(schema.required).toEqual(expect.arrayContaining(["workflowUuid", "toNumber"]));
    expect(schema.properties.toNumber.pattern).toBeDefined();
    expect(schema.properties.toNumber.pattern).toMatch(/\^\\\+/);
  });

  it("tier-gate metadata: run_call requires manager; read-only tools admit worker", () => {
    expect(TOOL_MIN_TIER[RUN_CALL_TOOL_NAME]).toBe("manager");
    expect(TOOL_MIN_TIER[LIST_WORKFLOWS_TOOL_NAME]).toBe("worker");
    expect(TOOL_MIN_TIER[GET_RUN_TOOL_NAME]).toBe("worker");
  });

  it("manifest exports a default for the plugin loader (otherwise prod build fails silently)", async () => {
    const mod = await import("./manifest.js");
    expect(mod.default).toBeDefined();
    expect((mod.default as { id?: string }).id).toBe(PLUGIN_ID);
  });
});
