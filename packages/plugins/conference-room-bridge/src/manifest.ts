import type { NoralosPluginManifestV1 } from "@noralos/plugin-sdk";
import {
  API_ROUTE_KEYS,
  NAMESPACE_SLUG,
  PLUGIN_ID,
  PLUGIN_VERSION,
} from "./constants.js";

export const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Conference Room Bridge",
  description:
    "Connects the Pipecat-based Conference Room service to NoralOS Paperclip agent sessions and to voice-cascade for TTS. Routes incoming user transcripts to a target agent (defaulting to the company CEO/Brooklyn), waits for the agent's response, and hands the final text to voice-cascade. Enforces voice-config eligibility on every session creation. Workers are not selectable by default.",
  author: "NoralOS",
  categories: ["connector", "automation"],

  capabilities: [
    "companies.read",
    "agents.read",
    "agent.sessions.create",
    "agent.sessions.list",
    "agent.sessions.send",
    "agent.sessions.close",
    "events.subscribe",
    "events.emit",
    "api.routes.register",
    "secrets.read-ref",
    "database.namespace.read",
    "database.namespace.write",
    "database.namespace.migrate",
    "activity.log.write",
    "ui.sidebar.register",
    "ui.page.register",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  database: {
    namespaceSlug: NAMESPACE_SLUG,
    migrationsDir: "./migrations",
    coreReadTables: ["agents", "companies"],
  },

  ui: {
    // Sidebar launchers (placementZone:"sidebar") aren't currently surfaced by
    // the host — Sidebar.tsx mounts <PluginSlotOutlet slotTypes={["sidebar"]}>
    // but no <PluginLauncherOutlet placementZones={["sidebar"]}>. Until that
    // host gap is filled, we ship a sidebar SLOT with a tiny external-link
    // component that visually matches a SidebarNavItem.
    slots: [
      {
        type: "sidebar",
        id: "conference-room-sidebar-link",
        displayName: "Conference Room",
        exportName: "ConferenceRoomSidebarLink",
      },
      {
        type: "page",
        id: "conference-room-page",
        displayName: "Conference Room",
        exportName: "ConferenceRoomPage",
        // Reachable at /<companyPrefix>/conference-room — gives the sidebar a
        // stable, human-readable URL that doesn't depend on plugin UUIDs.
        routePath: "conference-room",
      },
    ],
  },

  apiRoutes: [
    // Pipecat creates a conference session and tells us which agent it should
    // be bound to. Bridge resolves the target (defaulting to CEO), checks
    // voice-config eligibility, and starts a Paperclip AgentSession.
    {
      routeKey: API_ROUTE_KEYS.createSession,
      method: "POST",
      path: "/sessions",
      auth: "agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Pipecat sends an utterance transcript. Bridge forwards it to the agent
    // session and returns IMMEDIATELY with { status: "accepted", runId }
    // because real agent runs (>30s) exceed the host's plugin RPC timeout.
    // Pipecat polls /sessions/:id/last-result for completion.
    {
      routeKey: API_ROUTE_KEYS.sendMessage,
      method: "POST",
      path: "/sessions/:conferenceSessionId/messages",
      auth: "agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Poll the latest run state for a session. Returns pending/done/error
    // along with assembled responseText + ttsResult once the run completes.
    {
      routeKey: API_ROUTE_KEYS.lastResult,
      method: "GET",
      path: "/sessions/:conferenceSessionId/last-result",
      auth: "agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Pipecat ends the session.
    {
      routeKey: API_ROUTE_KEYS.closeSession,
      method: "DELETE",
      path: "/sessions/:conferenceSessionId",
      auth: "agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Read-only session lookup for debugging / state recovery.
    {
      routeKey: API_ROUTE_KEYS.getSession,
      method: "GET",
      path: "/sessions/:conferenceSessionId",
      auth: "agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Health probe (board-or-agent so operators can hit it from the dashboard).
    {
      routeKey: API_ROUTE_KEYS.health,
      method: "GET",
      path: "/health",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },

    // Browser-callable proxies. The NoralOS-native Conference Room page
    // (rendered as a plugin `page` slot) calls these using only the user's
    // NoralOS session cookie. Each handler delegates to the same internal
    // helper as its agent-auth twin; service-agent tokens stay server-side.
    {
      routeKey: API_ROUTE_KEYS.uiState,
      method: "GET",
      path: "/ui/state",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: API_ROUTE_KEYS.uiCreateSession,
      method: "POST",
      path: "/ui/sessions",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: API_ROUTE_KEYS.uiSendMessage,
      method: "POST",
      path: "/ui/sessions/:conferenceSessionId/messages",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: API_ROUTE_KEYS.uiLastResult,
      method: "GET",
      path: "/ui/sessions/:conferenceSessionId/last-result",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: API_ROUTE_KEYS.uiCloseSession,
      method: "DELETE",
      path: "/ui/sessions/:conferenceSessionId",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
  ],

  instanceConfigSchema: {
    type: "object",
    properties: {
      // Agent token used by the bridge to call voice-config and voice-cascade.
      // Same value can serve both purposes if a single service-agent is used.
      voiceConfigCallerTokenRef: {
        type: "string",
        format: "secret-ref",
        title: "Voice-Config Caller Agent Token (secret reference)",
        description:
          "Secret reference to a Paperclip agent API key the bridge uses to call voice-config /effective-config. Required.",
      },
      voiceCascadeCallerTokenRef: {
        type: "string",
        format: "secret-ref",
        title: "Voice-Cascade Caller Agent Token (secret reference)",
        description:
          "Secret reference to a Paperclip agent API key the bridge uses to call voice-cascade /synthesize. Required. May be the same secret as voiceConfigCallerTokenRef.",
      },
      voiceConfigBaseUrl: {
        type: "string",
        title: "voice-config base URL",
        default: "http://localhost:3100",
      },
      voiceCascadeBaseUrl: {
        type: "string",
        title: "voice-cascade base URL",
        default: "http://localhost:3100",
      },
      agentRunTimeoutMs: {
        type: "integer",
        title: "Agent-run timeout (ms)",
        default: 60000,
        minimum: 5000,
        description:
          "Maximum wall-clock time the bridge waits for an agent's response before failing the message with reason=agent-run-timeout.",
      },
    },
    additionalProperties: false,
    required: ["voiceConfigCallerTokenRef", "voiceCascadeCallerTokenRef"],
  },
};

export default manifest;
