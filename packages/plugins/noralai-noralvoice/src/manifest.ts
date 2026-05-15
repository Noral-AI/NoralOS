/**
 * NoralVoice plugin manifest.
 *
 * Phase 1B exposes a minimum viable agent surface against the NoralVoice
 * REST API (voice.noral.ai):
 *
 *   - `list_workflows` (worker tier)  — discover a company's voice agents.
 *   - `run_call`       (manager tier) — place an outbound call from a workflow.
 *   - `get_run`        (worker tier)  — review a run's transcript / recording / cost.
 *
 * Plus a webhook receiver (`run-completed`) that NoralVoice calls on
 * terminal workflow-run transitions; the plugin verifies the
 * HMAC-SHA256 signature against the per-company webhook secret it
 * captured at lifecycle setup, then republishes onto the NoralOS event
 * bus so the originating agent wakes.
 *
 * Credentials and the NoralVoice base URL come from the company's
 * `integration_credentials` row (provider `noralai.noralvoice`). The
 * `apiKeyRef` is an encrypted secret reference resolved on every
 * invocation — never embedded in agent state or worker memory.
 *
 * Tier gate: `run_call` is restricted to `manager` tier (and above)
 * agents. Read-only tools admit any tier. The Voice Director template
 * (`server/src/services/agent-templates/voice-director.ts`) is the
 * canonical caller; Brooklyn (CEO tier) can also drive the tools
 * directly if she delegates herself.
 */

import type { NoralosPluginManifestV1 } from "@noralos/shared";

import {
  GET_RUN_TOOL_NAME,
  LIST_WORKFLOWS_TOOL_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
  RUN_CALL_TOOL_NAME,
  RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY,
  TOOL_MIN_TIER,
} from "./constants.js";

export const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "NoralVoice",
  description:
    "Voice-AI workflow runtime for NoralOS. Wraps NoralVoice (voice.noral.ai) behind a NoralOS-branded surface. Agents can list voice workflows, place outbound calls, and review transcripts/recordings; the Voice Director template owns voice ops for the company. Lifecycle webhooks wake the originating agent on call completion.",
  author: "NoralOS",
  categories: ["connector", "voice"],

  capabilities: [
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
  ],

  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  ui: {
    slots: [
      {
        type: "sidebar",
        id: "noralvoice-sidebar-link",
        displayName: "Voice",
        exportName: "NoralVoiceSidebarLink",
      },
      {
        type: "page",
        id: "noralvoice-page",
        displayName: "NoralVoice",
        exportName: "NoralVoicePage",
        routePath: "voice",
      },
    ],
  },

  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    required: ["baseUrl", "apiKeyRef", "organizationId"],
    properties: {
      baseUrl: {
        type: "string",
        description:
          "Base URL of the NoralVoice deployment (e.g. `https://voice.noral.ai`). Override per-company only if running a dedicated NoralVoice cluster.",
        format: "uri",
        minLength: 1,
      },
      apiKeyRef: {
        type: "string",
        description:
          "Encrypted-secret reference (e.g. `company-secret:<credential-id>`) to the NoralVoice X-API-Key. Mint a key under NoralVoice → Settings → API Keys and store it as an integration credential; never paste the key directly into config.",
        format: "secret-ref",
        minLength: 1,
      },
      organizationId: {
        type: "integer",
        description:
          "NoralVoice numeric organization id the company maps to. The API key's org binding must match this value. Phase 2's integration assignment writes both fields together so they stay coherent.",
        minimum: 1,
      },
    },
  },

  webhooks: [
    {
      endpointKey: RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY,
      displayName: "Call / workflow run completed",
      description:
        "Receives NoralVoice's `run.completed` event when a workflow run transitions to a terminal state, verifies the HMAC-SHA256 signature against the per-company secret captured at lifecycle setup, then emits `noralai.noralvoice.run.completed` on the NoralOS event bus so the originating agent wakes within 5 seconds.",
    },
  ],

  apiRoutes: [
    {
      // Used by the plugin page UI to render the company's voice
      // workflows without round-tripping through an agent. Board auth =
      // NoralOS-authenticated operator session. Board-scoped routes
      // don't carry an implicit companyId, so the UI passes
      // ?companyId=<uuid>.
      routeKey: "list_workflows",
      method: "GET",
      path: "/workflows",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      // One-click provisioner that the plugin page uses to create the
      // Voice Director agent in the active company. The server resolves
      // the calling user's company; the body carries optional name
      // overrides.
      routeKey: "create_voice_director",
      method: "POST",
      path: "/voice-directors",
      auth: "board",
      capability: "agents.write",
      companyResolution: { from: "query", key: "companyId" },
    },
  ],

  tools: [
    {
      name: LIST_WORKFLOWS_TOOL_NAME,
      displayName: "List NoralVoice voice agents",
      description:
        "Return the voice agents (workflows) registered in NoralVoice for this company. Use this before `run_call` to confirm the workflow exists and to surface choices when the user is ambiguous. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of workflows to return. Defaults to 25; cap is 100.",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: RUN_CALL_TOOL_NAME,
      displayName: "Place an outbound NoralVoice call",
      description:
        "Place an outbound voice call from the given NoralVoice workflow to `toNumber`. The agent receives the run id and initial status; the call's terminal outcome arrives via the `run.completed` webhook. High-stakes — restricted to manager tier (Voice Director, Director). Worker-tier agents are blocked with a clean delegate-to-Voice-Director error.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workflowUuid", "toNumber"],
        properties: {
          workflowUuid: {
            type: "string",
            description: "NoralVoice workflow UUID to dial from (from `list_workflows`).",
            minLength: 1,
            maxLength: 64,
          },
          toNumber: {
            type: "string",
            description: "E.164 destination number, e.g. `+15555550100`.",
            pattern: "^\\+[1-9]\\d{6,14}$",
          },
          variables: {
            type: "object",
            description:
              "Optional context variables injected into the workflow's `initial_context` (e.g. customer name, deal stage).",
            additionalProperties: {
              oneOf: [
                { type: "string", maxLength: 2000 },
                { type: "number" },
                { type: "boolean" },
              ],
            },
          },
        },
      },
    },
    {
      name: GET_RUN_TOOL_NAME,
      displayName: "Get a NoralVoice run's status + transcript",
      description:
        "Look up a workflow run's current state, transcript URL, recording URL, extracted variables, and cost info. Use to answer 'did the call complete?' or to review outcomes for the salesperson. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId"],
        properties: {
          runId: {
            type: "string",
            description: "NoralVoice run id (string form, returned by `run_call`).",
            minLength: 1,
            maxLength: 64,
          },
        },
      },
    },
  ],
};

// The plugin-loader does `mod.default ?? mod` when importing the manifest
// module. The named `manifest` export above is convenient for tests and
// in-process consumers; the default export is what the host actually
// validates at install time. Mirrors the pattern in noralai-noralsign.
//
// CRITICAL: `export default manifest;` is required for the loader to find
// the manifest. Forgetting this causes a silent "no manifest found"
// failure inside the prod Docker build; pattern noted in the team's
// shared plugin-gotchas memory.
export default manifest;

/** Convenience for tests + tier-gate cross-checks. */
export const TOOL_NAMES = [
  LIST_WORKFLOWS_TOOL_NAME,
  RUN_CALL_TOOL_NAME,
  GET_RUN_TOOL_NAME,
] as const;

export { TOOL_MIN_TIER };
