/**
 * Constants shared between the manifest, worker, client, and tests.
 *
 * `PLUGIN_ID` is the stable identifier the host uses to namespace this
 * plugin's tools (e.g. `noralai.zoho:zoho_search_records`). It MUST stay
 * stable across versions — operator-side assignments in
 * `integration_credentials` reference it by `pluginKey: "noralai.zoho"`.
 */

export const PLUGIN_ID = "noralai.zoho";

// 0.1.0 — initial release. 5 agent tools for Zoho CRM v7 read/write of
// any module (Leads, Contacts, Accounts, Deals, custom). OAuth 2.0
// refresh-token flow; access tokens minted on demand and cached in-process.
export const PLUGIN_VERSION = "0.1.0";

/** Tool names within this plugin. Each is namespaced to `noralai.zoho:<name>` at the host. */
export const ZOHO_LIST_MODULES_TOOL_NAME = "zoho_list_modules";
export const ZOHO_SEARCH_RECORDS_TOOL_NAME = "zoho_search_records";
export const ZOHO_GET_RECORD_TOOL_NAME = "zoho_get_record";
export const ZOHO_CREATE_RECORD_TOOL_NAME = "zoho_create_record";
export const ZOHO_UPDATE_RECORD_TOOL_NAME = "zoho_update_record";

/** Default per-call timeout for Zoho CRM requests, in ms. */
export const ZOHO_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Per-data-center hostnames. Zoho splits its accounts server (for OAuth
 * token exchange) and its API host (for CRM data) into per-DC subdomains;
 * the table below is the canonical mapping used by both halves of the
 * client and is mirrored from the public Zoho API Console documentation.
 *
 * Keep this in lock-step with `ZOHO_DATA_CENTER_TLD` in
 * `@noralos/shared` (the provider registry).
 */
export const ZOHO_ACCOUNTS_HOST_BY_DC: Record<string, string> = {
  us: "https://accounts.zoho.com",
  eu: "https://accounts.zoho.eu",
  in: "https://accounts.zoho.in",
  au: "https://accounts.zoho.com.au",
  jp: "https://accounts.zoho.jp",
  ca: "https://accounts.zohocloud.ca",
};

export const ZOHO_API_HOST_BY_DC: Record<string, string> = {
  us: "https://www.zohoapis.com",
  eu: "https://www.zohoapis.eu",
  in: "https://www.zohoapis.in",
  au: "https://www.zohoapis.com.au",
  jp: "https://www.zohoapis.jp",
  ca: "https://www.zohoapis.ca",
};

export type ZohoDataCenter = keyof typeof ZOHO_API_HOST_BY_DC;

/**
 * Agent tier vocabulary. Mirrors the NoralVoice plugin convention so
 * the same role gates apply across CRM and voice tools.
 *
 * Read-only tools admit any tier; write tools (create/update) require
 * `manager` (Director / Manager / Brooklyn).
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

/** Per-tool minimum tier. Reads admit worker; writes require manager. */
export const TOOL_MIN_TIER: Record<string, AgentTier> = {
  [ZOHO_LIST_MODULES_TOOL_NAME]: "worker",
  [ZOHO_SEARCH_RECORDS_TOOL_NAME]: "worker",
  [ZOHO_GET_RECORD_TOOL_NAME]: "worker",
  [ZOHO_CREATE_RECORD_TOOL_NAME]: "manager",
  [ZOHO_UPDATE_RECORD_TOOL_NAME]: "manager",
};

/**
 * Module-name validator. Zoho module API names are alphanumeric with
 * underscores (e.g. `Leads`, `Contacts`, `Custom_Module_1`). Validating
 * here keeps URL construction safe — we never need to URL-escape a
 * module segment.
 */
export const ZOHO_MODULE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
