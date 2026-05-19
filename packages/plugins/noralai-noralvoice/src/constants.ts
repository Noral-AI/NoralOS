/**
 * Constants shared between the manifest, worker, and tests.
 *
 * `PLUGIN_ID` is the stable identifier the host uses to namespace this
 * plugin's tools (e.g. `noralai.noralvoice:list_workflows`). It MUST stay
 * stable across versions — operator-side assignments in
 * `integration_credentials` reference it by `pluginKey: "noralai.noralvoice"`.
 */

export const PLUGIN_ID = "noralai.noralvoice";
// 0.5.0 — Phase 9-C: 13 new agent tools added (Tier 1 writes + Tier 2 reads),
// giving the Voice Director agent operator-parity. Tool count: 13 → 26.
// All new tools route through resolveClientConfig so X-Noralos-Actor-*
// headers from Phase 9-B auto-attach without additional plumbing.
//
// 0.6.0 — Phase 9-D: 6 final Tier 3 tools (campaign lifecycle: pause/resume/redial
// + embed-token CRUD: create/get/revoke). Embed-token tools use ctx.state for
// secret storage — the raw token never crosses the tool boundary. Tool count: 26 → 32.
export const PLUGIN_VERSION = "0.6.0";

/** Phase 1B starter tools. Each namespaced to `noralai.noralvoice:<name>` at the host. */
export const LIST_WORKFLOWS_TOOL_NAME = "list_workflows";
export const RUN_CALL_TOOL_NAME = "run_call";
export const GET_RUN_TOOL_NAME = "get_run";

/**
 * Webhook endpoint key declared in the manifest. NoralVoice POSTs
 * `run.completed` events here at
 * `POST /api/plugins/noralai.noralvoice/webhooks/run-completed?company=<uuid>`.
 * Registration happens via the lifecycle hook in `worker.ts`, which calls
 * NoralVoice's `POST /api/v1/integration-webhooks` with this endpoint URL.
 */
export const RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY = "run-completed";

/**
 * Phase 5d — inbound endpoint for `noralos://` reverse-RPC dispatches
 * from a NoralVoice workflow Agent node. Reuses the webhook URL
 * pattern (`POST /api/plugins/<pluginId>/webhooks/reverse-tool`) so
 * we don't need a host-side route registration; HMAC verification
 * lives in the worker's `onWebhook` handler the same way as for
 * `run-completed`.
 */
export const REVERSE_TOOL_WEBHOOK_ENDPOINT_KEY = "reverse-tool";

/** Per-company plugin state namespace + keys used by `ctx.state.*`. */
export const STATE_NAMESPACE = "noralai.noralvoice";
/**
 * Stores ``{ webhookId, secret, reverseRpcSecret }`` keyed per
 * company. The `reverseRpcSecret` is the HMAC key for inbound
 * `noralos://` reverse-RPC dispatches (Phase 5d).
 */
export const STATE_KEY_WEBHOOK_REGISTRATION = "webhook-registration";

/**
 * Phase 5d — manifest tool names for the v1 reverse-RPC handlers.
 * Mirror the names declared in the manifest's `reverseTools` array;
 * the worker's `onReverseTool` dispatches keyed on these.
 */
export const REVERSE_TOOL_GET_AGENT_STATUS = "get_agent_status";
export const REVERSE_TOOL_CREATE_TASK_FOR_AGENT = "create_task_for_agent";
export const REVERSE_TOOL_LOOKUP_CUSTOMER = "lookup_customer";

/** Default per-call timeout for NoralVoice requests, in ms. */
export const NORALVOICE_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Agent tier vocabulary. Mirrors the Voice Director template (manager
 * tier) and the platform's executive convention. Worker-tier agents
 * are blocked from `run_call`; read-only tools admit any tier.
 */
export type AgentTier = "exec" | "manager" | "worker";

/** Role → tier mapping. Keep in lock-step with `AGENT_ROLES` in `@noralos/shared`. */
export const ROLE_TO_TIER: Record<string, AgentTier> = {
  ceo: "exec",
  cto: "exec",
  cmo: "exec",
  cfo: "exec",
  coo: "exec",
  manager: "manager",
  director: "manager",
};

/** Tier-gate ordering: `exec` ≥ `manager` ≥ `worker`. */
export const TIER_RANK: Record<AgentTier, number> = {
  exec: 2,
  manager: 1,
  worker: 0,
};

/** Per-tool minimum tier required. Read-only tools admit worker; write tools require manager. */
export const TOOL_MIN_TIER: Record<string, AgentTier> = {
  [LIST_WORKFLOWS_TOOL_NAME]: "worker",
  [GET_RUN_TOOL_NAME]: "worker",
  [RUN_CALL_TOOL_NAME]: "manager",
};
