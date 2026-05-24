/**
 * Google Sheets plugin manifest.
 *
 * v0.1.0 exposes a minimum viable agent surface against the Google
 * Sheets v4 REST API plus a Drive v3 discovery helper:
 *
 *   - `gsheets_list_spreadsheets` (worker tier) — list spreadsheets the credential can see.
 *   - `gsheets_get_spreadsheet`   (worker tier) — read spreadsheet metadata + tab list.
 *   - `gsheets_read_range`        (worker tier) — read an A1-notation range.
 *   - `gsheets_append_rows`       (manager tier) — append rows below an existing table.
 *   - `gsheets_update_range`      (manager tier) — overwrite a specific range.
 *
 * Credentials come from the company's `integration_credentials` row
 * (provider `google_sheets`). The encrypted material is a JSON blob
 * containing `{ clientId, clientSecret, refreshToken }`. The plugin
 * worker resolves `secretRef` to the JSON, parses it, and uses the
 * refresh token to mint a Bearer access token on demand (cached
 * in-process per worker). Google has no per-region routing — the same
 * `oauth2.googleapis.com` token endpoint and global `sheets.googleapis.com`
 * / `www.googleapis.com/drive/v3` hosts serve every account.
 *
 * Tier gate: write tools (`append`/`update`) are restricted to `manager`
 * tier and above; read tools admit any tier. Mirrors the convention
 * used by NoralVoice and noralai-zoho.
 */

import type { NoralosPluginManifestV1 } from "@noralos/shared";

import {
  GSHEETS_APPEND_ROWS_TOOL_NAME,
  GSHEETS_GET_SPREADSHEET_TOOL_NAME,
  GSHEETS_LIST_SPREADSHEETS_TOOL_NAME,
  GSHEETS_READ_RANGE_TOOL_NAME,
  GSHEETS_UPDATE_RANGE_TOOL_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
  TOOL_MIN_TIER,
} from "./constants.js";

const spreadsheetIdParamSchema = {
  type: "string",
  description:
    "Google spreadsheet id — the 44-char string from the spreadsheet URL `https://docs.google.com/spreadsheets/d/<id>/`. Use `gsheets_list_spreadsheets` to discover ids.",
  pattern: "^[A-Za-z0-9_-]{20,128}$",
  minLength: 20,
  maxLength: 128,
} as const;

const a1RangeParamSchema = {
  type: "string",
  description:
    "A1-notation range (e.g. `Sheet1!A1:C10`, `'My Sheet'!A1`, `A1:B2`). Quote sheet names that contain spaces or punctuation.",
  pattern: "^(?:'(?:[^'\\\\]|\\\\.){1,200}'!|[A-Za-z0-9_]{1,100}!)?[A-Z]+\\d*(?::[A-Z]+\\d*)?$",
  minLength: 1,
  maxLength: 200,
} as const;

const valuesParamSchema = {
  type: "array",
  description:
    "2D array of cell values, row-major. Inner array = one row. Use `null` for empty cells. With the default `valueInputOption=USER_ENTERED`, strings starting with `=` are parsed as formulas.",
  minItems: 1,
  maxItems: 10_000,
  items: {
    type: "array",
    description: "One row of cell values.",
    items: {
      anyOf: [
        { type: "string", maxLength: 50_000 },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
      ],
    },
  },
} as const;

export const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Google Sheets",
  description:
    "Google Sheets agent integration. Lets NoralOS agents read context from operator-owned spreadsheets and append activity rows mid-conversation. OAuth 2.0 credentials are configured under Settings → Integrations → Google Sheets; the plugin row is harmless until an operator connects a Google account.",
  author: "NoralOS",
  // The Settings → Integrations UI groups by `provider.category`
  // (`other` for google_sheets — there's no `productivity` slot in the
  // shared category vocabulary). The plugin manifest's narrower
  // categories vocabulary just tags this as a connector.
  categories: ["connector"],

  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "activity.log.write",
    "agents.read",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
  },

  /**
   * Instance config the assignment writer fills in when an operator
   * connects a Google Sheets credential to this plugin:
   *
   *   - `secretRef`: encrypted-secret reference for the JSON blob
   *     `{ clientId, clientSecret, refreshToken }`. Resolved on every
   *     tool call via `ctx.secrets.resolve()`.
   *
   * Unlike Zoho, Google has no per-region routing — the worker hits the
   * canonical global `oauth2.googleapis.com` / `sheets.googleapis.com`
   * hosts regardless of where the connected account lives. So
   * `secretRef` is the only required field.
   */
  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    required: ["secretRef"],
    properties: {
      secretRef: {
        type: "string",
        description:
          "Encrypted-secret reference (e.g. `company-secret:<credential-id>`) for the JSON blob `{ clientId, clientSecret, refreshToken }`. Created by the Google Sheets OAuth callback under Settings → Integrations → Google Sheets; never pasted directly into config.",
        format: "secret-ref",
        minLength: 1,
      },
    },
  },

  tools: [
    {
      name: GSHEETS_LIST_SPREADSHEETS_TOOL_NAME,
      displayName: "List Google spreadsheets",
      description:
        "List spreadsheets the connected Google account has access to (its own + shared). Use this to discover a `spreadsheetId` when the agent only knows the spreadsheet's name. Read-only — admits any tier. Paginated via opaque `pageToken`.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description:
              "Optional substring filter applied to spreadsheet names (case-insensitive on Google's side).",
            minLength: 1,
            maxLength: 200,
          },
          limit: {
            type: "integer",
            description: "Max spreadsheets to return (1..100, default 25).",
            minimum: 1,
            maximum: 100,
          },
          pageToken: {
            type: "string",
            description: "Opaque pagination cursor from a prior response.",
            maxLength: 4_096,
          },
        },
      },
    },
    {
      name: GSHEETS_GET_SPREADSHEET_TOOL_NAME,
      displayName: "Get Google spreadsheet metadata",
      description:
        "Read a spreadsheet's basic metadata: title, locale, time zone, and the list of sheet tabs (id, title, grid size). Use this to discover sheet/tab names before constructing an A1 range. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["spreadsheetId"],
        properties: {
          spreadsheetId: spreadsheetIdParamSchema,
        },
      },
    },
    {
      name: GSHEETS_READ_RANGE_TOOL_NAME,
      displayName: "Read a Google Sheets range",
      description:
        "Read cell values from a single A1-notation range. Returns the values as a 2D row-major array (trailing empty cells are omitted by Google). Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["spreadsheetId", "range"],
        properties: {
          spreadsheetId: spreadsheetIdParamSchema,
          range: a1RangeParamSchema,
          valueRenderOption: {
            type: "string",
            description:
              "How Google should render values. `FORMATTED_VALUE` (default) returns the same string a person sees in the UI; `UNFORMATTED_VALUE` returns raw types; `FORMULA` returns the underlying formula text.",
            enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"],
          },
        },
      },
    },
    {
      name: GSHEETS_APPEND_ROWS_TOOL_NAME,
      displayName: "Append rows to a Google Sheets sheet",
      description:
        "Append rows below the contiguous table that contains the supplied range. With `insertDataOption=INSERT_ROWS` (default) existing rows shift down; with `OVERWRITE` they're replaced. `valueInputOption=USER_ENTERED` (default) interprets `=SUM(A:A)` etc. as formulas. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["spreadsheetId", "range", "values"],
        properties: {
          spreadsheetId: spreadsheetIdParamSchema,
          range: a1RangeParamSchema,
          values: valuesParamSchema,
          valueInputOption: {
            type: "string",
            description: "How Google should parse the values (default USER_ENTERED).",
            enum: ["RAW", "USER_ENTERED"],
          },
          insertDataOption: {
            type: "string",
            description:
              "What to do with existing data: INSERT_ROWS (default — shift down) or OVERWRITE (replace).",
            enum: ["OVERWRITE", "INSERT_ROWS"],
          },
        },
      },
    },
    {
      name: GSHEETS_UPDATE_RANGE_TOOL_NAME,
      displayName: "Update a Google Sheets range",
      description:
        "Overwrite a specific range with explicit values. Unlike `append`, this targets the supplied range exactly — the values array's dimensions must match the range. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["spreadsheetId", "range", "values"],
        properties: {
          spreadsheetId: spreadsheetIdParamSchema,
          range: a1RangeParamSchema,
          values: valuesParamSchema,
          valueInputOption: {
            type: "string",
            description: "How Google should parse the values (default USER_ENTERED).",
            enum: ["RAW", "USER_ENTERED"],
          },
        },
      },
    },
  ],
};

// The plugin-loader does `mod.default ?? mod` when importing the manifest
// module. The named `manifest` export above is convenient for tests and
// in-process consumers; the default export is what the host actually
// validates at install time. Same loader contract as the other Noral
// plugins — forgetting `export default` causes a silent "no manifest
// found" failure inside the prod Docker build.
export default manifest;

/** Convenience for tests + tier-gate cross-checks. */
export const TOOL_NAMES = [
  GSHEETS_LIST_SPREADSHEETS_TOOL_NAME,
  GSHEETS_GET_SPREADSHEET_TOOL_NAME,
  GSHEETS_READ_RANGE_TOOL_NAME,
  GSHEETS_APPEND_ROWS_TOOL_NAME,
  GSHEETS_UPDATE_RANGE_TOOL_NAME,
] as const;

export { TOOL_MIN_TIER };
