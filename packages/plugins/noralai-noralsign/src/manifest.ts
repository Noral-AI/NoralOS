/**
 * NoralSign plugin manifest.
 *
 * Declares the full contract-routing lifecycle as agent tools:
 *   - `list_templates` — discover the company's available templates
 *   - `get_template` — fetch a template's fields/submitters
 *   - `create_submission_from_template` — send a contract for signature
 *   - `get_submission` — poll status of a single submission
 *   - `list_submissions` — query recent submissions
 *   - `void_submission` — cancel an envelope before completion
 *   - `remind_signer` — nudge a pending signer
 *   - `download_signed_document` — fetch the completed PDF
 *
 * Plus a webhook receiver that DocuSeal calls on every lifecycle event
 * (form.viewed, form.completed, form.declined, submission.completed),
 * which the plugin translates onto NoralOS's internal event bus so the
 * Slack/contract-routing flow can notify the originating salesperson.
 *
 * Credentials and the DocuSeal base URL come from the company's
 * `integration_credentials` row (provider `noralai.noralsign`). The API
 * token is stored as an encrypted secret ref and resolved on every
 * invocation — never embedded in agent state or worker memory.
 *
 * Executive-tier gate: all tools refuse calls from agents whose role is
 * not in {ceo, cto, cmo, cfo}. The host UI is gated separately via
 * page-route permissions.
 */

import type { NoralosPluginManifestV1 } from "@noralos/shared";

import {
  CREATE_SUBMISSION_TOOL_NAME,
  DOCUSEAL_WEBHOOK_ENDPOINT_KEY,
  DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME,
  GET_SUBMISSION_TOOL_NAME,
  GET_TEMPLATE_TOOL_NAME,
  LIST_SUBMISSIONS_TOOL_NAME,
  LIST_TEMPLATES_TOOL_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
  REMIND_SIGNER_TOOL_NAME,
  VOID_SUBMISSION_TOOL_NAME,
} from "./constants.js";

const submitterItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "email"],
  properties: {
    role: {
      type: "string",
      description:
        "Signer role as declared on the template (e.g. `Customer`, `NoralAI`). Omit to let DocuSeal assign in template order. Case-sensitive.",
      minLength: 1,
      maxLength: 100,
    },
    name: {
      type: "string",
      description: "Signer's full name. Appears on the audit log and the signed document.",
      minLength: 1,
      maxLength: 200,
    },
    email: {
      type: "string",
      description: "Signer's email. DocuSeal sends the invitation here.",
      format: "email",
      minLength: 3,
      maxLength: 320,
    },
    values: {
      type: "object",
      description:
        "Pre-filled field values keyed by field name (use `get_template` to discover field names). Useful for stamping the customer name, deal value, term length, etc. before sending.",
      additionalProperties: {
        oneOf: [
          { type: "string", maxLength: 5000 },
          { type: "number" },
          { type: "boolean" },
        ],
      },
    },
  },
} as const;

export const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "NoralSign",
  description:
    "Document e-signing for NoralOS. Wraps a self-hosted DocuSeal instance behind a NoralOS-branded surface. Agents can look up contract templates, send envelopes for signature, track status, and download signed PDFs; humans get a native NoralOS UI under Documents → NoralSign.",
  author: "NoralOS",
  categories: ["connector"],

  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "activity.log.write",
    "agents.read",
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
        id: "noralsign-sidebar-link",
        displayName: "NoralSign",
        exportName: "NoralSignSidebarLink",
      },
      {
        type: "page",
        id: "noralsign-templates-page",
        displayName: "NoralSign",
        exportName: "NoralSignTemplatesPage",
        // Reachable at /<companyPrefix>/noralsign. The sidebar link target
        // matches this routePath so the host's route resolver can mount
        // the page component without depending on plugin UUIDs.
        routePath: "noralsign",
      },
    ],
  },

  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    required: ["apiUrl", "apiTokenRef"],
    properties: {
      apiUrl: {
        type: "string",
        description:
          "Base URL of the DocuSeal instance NoralSign will call. In a standard NoralOS deployment this is the internal Docker DNS name of the bundled DocuSeal service (e.g. `http://docuseal:3000`). Override per-company only if you run a dedicated DocuSeal cluster.",
        format: "uri",
        minLength: 1,
      },
      apiTokenRef: {
        type: "string",
        description:
          "Encrypted-secret reference (e.g. `company-secret:<credential-id>`) to the DocuSeal API token. Mint a token in DocuSeal admin → API and store it as an integration credential; never paste the token directly into config.",
        minLength: 1,
      },
    },
  },

  webhooks: [
    {
      endpointKey: DOCUSEAL_WEBHOOK_ENDPOINT_KEY,
      displayName: "DocuSeal lifecycle events",
      description:
        "Receives DocuSeal's form/submission webhooks (viewed, completed, declined, expired) and republishes them as `noralsign.signature.*` events on the NoralOS event bus. Configure DocuSeal admin → Webhooks → URL to this endpoint on your NoralOS public origin.",
    },
  ],

  apiRoutes: [
    {
      // Used by the Documents → NoralSign dashboard page to render the
      // template list without round-tripping through an agent. Host
      // auth: `board` = NoralOS-authenticated operator session.
      // Board-scoped routes don't carry an implicit companyId (unlike
      // agent-scoped runs), so the host needs an explicit hint about
      // where to read it from. The UI passes ?companyId=<uuid>.
      routeKey: "list_templates",
      method: "GET",
      path: "/templates",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
  ],

  tools: [
    {
      name: LIST_TEMPLATES_TOOL_NAME,
      displayName: "List NoralSign contract templates",
      description:
        "Return the contract templates available in NoralSign (MSA, NDA, SOW, order forms, etc.) so the agent can pick the right one for a salesperson's request. Use this before `create_submission_from_template` to confirm the template exists and to surface choices when the user is ambiguous.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description:
              "Optional substring filter applied to template names (case-insensitive). Pass when the agent already knows the rough template name from the user (e.g. `MSA`, `mutual NDA`).",
            minLength: 1,
            maxLength: 200,
          },
          limit: {
            type: "integer",
            description: "Maximum number of templates to return. Defaults to 25; cap is 100.",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: GET_TEMPLATE_TOOL_NAME,
      displayName: "Get NoralSign template details",
      description:
        "Fetch a single template's field metadata and submitter roles. Use this before `create_submission_from_template` so the agent knows which `values` keys to pre-fill and which signer roles the template expects.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["templateId"],
        properties: {
          templateId: {
            type: "integer",
            description: "NoralSign template id (obtained from `list_templates`).",
            minimum: 1,
          },
        },
      },
    },
    {
      name: CREATE_SUBMISSION_TOOL_NAME,
      displayName: "Send a NoralSign contract for signature",
      description:
        "Create a NoralSign submission from a template and dispatch signing invitations. Use after confirming the template (`get_template`) and collecting all signer names, emails, and field values from the salesperson. The signer receives an emailed link; status comes back via webhook events and `get_submission`. Restricted to executive-tier agents.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["templateId", "submitters"],
        properties: {
          templateId: {
            type: "integer",
            description: "NoralSign template id.",
            minimum: 1,
          },
          submitters: {
            type: "array",
            description:
              "Ordered list of signers (1+ entries). For most sales templates this is two parties: the customer and a NoralAI signatory.",
            minItems: 1,
            maxItems: 20,
            items: submitterItemSchema,
          },
          sendEmail: {
            type: "boolean",
            description:
              "If true (the default) DocuSeal emails the signer an invitation. Set false when the salesperson will deliver the link themselves and `get_submission` is used to fetch the signing URL.",
          },
          message: {
            type: "string",
            description:
              "Optional plain-text body appended to the signer invitation. Keep professional — this is customer-facing and goes out under the company brand.",
            maxLength: 2000,
          },
        },
      },
    },
    {
      name: GET_SUBMISSION_TOOL_NAME,
      displayName: "Get NoralSign submission status",
      description:
        "Look up a submission's current state and per-signer status. Use to answer 'has Acme signed yet?' or to retrieve the signing URL after a `create_submission_from_template` call with `sendEmail: false`.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["submissionId"],
        properties: {
          submissionId: {
            type: "integer",
            description: "NoralSign submission id.",
            minimum: 1,
          },
        },
      },
    },
    {
      name: LIST_SUBMISSIONS_TOOL_NAME,
      displayName: "List recent NoralSign submissions",
      description:
        "Return recent submissions across all templates, optionally filtered by status or template. Use for 'show me everything we've sent for signature this week' or 'which Acme contracts are still pending'.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: {
            type: "string",
            enum: ["pending", "completed", "declined"],
            description: "Filter to a specific submission status.",
          },
          templateId: {
            type: "integer",
            description: "Limit to submissions sent from a specific template.",
            minimum: 1,
          },
          limit: {
            type: "integer",
            description: "Maximum number of submissions to return. Defaults to 25; cap is 100.",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: VOID_SUBMISSION_TOOL_NAME,
      displayName: "Void a NoralSign submission",
      description:
        "Cancel a pending submission so signers can no longer act on it. Use when terms changed mid-flight, the wrong template was sent, or the customer asked to back out. The audit trail is preserved; the submission moves to an archived state. Restricted to executive-tier agents.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["submissionId"],
        properties: {
          submissionId: {
            type: "integer",
            description: "NoralSign submission id to void.",
            minimum: 1,
          },
          reason: {
            type: "string",
            description:
              "Short internal-facing reason logged on the submission and surfaced in the audit trail. Not shown to the customer.",
            maxLength: 500,
          },
        },
      },
    },
    {
      name: REMIND_SIGNER_TOOL_NAME,
      displayName: "Remind a NoralSign signer",
      description:
        "Resend the signing invitation to one or all pending signers on a submission. Use when a contract has been pending for a while and the salesperson asks for a nudge.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["submissionId"],
        properties: {
          submissionId: {
            type: "integer",
            description: "NoralSign submission id.",
            minimum: 1,
          },
          signerEmail: {
            type: "string",
            description:
              "Optional — restrict the reminder to a specific signer. Omit to nudge every signer who hasn't completed.",
            format: "email",
            maxLength: 320,
          },
        },
      },
    },
    {
      name: DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME,
      displayName: "Get NoralSign signed-document URLs",
      description:
        "Return signed-document download URLs for a completed submission. The URLs are time-limited DocuSeal tokens — agents should pass them to the salesperson promptly or pipe them into long-term storage.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["submissionId"],
        properties: {
          submissionId: {
            type: "integer",
            description: "NoralSign submission id. Must be in `completed` status.",
            minimum: 1,
          },
        },
      },
    },
  ],
};

// The plugin-loader does `mod.default ?? mod` when importing the manifest
// module. The named `manifest` export above is convenient for tests and
// in-process consumers; the default export is what the host actually
// validates at install time. Mirrors the pattern in conference-room-bridge.
export default manifest;
