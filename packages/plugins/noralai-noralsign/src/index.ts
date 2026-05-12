/**
 * `@noralos-plugins/noralai-noralsign` public entry.
 *
 * Re-exports the manifest (used by the host's manifest validator and by
 * the install-time DB row), the named constants (tool names, plugin id),
 * and the DocuSeal client types so callers (and tests) don't have to
 * import deep paths.
 *
 * The worker entrypoint lives at `dist/worker.js` after `pnpm build`; it
 * is referenced by the manifest's `entrypoints.worker` field and is not
 * exported through this index file because no in-process consumer
 * imports it.
 */

export { manifest } from "./manifest.js";
export {
  PLUGIN_ID,
  PLUGIN_VERSION,
  LIST_TEMPLATES_TOOL_NAME,
  GET_TEMPLATE_TOOL_NAME,
  CREATE_SUBMISSION_TOOL_NAME,
  GET_SUBMISSION_TOOL_NAME,
  LIST_SUBMISSIONS_TOOL_NAME,
  VOID_SUBMISSION_TOOL_NAME,
  REMIND_SIGNER_TOOL_NAME,
  DOWNLOAD_SIGNED_DOCUMENT_TOOL_NAME,
  DOCUSEAL_WEBHOOK_ENDPOINT_KEY,
  DOCUSEAL_DEFAULT_TIMEOUT_MS,
  DOCUSEAL_MAX_PAGE_SIZE,
  NORALSIGN_ALLOWED_ROLES,
} from "./constants.js";
export type { NoralSignAllowedRole } from "./constants.js";
export {
  listTemplates,
  getTemplate,
  createSubmission,
  getSubmission,
  listSubmissions,
  voidSubmission,
  remindSigner,
  downloadSignedDocuments,
  isRetryable,
  DocusealProviderError,
  type DocusealClientConfig,
  type DocusealTemplateSummary,
  type DocusealTemplateDetail,
  type DocusealTemplateField,
  type DocusealSubmitter,
  type DocusealSubmitterInput,
  type DocusealSubmitterStatus,
  type DocusealSubmission,
  type CreateSubmissionRequest,
  type ListTemplatesRequest,
  type ListTemplatesResult,
  type ListSubmissionsRequest,
  type ListSubmissionsResult,
  type VoidSubmissionRequest,
  type RemindSignerRequest,
  type SignedDocument,
  type DownloadSignedDocumentsResult,
  type DocusealErrorCategory,
} from "./docuseal-client.js";
