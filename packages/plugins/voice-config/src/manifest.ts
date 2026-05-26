import type { NoralosPluginManifestV1 } from "@noralos/plugin-sdk";
import {
  API_ROUTE_KEYS,
  EXPORT_NAMES,
  NAMESPACE_SLUG,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
} from "./constants.js";

export const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Voice Config",
  description:
    "Source of truth for per-agent voice settings, provider selection, surface visibility, and admin tier/visibility overrides. Channel and voice-execution plugins read effective config via events and the effective-config API. Writes go through board-authenticated API routes.",
  author: "NoralOS",
  categories: ["ui", "connector"],

  capabilities: [
    "companies.read",
    "agents.read",
    "database.namespace.read",
    "database.namespace.write",
    "database.namespace.migrate",
    "events.subscribe",
    "events.emit",
    "api.routes.register",
    "instance.settings.register",
    "ui.detailTab.register",
    "activity.log.write",
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

  apiRoutes: [
    // Read — used by sibling plugins on cache miss and by board UIs for debugging.
    {
      routeKey: API_ROUTE_KEYS.effectiveConfig,
      method: "GET",
      path: "/agents/:agentId/effective-config",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Write — board-authenticated. Host verifies the caller is a real board
    // user before dispatching to the worker.
    {
      routeKey: API_ROUTE_KEYS.updateAgentConfig,
      method: "POST",
      path: "/agents/:agentId/voice-config",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: API_ROUTE_KEYS.resetAgentConfig,
      method: "DELETE",
      path: "/agents/:agentId/voice-config",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: API_ROUTE_KEYS.updateCompanyDefaults,
      method: "POST",
      path: "/companies/:companyId/defaults",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
  ],

  ui: {
    slots: [
      {
        type: "detailTab",
        id: SLOT_IDS.voiceSettingsTab,
        displayName: "Voice Settings",
        exportName: EXPORT_NAMES.voiceSettingsTab,
        entityTypes: ["agent"],
        order: 50,
      },
      {
        type: "settingsPage",
        id: SLOT_IDS.companyDefaultsPage,
        displayName: "Voice Defaults",
        exportName: EXPORT_NAMES.companyDefaultsPage,
        order: 100,
      },
    ],
  },

  instanceConfigSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export default manifest;
