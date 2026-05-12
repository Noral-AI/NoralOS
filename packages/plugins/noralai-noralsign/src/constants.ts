/**
 * Constants shared between the manifest, worker, and tests.
 *
 * `PLUGIN_ID` is the stable identifier the host uses to namespace this
 * plugin's tools (e.g. `noralai.noralsign:list_templates`). It MUST stay
 * stable across versions — operator-side assignments in
 * `integration_credentials` reference it by `pluginKey: "noralai.noralsign"`.
 *
 * The underlying signing engine is DocuSeal (self-hosted) — to the agent,
 * the host UI, and the customer-facing surfaces (when running under a
 * DocuSeal Pro / commercial white-label license) the product is "NoralSign".
 */

export const PLUGIN_ID = "noralai.noralsign";
export const PLUGIN_VERSION = "0.1.0";

/** Tool names within this plugin. Each is namespaced to `noralai.noralsign:<name>` at the host. */
export const LIST_TEMPLATES_TOOL_NAME = "list_templates";
export const GET_TEMPLATE_TOOL_NAME = "get_template";
export const CREATE_SUBMISSION_TOOL_NAME = "create_submission_from_template";
export const GET_SUBMISSION_TOOL_NAME = "get_submission";
export const LIST_SUBMISSIONS_TOOL_NAME = "list_submissions";
export const VOID_SUBMISSION_TOOL_NAME = "void_submission";
export const REMIND_SIGNER_TOOL_NAME = "remind_signer";
export const DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME = "download_signed_document";

/**
 * Webhook endpoint key declared in the manifest. DocuSeal POSTs lifecycle
 * events here at `POST /api/plugins/noralai.noralsign/webhooks/docuseal-events`.
 * Configure DocuSeal admin → Webhooks → URL to that path on your NoralOS
 * public origin. The plugin verifies inbound payloads using the same API
 * token as outbound calls; rotate the token to invalidate stale webhooks.
 */
export const DOCUSEAL_WEBHOOK_ENDPOINT_KEY = "docuseal-events";

/** Upper bound on the page size we'll request from DocuSeal in a single call. DocuSeal's default cap. */
export const DOCUSEAL_MAX_PAGE_SIZE = 100;

/** Default per-call timeout for DocuSeal requests, in ms. */
export const DOCUSEAL_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Agent roles allowed to invoke NoralSign tools.
 *
 * Mirrors the platform's executive-tier convention: only C-suite agents
 * may originate or void contract envelopes. Engineering, design, and
 * specialist roles can still *read* signed documents via the dashboard
 * UI (which is gated separately) but cannot move the signing pipeline.
 *
 * Keep in lock-step with `AGENT_ROLES` in `@noralos/shared`.
 */
export const NORALSIGN_ALLOWED_ROLES = ["ceo", "cto", "cmo", "cfo"] as const;
export type NoralSignAllowedRole = (typeof NORALSIGN_ALLOWED_ROLES)[number];
