/**
 * Constants shared between the manifest, worker, and tests.
 *
 * `PLUGIN_ID` is the stable identifier the host uses to namespace this
 * plugin's tools (e.g. `noralai.noralvoice:list_workflows`). It MUST stay
 * stable across versions — operator-side assignments in
 * `integration_credentials` reference it by `pluginKey: "noralai.noralvoice"`.
 */

export const PLUGIN_ID = "noralai.noralvoice";
export const PLUGIN_VERSION = "0.2.0";

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

/** Per-company plugin state namespace + keys used by `ctx.state.*`. */
export const STATE_NAMESPACE = "noralai.noralvoice";
/** Stores `{ webhookId: number, secret: string }` keyed per company. */
export const STATE_KEY_WEBHOOK_REGISTRATION = "webhook-registration";

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
