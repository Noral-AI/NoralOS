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
  REVERSE_TOOL_CREATE_TASK_FOR_AGENT,
  REVERSE_TOOL_GET_AGENT_STATUS,
  REVERSE_TOOL_LOOKUP_CUSTOMER,
  REVERSE_TOOL_WEBHOOK_ENDPOINT_KEY,
  RUN_CALL_TOOL_NAME,
  RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY,
  TOOL_MIN_TIER,
} from "./constants.js";
import {
  ADD_TELEPHONY_CREDENTIAL_TOOL_NAME,
  ADD_WORKFLOW_TOOL_TOOL_NAME,
  ASSIGN_PHONE_NUMBER_TOOL_NAME,
  CREATE_CAMPAIGN_TOOL_NAME,
  CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  CREATE_WORKFLOW_TOOL_NAME,
  DELETE_WORKFLOW_TOOL_TOOL_NAME,
  GET_CAMPAIGN_TOOL_NAME,
  GET_DAILY_REPORT_TOOL_NAME,
  GET_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  GET_RECORDING_DOWNLOAD_URL_TOOL_NAME,
  GET_RUN_DETAIL_TOOL_NAME,
  LIST_CAMPAIGNS_TOOL_NAME,
  LIST_KB_DOCUMENTS_TOOL_NAME,
  LIST_RECORDINGS_TOOL_NAME,
  LIST_RUNS_TOOL_NAME,
  LIST_TELEPHONY_CREDENTIALS_TOOL_NAME,
  LIST_VOICES_TOOL_NAME,
  PAUSE_CAMPAIGN_TOOL_NAME,
  PROVISION_VOICE_AGENT_TOOL_NAME,
  REDIAL_CAMPAIGN_TOOL_NAME,
  RESUME_CAMPAIGN_TOOL_NAME,
  REVOKE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
  SEARCH_KB_TOOL_NAME,
  SET_AGENT_VOICE_TOOL_NAME,
  START_CAMPAIGN_TOOL_NAME,
  UPDATE_WORKFLOW_TOOL_TOOL_NAME,
  UPLOAD_KB_DOCUMENT_TOOL_NAME,
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
    "ui.detailTab.register",
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
        // Mount only on the Agent detail page — voice settings are per-agent.
        entityTypes: ["agent"],
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
    {
      // Phase 5d — inbound endpoint for `noralos://` reverse-RPC
      // dispatches from a NoralVoice workflow Agent node. Receives the
      // signed envelope, verifies HMAC against the per-company
      // `reverseRpcSecret` stored at lifecycle setup, dispatches to
      // the corresponding `onReverseTool` handler.
      endpointKey: REVERSE_TOOL_WEBHOOK_ENDPOINT_KEY,
      displayName: "Reverse-RPC tool dispatch",
      description:
        "Inbound endpoint for `noralos://<pluginId>/<toolName>` tool dispatches from NoralVoice workflow Agent nodes. NoralVoice signs the envelope with the per-company reverse_rpc_secret captured at lifecycle setup; the worker verifies HMAC and routes the payload through `onReverseTool` to the matching handler in `reverse-tools.ts`.",
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
    // ── Phase 4 PR-A: browse surfaces ──────────────────────────────────
    // All board-auth, company-resolved from ?companyId=<uuid>. The
    // worker delegates each to the corresponding noralvoice-client
    // helper; NV error categories are mapped to consistent shapes so
    // the UI's react-query layer can render error states uniformly.
    {
      routeKey: "list_runs",
      method: "GET",
      path: "/runs",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "get_run_detail",
      method: "GET",
      path: "/runs/:runId",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "list_recordings",
      method: "GET",
      path: "/recordings",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "get_recording_download_url",
      method: "GET",
      path: "/recordings/:id/download-url",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "search_kb",
      method: "POST",
      path: "/kb/search",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "list_kb_documents",
      method: "GET",
      path: "/kb/documents",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "list_campaigns",
      method: "GET",
      path: "/campaigns",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "get_campaign",
      method: "GET",
      path: "/campaigns/:id",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "list_telephony_numbers",
      method: "GET",
      path: "/telephony/numbers",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "list_telephony_providers",
      method: "GET",
      path: "/telephony/providers",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "get_usage_current",
      method: "GET",
      path: "/usage/current-period",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // ── Phase 4 PR-B: interact surfaces ────────────────────────────────
    {
      // Mint a one-shot embed token for the iframed workflow builder.
      // Body: { workflowUuid: string }. Plugin worker calls NV's
      // POST /api/v1/embed/exchange-token (Phase 1 PR-A) with the
      // current operator's email as target_user_email and
      // /workflow/<uuid> as target_path. Returns the embed URL ready
      // to drop into <iframe src>.
      routeKey: "create_workflow_embed_token",
      method: "POST",
      path: "/workflows/:uuid/embed-token",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      // Server-side process control for the live transcript pump
      // (PR-B B2). The pump itself runs in a NoralOS server service
      // (NOT the plugin worker — plugin workers don't support
      // long-lived WS subscriptions cleanly; see commit message for
      // the architecture decision). This endpoint lets the worker
      // tell the server to start/stop a pump for a given run.
      routeKey: "transcript_pump_control",
      method: "POST",
      path: "/transcript-pump/control",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Phase 6 PR-2 — TTS proxy for Dashboard agent-voice autoplay.
    //
    // Browser-side `useChatVoiceAutoplay` POSTs here with the comment
    // text; the worker forwards to NoralVoice's POST
    // /api/v1/public/embed/synthesize with the plugin's apiKey (via
    // X-API-Key — the dual-auth path landed in NoralVoice #10). The
    // worker never lets the apiKey reach the browser; the response is
    // just `{audioUrl, contentType, durationSeconds, ...}` for the
    // browser to play.
    //
    // 422 `text_blocked_exfiltration` is surfaced as `ok: false` so
    // the autoplay hook can no-op cleanly (matches voice-cascade's
    // contract for the same scenario).
    {
      routeKey: "synthesize",
      method: "POST",
      path: "/synthesize",
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
    // ---- Phase 7 — promoted read tools ----
    {
      name: LIST_RUNS_TOOL_NAME,
      displayName: "List a workflow's recent runs",
      description:
        "List runs (one per call attempt) for a NoralVoice workflow. Use to answer 'how many calls did workflow X make this week?' or to find a specific run. Read-only — admits any tier. Paginated via opaque cursor.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workflowUuid"],
        properties: {
          workflowUuid: {
            type: "string",
            description: "NoralVoice workflow UUID (from `list_workflows`).",
            minLength: 1,
            maxLength: 64,
          },
          limit: {
            type: "integer",
            description: "Max runs to return (1..100, default 25).",
            minimum: 1,
            maximum: 100,
          },
          cursor: {
            type: "string",
            description: "Opaque pagination cursor from a prior response.",
            maxLength: 256,
          },
        },
      },
    },
    {
      name: LIST_CAMPAIGNS_TOOL_NAME,
      displayName: "List NoralVoice campaigns",
      description:
        "List campaigns (multi-call outbound dialing batches) for this organization. Optionally filter by status. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: {
            type: "string",
            description:
              "Optional status filter (e.g. 'pending', 'running', 'paused', 'completed').",
            maxLength: 32,
          },
          limit: {
            type: "integer",
            description: "Max campaigns to return (1..100, default 25).",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: GET_CAMPAIGN_TOOL_NAME,
      displayName: "Get a NoralVoice campaign",
      description:
        "Look up a specific campaign by its numeric id (from `list_campaigns`). Returns status, workflow link, and progress snapshot. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["campaignId"],
        properties: {
          campaignId: {
            type: "integer",
            description: "NoralVoice campaign id.",
            minimum: 1,
          },
        },
      },
    },
    {
      name: SEARCH_KB_TOOL_NAME,
      displayName: "Search the NoralVoice knowledge base",
      description:
        "Semantic search over the organization's knowledge-base chunks (uploaded documents NoralVoice agents reference mid-call). Returns ranked chunks with their source document. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Natural-language query to embed and match against KB chunks.",
            minLength: 1,
            maxLength: 1000,
          },
          limit: {
            type: "integer",
            description: "Max chunks to return (1..50, default 10).",
            minimum: 1,
            maximum: 50,
          },
        },
      },
    },
    // Phase 7 PR-J — telephony credential + phone-number management.
    {
      name: ADD_TELEPHONY_CREDENTIAL_TOOL_NAME,
      displayName: "Add a telephony provider credential",
      description:
        "Save a telephony provider credential (e.g. Twilio account_sid + auth_token) under a friendly name. Required before any phone numbers can be assigned to workflows or outbound calls can be placed via that provider. Sensitive fields are stored encrypted and only masked previews are returned. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "provider", "credentials"],
        properties: {
          name: {
            type: "string",
            description:
              "Friendly name for this credential within the org (e.g. \"Main Twilio account\"). Must be unique per organization.",
            minLength: 1,
            maxLength: 64,
          },
          provider: {
            type: "string",
            description: "Telephony provider this credential is for.",
            enum: [
              "twilio",
              "plivo",
              "vonage",
              "vobiz",
              "cloudonix",
              "ari",
              "telnyx",
            ],
          },
          credentials: {
            type: "object",
            description:
              "Provider-specific credential fields. For Twilio: { account_sid, auth_token }. NoralVoice validates the shape against a discriminated union; shapes for other providers live in NoralVoice's provider registry.",
            additionalProperties: { type: "string" },
          },
          isDefaultOutbound: {
            type: "boolean",
            description:
              "When true, marks this credential as the org's default for outbound calls. Only one credential per org can hold this flag; setting it on a new credential unsets the previous default.",
          },
        },
      },
    },
    {
      name: LIST_TELEPHONY_CREDENTIALS_TOOL_NAME,
      displayName: "List the org's telephony credentials",
      description:
        "List configured telephony provider credentials with their names, providers, and how many phone numbers are attached. Credentials themselves are NOT returned (NoralVoice's list endpoint omits them entirely); use this to find a configId to pass to `assign_phone_number_to_workflow`. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: ASSIGN_PHONE_NUMBER_TOOL_NAME,
      displayName: "Assign a phone number to a workflow",
      description:
        "Register a phone number under a telephony credential and (optionally) route inbound calls on that number to a workflow. When `inboundWorkflowId` is set, NoralVoice attempts to auto-sync the inbound webhook to the provider (works for Twilio when the credential has write access to the number). When auto-sync fails, the tool returns an `inboundWebhookUrl` the user must paste into the provider's console manually. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["configId", "address"],
        properties: {
          configId: {
            type: "integer",
            description:
              "Telephony configuration id (from `list_telephony_credentials` or returned by `add_telephony_credential`).",
            minimum: 1,
          },
          address: {
            type: "string",
            description:
              "Phone number in E.164 format (e.g. `+15555550100`). Must be a number you own under the provider this configId points at.",
            pattern: "^\\+[1-9]\\d{6,14}$",
          },
          inboundWorkflowId: {
            type: "integer",
            description:
              "Optional NoralVoice workflow id to route inbound calls to. Omit if this number is for outbound use only.",
            minimum: 1,
          },
          countryCode: {
            type: "string",
            description: "Optional ISO-3166-1 alpha-2 country code (e.g. \"US\", \"GB\").",
            minLength: 2,
            maxLength: 2,
          },
          label: {
            type: "string",
            description: "Optional human-readable label for the number (e.g. \"Sales line\").",
            maxLength: 64,
          },
          isDefaultCallerId: {
            type: "boolean",
            description:
              "Whether to use this number as the default outbound caller id under this telephony configuration.",
          },
        },
      },
    },
    // ── Phase 9C — Tier 1 write tools (manager) ──────────────────────────────
    {
      name: CREATE_WORKFLOW_TOOL_NAME,
      displayName: "Create a NoralVoice workflow",
      description:
        "Create a new voice workflow definition in NoralVoice. Returns the numeric id, uuid, and name. Optionally supply a `workflowDefinition` graph; when omitted a minimal single-agent starter is used. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: {
            type: "string",
            description: "Display name for the new workflow.",
            minLength: 1,
            maxLength: 200,
          },
          workflowDefinition: {
            type: "object",
            description:
              "Optional workflow graph (nodes + edges). When omitted, a minimal conversational starter is used.",
            additionalProperties: true,
          },
        },
      },
    },
    {
      name: SAVE_WORKFLOW_TOOL_NAME,
      displayName: "Save a NoralVoice workflow",
      description:
        "Update an existing workflow's definition and/or name. Requires the numeric workflow id (from `list_workflows` or `create_workflow`). The `workflowDefinition` replaces the current graph wholesale — read the existing definition first if you only want a partial edit. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId", "workflowDefinition"],
        properties: {
          workflowId: {
            type: "integer",
            description: "NoralVoice numeric workflow id.",
            minimum: 1,
          },
          name: {
            type: "string",
            description: "Optional new display name.",
            minLength: 1,
            maxLength: 200,
          },
          workflowDefinition: {
            type: "object",
            description: "Replacement workflow graph (nodes + edges).",
            additionalProperties: true,
          },
        },
      },
    },
    {
      name: CREATE_CAMPAIGN_TOOL_NAME,
      displayName: "Create an outbound campaign",
      description:
        "Create a new multi-call outbound dialing campaign from a contact list (Google Sheet or CSV). The campaign is created in a paused state — call `start_campaign` to begin dialing. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "workflowId", "sourceType", "sourceId"],
        properties: {
          name: {
            type: "string",
            description: "Campaign display name.",
            minLength: 1,
            maxLength: 200,
          },
          workflowId: {
            type: "integer",
            description: "NoralVoice numeric workflow id to run for each contact.",
            minimum: 1,
          },
          sourceType: {
            type: "string",
            description: "Contact-list source type.",
            enum: ["google-sheet", "csv"],
          },
          sourceId: {
            type: "string",
            description:
              "Source identifier — Google Sheet id or CSV file path/url within NoralVoice's storage.",
            minLength: 1,
          },
          telephonyConfigurationId: {
            type: "integer",
            description: "Optional telephony configuration id (from `list_telephony_credentials`).",
            minimum: 1,
          },
          maxConcurrency: {
            type: "integer",
            description: "Optional maximum simultaneous calls. Defaults server-side.",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: START_CAMPAIGN_TOOL_NAME,
      displayName: "Start a NoralVoice campaign",
      description:
        "Start a previously created campaign (transitions it from `pending` to `running`). Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["campaignId"],
        properties: {
          campaignId: {
            type: "integer",
            description: "NoralVoice campaign id (from `list_campaigns` or `create_campaign`).",
            minimum: 1,
          },
        },
      },
    },
    {
      name: UPLOAD_KB_DOCUMENT_TOOL_NAME,
      displayName: "Upload a knowledge-base document",
      description:
        "Upload a document to the NoralVoice knowledge base so voice agents can reference it mid-call. Supply raw file bytes as a base64-encoded string in `contentBase64` — URL-based uploads are NOT supported. The upload is a three-step process (pre-sign → PUT → register); the returned `document_uuid` can be used to track processing status via `list_kb_documents`. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["filename", "contentBase64"],
        properties: {
          filename: {
            type: "string",
            description: "Original filename, including extension (e.g. `product-faq.pdf`).",
            minLength: 1,
            maxLength: 256,
          },
          contentBase64: {
            type: "string",
            description:
              "Base64-encoded file bytes. Must be raw bytes — do NOT pass a URL. Max recommended size is 10 MB encoded.",
            minLength: 1,
          },
          contentType: {
            type: "string",
            description:
              "Optional MIME type (e.g. `application/pdf`, `text/plain`). Defaults to `application/octet-stream`.",
            maxLength: 128,
          },
        },
      },
    },
    {
      name: ADD_WORKFLOW_TOOL_TOOL_NAME,
      displayName: "Add a function-tool to NoralVoice",
      description:
        "Register a new function-tool definition in NoralVoice (a callable tool available inside workflow Agent nodes). Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "toolDefinition"],
        properties: {
          name: {
            type: "string",
            description: "Tool name (unique per org).",
            minLength: 1,
            maxLength: 128,
          },
          description: {
            type: "string",
            description: "Human-readable description for the LLM.",
            minLength: 1,
            maxLength: 1000,
          },
          toolDefinition: {
            type: "object",
            description: "JSON Schema–style tool definition (input_schema, etc.).",
            additionalProperties: true,
          },
        },
      },
    },
    {
      name: UPDATE_WORKFLOW_TOOL_TOOL_NAME,
      displayName: "Update a NoralVoice function-tool",
      description:
        "Update an existing workflow function-tool's name, description, or definition. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["toolUuid"],
        properties: {
          toolUuid: {
            type: "string",
            description: "UUID of the workflow tool to update.",
            minLength: 1,
            maxLength: 64,
          },
          name: {
            type: "string",
            description: "New name.",
            minLength: 1,
            maxLength: 128,
          },
          description: {
            type: "string",
            description: "New description.",
            minLength: 1,
            maxLength: 1000,
          },
          toolDefinition: {
            type: "object",
            description: "Replacement tool definition.",
            additionalProperties: true,
          },
        },
      },
    },
    {
      name: DELETE_WORKFLOW_TOOL_TOOL_NAME,
      displayName: "Delete a NoralVoice function-tool",
      description:
        "Archive (soft-delete) a workflow function-tool. Archived tools are removed from all workflow Agent nodes that reference them. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["toolUuid"],
        properties: {
          toolUuid: {
            type: "string",
            description: "UUID of the workflow tool to archive.",
            minLength: 1,
            maxLength: 64,
          },
        },
      },
    },
    // ── Phase 9C — Tier 2 read tools (worker) ────────────────────────────────
    {
      name: GET_RUN_DETAIL_TOOL_NAME,
      displayName: "Get a run's full detail",
      description:
        "Return the complete record for a workflow run — state, transcript URL, recording URL, gathered context (extracted variables), and cost info. Use when you need more fields than `get_run` provides (which is the Phase 1B summary). Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId"],
        properties: {
          runId: {
            type: "string",
            description: "NoralVoice run id (string, from `run_call` or `list_runs`).",
            minLength: 1,
            maxLength: 64,
          },
        },
      },
    },
    {
      name: LIST_RECORDINGS_TOOL_NAME,
      displayName: "List NoralVoice recordings",
      description:
        "List TTS recordings stored in NoralVoice, optionally filtered by workflow. Returns metadata (id, duration, provider, voice). Use `get_recording_download_url` to get a playback link. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          workflowId: {
            type: "integer",
            description: "Optional numeric workflow id to filter by.",
            minimum: 1,
          },
          limit: {
            type: "integer",
            description: "Maximum recordings to return (1..100, default 25).",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: GET_RECORDING_DOWNLOAD_URL_TOOL_NAME,
      displayName: "Get a recording download URL",
      description:
        "Return a short-lived pre-signed URL to download a specific recording by its numeric id (from `list_recordings`). Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["recordingId"],
        properties: {
          recordingId: {
            type: "integer",
            description: "NoralVoice recording id.",
            minimum: 1,
          },
        },
      },
    },
    {
      name: LIST_KB_DOCUMENTS_TOOL_NAME,
      displayName: "List knowledge-base documents",
      description:
        "List documents in the NoralVoice knowledge base, optionally filtered by processing status (e.g. 'ready', 'processing', 'failed'). Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: {
            type: "string",
            description: "Optional status filter (e.g. 'ready', 'processing', 'failed').",
            maxLength: 32,
          },
          limit: {
            type: "integer",
            description: "Maximum documents to return (1..100, default 25).",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: GET_DAILY_REPORT_TOOL_NAME,
      displayName: "Get the daily activity report",
      description:
        "Return a daily summary of call activity: total calls, completed/failed counts, average duration, cost, and per-workflow breakdown. `date` defaults server-side to today. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: {
            type: "string",
            description:
              "ISO-8601 date (YYYY-MM-DD) for which to fetch the report. Defaults to today.",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          },
        },
      },
    },
    // ── Phase 9D — Tier 3 write tools (manager) ───────────────────────────────
    {
      name: PAUSE_CAMPAIGN_TOOL_NAME,
      displayName: "Pause a NoralVoice campaign",
      description:
        "Pause a running campaign. The campaign transitions to `paused` state; in-flight calls finish before dialing stops. Call `resume_campaign` to continue. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["campaignId"],
        properties: {
          campaignId: {
            type: "integer",
            description: "NoralVoice campaign id (from `list_campaigns` or `create_campaign`).",
            minimum: 1,
          },
        },
      },
    },
    {
      name: RESUME_CAMPAIGN_TOOL_NAME,
      displayName: "Resume a NoralVoice campaign",
      description:
        "Resume a paused campaign. The campaign transitions back to `running` state and continues dialing from where it left off. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["campaignId"],
        properties: {
          campaignId: {
            type: "integer",
            description: "NoralVoice campaign id.",
            minimum: 1,
          },
        },
      },
    },
    {
      name: REDIAL_CAMPAIGN_TOOL_NAME,
      displayName: "Redial a NoralVoice campaign",
      description:
        "Create a new campaign that retries contacts from an existing campaign based on their call outcome. At least one retry flag should be true. Returns the new redial campaign (initially in `pending` state — call `start_campaign` to begin dialing). Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["campaignId"],
        properties: {
          campaignId: {
            type: "integer",
            description: "Source campaign id to redial from.",
            minimum: 1,
          },
          name: {
            type: "string",
            description: "Optional name for the new redial campaign.",
            minLength: 1,
            maxLength: 256,
          },
          retryOnVoicemail: {
            type: "boolean",
            description: "Retry contacts who reached voicemail.",
          },
          retryOnNoAnswer: {
            type: "boolean",
            description: "Retry contacts who did not answer.",
          },
          retryOnBusy: {
            type: "boolean",
            description: "Retry contacts whose line was busy.",
          },
        },
      },
    },
    {
      name: CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
      displayName: "Create a persistent embed token",
      description:
        "Create a long-lived embed token for a NoralVoice workflow and store it as a plugin-scoped company secret. Returns a secret ref string (not the raw token) that can be passed to the NoralVoice widget. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: {
            type: "integer",
            description: "NoralVoice workflow id.",
            minimum: 1,
          },
          expiresInDays: {
            type: "integer",
            description: "Token validity in days (optional; server default applies when omitted).",
            minimum: 1,
            maximum: 365,
          },
        },
      },
    },
    {
      name: GET_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
      displayName: "Get the stored embed token ref",
      description:
        "Return the secret ref for a previously created embed token. Returns null if no token has been created for this workflow — call `create_persistent_embed_token` first. Never returns the raw token. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: {
            type: "integer",
            description: "NoralVoice workflow id.",
            minimum: 1,
          },
        },
      },
    },
    {
      name: REVOKE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
      displayName: "Revoke a persistent embed token",
      description:
        "Revoke the active embed token for a workflow in NoralVoice and delete the stored secret ref. Any widget instances using the token will become invalid. Returns `{ revoked: true }`. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: {
            type: "integer",
            description: "NoralVoice workflow id.",
            minimum: 1,
          },
        },
      },
    },
  ],

  // Phase 5d — reverse-tools the plugin accepts inbound from external
  // systems (NoralVoice's `noralos://` workflow tool URL scheme).
  // Runtime dispatch happens in `worker.ts#onReverseTool`, which routes
  // by `toolName` into the implementations in `reverse-tools.ts`. The
  // schemas below are advisory documentation — argument validation
  // happens inside each handler.
  reverseTools: [
    {
      toolName: REVERSE_TOOL_GET_AGENT_STATUS,
      displayName: "Get NoralOS agent status",
      description:
        "Look up a NoralOS agent in the calling company and return whether it's active/idle/offline plus pageability. Read-only; the calling voice agent uses this to decide whether to escalate to or page a NoralOS worker mid-call.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agent_id"],
        properties: {
          agent_id: {
            type: "string",
            description: "UUID of the target NoralOS agent.",
            format: "uuid",
          },
        },
      },
    },
    {
      toolName: REVERSE_TOOL_CREATE_TASK_FOR_AGENT,
      displayName: "Create a task for a NoralOS agent",
      description:
        "Create a new task (issue) on the NoralOS side targeting the given agent. The calling voice agent uses this to delegate follow-up work mid-call (e.g. 'log this customer's question for the support team'). NOT_IMPLEMENTED in Phase 5; landing in a follow-up that wires ctx.tasks.create through the SDK.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agent_id", "title", "body"],
        properties: {
          agent_id: { type: "string", description: "Target agent UUID.", format: "uuid" },
          title: { type: "string", description: "Short task title.", minLength: 1 },
          body: { type: "string", description: "Detailed task description / context." },
          priority: {
            type: "string",
            description: "Optional task priority.",
            enum: ["low", "normal", "high"],
          },
        },
      },
    },
    {
      toolName: REVERSE_TOOL_LOOKUP_CUSTOMER,
      displayName: "Look up a customer by identifier",
      description:
        "Resolve a customer record from the calling company's CRM-like data, given an email / phone / customer_id identifier. NOT_CONFIGURED unless the company has registered a customer-lookup hook on the host; lands when the hook surface ships.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["identifier"],
        properties: {
          identifier: {
            type: "string",
            description: "Email, phone number, or customer_id to resolve.",
            minLength: 1,
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
