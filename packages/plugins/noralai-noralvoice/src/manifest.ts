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
import {
  LIST_VOICES_TOOL_NAME,
  PROVISION_VOICE_AGENT_TOOL_NAME,
  SET_AGENT_VOICE_TOOL_NAME,
} from "./tools/registry.js";

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
      {
        // Phase 3: a per-agent settings tab on the Agent detail page.
        // Host mounts this when an operator opens any agent — the
        // component itself decides whether to render (no voice_agent_uuid
        // ⇒ show the "Provision Voice Agent" CTA; uuid set ⇒ show the
        // provider+voice dropdowns).
        type: "detailTab",
        id: "noralvoice-voice-settings",
        displayName: "Voice settings",
        exportName: "VoiceSettingsTab",
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
      // The route registration itself requires `api.routes.register`;
      // the underlying provisioner inside the worker calls
      // `ctx.agents.create` which the host gates on `agents.write`
      // (declared in the top-level `capabilities` array above).
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Phase 3 — per-agent voice config surface for the VoiceSettingsTab.
    {
      // GET aggregated voice config for an agent. Resolves
      // agents.voice_agent_uuid; if set, calls NV's GET /workflow/{id}
      // and extracts the TTS provider/voice from
      // workflow_configurations.model_overrides.
      routeKey: "get_agent_voice_config",
      method: "GET",
      path: "/agents/:agentId/voice-config",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      // POST a provider+voice update for an agent. Delegates to the
      // set_agent_voice tool path; same tier-gate applies.
      routeKey: "set_agent_voice_config",
      method: "POST",
      path: "/agents/:agentId/voice-config",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      // POST a one-click provision-voice for an agent. Wraps the
      // provision_voice_agent tool so the UI doesn't have to do a tool
      // call directly.
      routeKey: "provision_voice_for_agent",
      method: "POST",
      path: "/agents/:agentId/provision-voice",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      // Board-auth surface over the list_voices tool — the
      // VoiceSettingsTab calls this to populate the voice dropdown.
      // Returns NoralVoice's catalog filtered by `?provider=`.
      routeKey: "list_voices_board",
      method: "GET",
      path: "/voices",
      auth: "board",
      capability: "api.routes.register",
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
    // Phase 3 voice-config tools.
    {
      name: LIST_VOICES_TOOL_NAME,
      displayName: "List NoralVoice TTS voices",
      description:
        "Return the available TTS voices from NoralVoice's voice catalog, optionally filtered by provider. Read-only — admits any tier. Use as a chooser before `set_agent_voice`.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: {
            type: "string",
            description: "Optional provider filter (one of NoralVoice's six TTS providers).",
            enum: ["elevenlabs", "deepgram", "sarvam", "cartesia", "dograh", "rime"],
          },
        },
      },
    },
    {
      name: SET_AGENT_VOICE_TOOL_NAME,
      displayName: "Set a NoralOS agent's voice",
      description:
        "Update the TTS provider + voice on a NoralOS agent's linked NoralVoice workflow. Requires `provision_voice_agent` to have been called first (or the agent to already carry a `voice_agent_uuid`). Mirrors the value to voice-config's local table for legacy readers. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["noralosAgentId", "provider", "voiceId"],
        properties: {
          noralosAgentId: {
            type: "string",
            description: "NoralOS agents.id (uuid).",
            format: "uuid",
          },
          provider: {
            type: "string",
            enum: ["elevenlabs", "deepgram", "sarvam", "cartesia", "dograh", "rime"],
          },
          voiceId: {
            type: "string",
            description: "Provider-scoped voice id (from `list_voices`).",
            minLength: 1,
            maxLength: 256,
          },
          voiceOptions: {
            type: "object",
            description:
              "Optional provider-specific overrides (speed, model, etc.). Merged into the workflow's model_overrides.tts block alongside provider+voice.",
            additionalProperties: true,
          },
        },
      },
    },
    {
      name: PROVISION_VOICE_AGENT_TOOL_NAME,
      displayName: "Provision a NoralVoice workflow for a NoralOS agent",
      description:
        "Create a new minimal NoralVoice workflow for an agent that doesn't yet have one and write the resulting workflow_uuid back to `agents.voice_agent_uuid`. One-shot per agent — refuses with ALREADY_PROVISIONED if a uuid is already set. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["noralosAgentId"],
        properties: {
          noralosAgentId: {
            type: "string",
            description: "NoralOS agents.id (uuid).",
            format: "uuid",
          },
          displayName: {
            type: "string",
            description:
              "Override the auto-derived workflow display name (defaults to `<agent.name> voice`).",
            maxLength: 200,
          },
          template: {
            type: "string",
            enum: ["blank", "conversational"],
            description:
              "Starter template. Both options resolve to a single-Agent-node minimal graph today; the distinction is reserved for a follow-up release that ships richer starters.",
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
  LIST_VOICES_TOOL_NAME,
  SET_AGENT_VOICE_TOOL_NAME,
  PROVISION_VOICE_AGENT_TOOL_NAME,
] as const;

export { TOOL_MIN_TIER };
