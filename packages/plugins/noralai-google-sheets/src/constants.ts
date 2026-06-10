/**
 * Constants shared between the manifest, worker, client, and tests.
 *
 * `PLUGIN_ID` is the stable identifier the host uses to namespace this
 * plugin's tools (e.g. `noralai.google-sheets:gsheets_read_range`).
 * It MUST stay stable across versions — operator-side assignments in
 * `integration_credentials` reference it by
 * `pluginKey: "noralai.google-sheets"`.
 */

export const PLUGIN_ID = "noralai.google-sheets";

// 0.1.0 — initial release. 5 agent tools for Google Sheets v4 read/write
// + a Drive v3 discovery helper. OAuth 2.0 refresh-token flow; access
// tokens minted on demand and cached in-process.
export const PLUGIN_VERSION = "0.1.0";

/** Tool names within this plugin. Each is namespaced to `noralai.google-sheets:<name>` at the host. */
export const GSHEETS_LIST_SPREADSHEETS_TOOL_NAME = "gsheets_list_spreadsheets";
export const GSHEETS_GET_SPREADSHEET_TOOL_NAME = "gsheets_get_spreadsheet";
export const GSHEETS_READ_RANGE_TOOL_NAME = "gsheets_read_range";
export const GSHEETS_APPEND_ROWS_TOOL_NAME = "gsheets_append_rows";
export const GSHEETS_UPDATE_RANGE_TOOL_NAME = "gsheets_update_range";

/** Default per-call timeout for Google API requests, in ms. */
export const GSHEETS_DEFAULT_TIMEOUT_MS = 10_000;

/** Canonical hosts. Google has no per-region split for these APIs. */
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_SHEETS_API_BASE = "https://sheets.googleapis.com/v4";
export const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/**
 * Agent tier vocabulary. Mirrors the Zoho + NoralVoice plugin
 * convention. Read-only tools admit any tier; write tools (append/update)
 * require `manager` (Director / Manager / Brooklyn).
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
  [GSHEETS_LIST_SPREADSHEETS_TOOL_NAME]: "worker",
  [GSHEETS_GET_SPREADSHEET_TOOL_NAME]: "worker",
  [GSHEETS_READ_RANGE_TOOL_NAME]: "worker",
  [GSHEETS_APPEND_ROWS_TOOL_NAME]: "manager",
  [GSHEETS_UPDATE_RANGE_TOOL_NAME]: "manager",
};

/**
 * Spreadsheet id pattern. Google's spreadsheet ids are a base64-ish
 * 44-char string but allow `-` and `_`. Lower bound at 20 to leave room
 * for shorter test fixtures without becoming a `.*` validator.
 */
export const GOOGLE_SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * A1-range validator. Accepts:
 *   - `Sheet1!A1`
 *   - `Sheet1!A1:C10`
 *   - `'Sheet name with spaces'!A1:Z`
 *   - `A1:B2`  (no tab — reads from the first sheet)
 *
 * Rejects free-text injection — keeps the URL-path segment safe.
 */
export const A1_RANGE_PATTERN =
  /^(?:'(?:[^'\\]|\\.){1,200}'!|[A-Za-z0-9_]{1,100}!)?[A-Z]+\d*(?::[A-Z]+\d*)?$/;
