/**
 * Zoho CRM plugin manifest.
 *
 * v0.1.0 exposes a minimum viable agent surface against the Zoho CRM REST
 * API (v7):
 *
 *   - `zoho_list_modules`   (worker tier) — list available CRM modules.
 *   - `zoho_search_records` (worker tier) — search any module by criteria/word/email/phone.
 *   - `zoho_get_record`     (worker tier) — fetch a record by id.
 *   - `zoho_create_record`  (manager tier) — create a record in a module.
 *   - `zoho_update_record`  (manager tier) — patch an existing record.
 *
 * Credentials come from the company's `integration_credentials` row
 * (provider `zoho`). The encrypted material is a JSON blob containing
 * `{ clientId, clientSecret, refreshToken }`. The plugin worker resolves
 * `secretRef` to the JSON, parses it, and uses the refresh token to mint
 * an access token on demand (cached in-process per worker).
 *
 * Tier gate: write tools (`create`/`update`) are restricted to `manager`
 * tier and above; read tools admit any tier. Mirrors NoralVoice's
 * `run_call`-vs-read convention.
 */

import type { NoralosPluginManifestV1 } from "@noralos/shared";

import {
  PLUGIN_ID,
  PLUGIN_VERSION,
  TOOL_MIN_TIER,
  ZOHO_CREATE_RECORD_TOOL_NAME,
  ZOHO_GET_RECORD_TOOL_NAME,
  ZOHO_LIST_MODULES_TOOL_NAME,
  ZOHO_SEARCH_RECORDS_TOOL_NAME,
  ZOHO_UPDATE_RECORD_TOOL_NAME,
} from "./constants.js";

const moduleParamSchema = {
  type: "string",
  description:
    "Zoho CRM module API name (e.g. `Leads`, `Contacts`, `Accounts`, `Deals`, or a custom module API name). Use `zoho_list_modules` first if you're unsure.",
  pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$",
  minLength: 1,
  maxLength: 64,
} as const;

const recordIdParamSchema = {
  type: "string",
  description: "Zoho record id (numeric string).",
  pattern: "^[0-9]{1,32}$",
  minLength: 1,
  maxLength: 32,
} as const;

const valuesParamSchema = {
  type: "object",
  description:
    "Field name → value map. Field names must match Zoho's API names exactly (e.g. `Last_Name`, `Email`, `Phone`). Values follow Zoho's typing — strings, numbers, booleans, null, or nested objects for lookup/picklist fields.",
  additionalProperties: true,
  minProperties: 1,
} as const;

export const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Zoho CRM",
  description:
    "Zoho CRM agent integration. Lets NoralOS agents (Brooklyn, directors, managers) read CRM context (Leads, Contacts, Accounts, Deals) and write activity (create/update records) mid-conversation. OAuth 2.0 credentials and per-data-center routing are configured under Settings → Integrations → Zoho CRM; the plugin row is harmless until an operator connects an org.",
  // CRM-category routing happens at the integration-providers.ts level
  // (the `zoho` provider has `category: "crm"` which is what the
  // Settings → Integrations UI groups by). The plugin manifest's
  // categories vocabulary is narrower — `connector` is the canonical
  // tag for third-party-service integrations like this one.
  author: "NoralOS",
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
   * connects a Zoho credential to this plugin:
   *
   *   - `secretRef`: encrypted-secret reference for the JSON blob
   *     `{ clientId, clientSecret, refreshToken }`. Resolved on every
   *     tool call via `ctx.secrets.resolve()`.
   *   - `dataCenter`: which Zoho region the org lives in. Determines
   *     which `accounts.zoho.<tld>` minted the refresh token and which
   *     `www.zohoapis.<tld>` to call. Propagated from
   *     `credential.metadata.fields.dataCenter` via the assignment
   *     slot's `pairedFields`.
   *   - `apiDomain`: optional override for the API base URL. Populated
   *     when Zoho echoes a non-default `api_domain` on the OAuth
   *     callback (e.g. a US-DC org owned by an EU-DC admin). Falls back
   *     to the per-dataCenter default when absent.
   */
  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    required: ["secretRef", "dataCenter"],
    properties: {
      secretRef: {
        type: "string",
        description:
          "Encrypted-secret reference (e.g. `company-secret:<credential-id>`) for the JSON blob `{ clientId, clientSecret, refreshToken }`. Created by the Zoho OAuth callback under Settings → Integrations → Zoho CRM; never pasted directly into config.",
        format: "secret-ref",
        minLength: 1,
      },
      dataCenter: {
        type: "string",
        description:
          "Zoho data center key (us, eu, in, au, jp, ca). Must match the credential's selected data center.",
        enum: ["us", "eu", "in", "au", "jp", "ca"],
      },
      apiDomain: {
        type: "string",
        description:
          "Optional override for the API base URL (e.g. `https://www.zohoapis.com`). Defaults to the per-dataCenter standard host when omitted.",
        format: "uri",
      },
    },
  },

  tools: [
    {
      name: ZOHO_LIST_MODULES_TOOL_NAME,
      displayName: "List Zoho CRM modules",
      description:
        "Return the CRM modules available in the connected Zoho org — built-in (Leads, Contacts, Accounts, Deals, …) and custom. Each entry includes the API name (which the other tools take as `module`) plus permission flags (viewable, creatable, editable). Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: ZOHO_SEARCH_RECORDS_TOOL_NAME,
      displayName: "Search Zoho CRM records",
      description:
        "Search records in a Zoho module by one of: a fully-formed `criteria` expression, a free-text `word`, an exact `email`, or an exact `phone`. Use this before `zoho_get_record` when the agent only knows a partial identifier (e.g. the customer's email). Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["module"],
        properties: {
          module: moduleParamSchema,
          criteria: {
            type: "string",
            description:
              "Zoho criteria expression (e.g. `(Last_Name:equals:Doe)`, `((Email:equals:jane@x.com) or (Phone:equals:+15555550100))`). Mutually exclusive with `word`/`email`/`phone`.",
            minLength: 1,
            maxLength: 2000,
          },
          word: {
            type: "string",
            description: "Free-text word search across Zoho's indexed fields.",
            minLength: 1,
            maxLength: 200,
          },
          email: {
            type: "string",
            description: "Exact-match email search.",
            format: "email",
            minLength: 1,
            maxLength: 320,
          },
          phone: {
            type: "string",
            description: "Exact-match phone search. Use the same format the record is stored under.",
            minLength: 1,
            maxLength: 64,
          },
          limit: {
            type: "integer",
            description: "Maximum records to return (1..200, default 20). Maps to Zoho's `per_page`.",
            minimum: 1,
            maximum: 200,
          },
          page: {
            type: "integer",
            description: "1-indexed page number (default 1).",
            minimum: 1,
          },
        },
      },
    },
    {
      name: ZOHO_GET_RECORD_TOOL_NAME,
      displayName: "Get a Zoho CRM record",
      description:
        "Fetch a single record by id from a Zoho module. Use after `zoho_search_records` once you've narrowed to a specific record id. Read-only — admits any tier.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["module", "id"],
        properties: {
          module: moduleParamSchema,
          id: recordIdParamSchema,
        },
      },
    },
    {
      name: ZOHO_CREATE_RECORD_TOOL_NAME,
      displayName: "Create a Zoho CRM record",
      description:
        "Create a new record in a Zoho module (e.g. log a lead, register a contact, open a deal). Field names in `values` must match Zoho's API names exactly. Returns the new record's id. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["module", "values"],
        properties: {
          module: moduleParamSchema,
          values: valuesParamSchema,
        },
      },
    },
    {
      name: ZOHO_UPDATE_RECORD_TOOL_NAME,
      displayName: "Update a Zoho CRM record",
      description:
        "Patch an existing record in a Zoho module. Only fields included in `values` are touched; everything else is preserved. Field names must match Zoho's API names. Manager tier or above.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["module", "id", "values"],
        properties: {
          module: moduleParamSchema,
          id: recordIdParamSchema,
          values: valuesParamSchema,
        },
      },
    },
  ],
};

// The plugin-loader does `mod.default ?? mod` when importing the manifest
// module. The named `manifest` export above is convenient for tests and
// in-process consumers; the default export is what the host actually
// validates at install time. Mirrors the pattern in noralai-noralsign and
// noralai-noralvoice.
//
// CRITICAL: `export default manifest;` is required for the loader to find
// the manifest. Forgetting this causes a silent "no manifest found"
// failure inside the prod Docker build; pattern noted in the team's
// shared plugin-gotchas memory.
export default manifest;

/** Convenience for tests + tier-gate cross-checks. */
export const TOOL_NAMES = [
  ZOHO_LIST_MODULES_TOOL_NAME,
  ZOHO_SEARCH_RECORDS_TOOL_NAME,
  ZOHO_GET_RECORD_TOOL_NAME,
  ZOHO_CREATE_RECORD_TOOL_NAME,
  ZOHO_UPDATE_RECORD_TOOL_NAME,
] as const;

export { TOOL_MIN_TIER };
