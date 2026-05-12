/**
 * DocuSeal REST client used by the NoralSign worker.
 *
 * Covers the contract-routing lifecycle: list/get templates, create and
 * track submissions, void, send reminders, and fetch the final signed
 * documents. All operations go through {@link docusealRequest} which
 * centralises header handling, timeouts, abort linking, and error
 * classification.
 *
 * Secrets handling:
 *   - The `apiToken` is set as an `X-Auth-Token` header per request and
 *     never logged or echoed in errors.
 *   - `apiUrl` is treated as identifying-but-non-secret — included in
 *     error context so operators can tell which DocuSeal instance a
 *     failure belongs to (an internal `http://docuseal:3000` vs. a
 *     dedicated cluster).
 *   - DocuSeal response bodies are inspected for `error`/`message` to
 *     populate the category and a hand-shaped error message. Raw
 *     upstream bodies are not surfaced to callers.
 *   - Template/submission/signer free-text (names, emails, custom message
 *     bodies) is NEVER logged at warn+ level so audit logs of failed
 *     calls cannot leak customer identity.
 */

import { DOCUSEAL_DEFAULT_TIMEOUT_MS, DOCUSEAL_MAX_PAGE_SIZE } from "./constants.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DocusealClientConfig {
  /** Base URL of the DocuSeal instance, e.g. `http://docuseal:3000`. No trailing slash required. */
  apiUrl: string;
  /** DocuSeal API token, minted in DocuSeal admin → API. */
  apiToken: string;
  /** Per-call timeout in ms. Defaults to {@link DOCUSEAL_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export type DocusealErrorCategory =
  | "misconfigured"
  | "auth"
  | "not_found"
  | "rate_limit"
  | "server"
  | "timeout"
  | "network"
  | "malformed"
  | "unknown";

export class DocusealProviderError extends Error {
  category: DocusealErrorCategory;
  status?: number;
  constructor(category: DocusealErrorCategory, message: string, opts?: { status?: number }) {
    super(message);
    this.name = "DocusealProviderError";
    this.category = category;
    this.status = opts?.status;
  }
}

export function isRetryable(category: DocusealErrorCategory): boolean {
  return category === "network" || category === "timeout" || category === "rate_limit" || category === "server";
}

// ---- Templates ----

export interface DocusealTemplateSummary {
  id: number;
  name: string;
  /** ISO-8601 timestamp string from DocuSeal. */
  updatedAt: string;
  /** Number of fillable fields defined on the template (best-effort; 0 if upstream omits). */
  fieldCount: number;
}

export interface DocusealTemplateField {
  uuid: string;
  name: string;
  type: string;
  required: boolean;
  submitter: string;
}

export interface DocusealTemplateDetail extends DocusealTemplateSummary {
  /** Logical signer roles defined on the template (e.g. "Customer", "NoralAI"). */
  submitters: string[];
  /** Field metadata, useful for showing the agent or salesperson what they'll need to fill. */
  fields: DocusealTemplateField[];
}

export interface ListTemplatesRequest {
  query?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface ListTemplatesResult {
  templates: DocusealTemplateSummary[];
  attempts: number;
  latencyMs: number;
}

// ---- Submissions ----

export type DocusealSubmitterStatus =
  | "pending"
  | "opened"
  | "sent"
  | "completed"
  | "declined";

export interface DocusealSubmitterInput {
  /** Signer role name as declared on the template (e.g. "Customer"). */
  role?: string;
  /** Signer name. */
  name: string;
  /** Signer email — DocuSeal sends the invitation here. */
  email: string;
  /** Pre-filled field values, keyed by field name. Strings/numbers/bools. */
  values?: Record<string, string | number | boolean>;
}

export interface CreateSubmissionRequest {
  templateId: number;
  submitters: DocusealSubmitterInput[];
  /** Whether DocuSeal sends signing-invite emails. Defaults to true. */
  sendEmail?: boolean;
  /** Custom message included in the signer invite. */
  message?: string;
  signal?: AbortSignal;
}

export interface DocusealSubmitter {
  id: number;
  uuid: string;
  email: string;
  role: string | null;
  status: DocusealSubmitterStatus;
  /** Per-submitter signing URL the customer follows; opaque token in the path. */
  signingUrl: string | null;
  sentAt: string | null;
  openedAt: string | null;
  completedAt: string | null;
}

export interface DocusealSubmission {
  id: number;
  templateId: number;
  status: "pending" | "completed" | "declined" | "expired";
  createdAt: string;
  completedAt: string | null;
  auditLogUrl: string | null;
  submitters: DocusealSubmitter[];
}

export interface ListSubmissionsRequest {
  /** Optional submission status filter. */
  status?: "pending" | "completed" | "declined";
  /** Restrict to a specific template. */
  templateId?: number;
  /** Maximum number of submissions to return. */
  limit?: number;
  signal?: AbortSignal;
}

export interface ListSubmissionsResult {
  submissions: DocusealSubmission[];
  attempts: number;
  latencyMs: number;
}

export interface VoidSubmissionRequest {
  submissionId: number;
  reason?: string;
  signal?: AbortSignal;
}

export interface RemindSignerRequest {
  submissionId: number;
  /** Email of the specific signer to remind. If omitted, DocuSeal nudges every pending signer. */
  signerEmail?: string;
  signal?: AbortSignal;
}

export interface SignedDocument {
  name: string;
  url: string;
}

export interface DownloadSignedDocumentsResult {
  submissionId: number;
  documents: SignedDocument[];
  attempts: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new DocusealProviderError(
      "misconfigured",
      "NoralSign apiUrl must start with http:// or https://.",
    );
  }
  return trimmed;
}

function classifyResponse(status: number): { category: DocusealErrorCategory; message: string } {
  if (status === 401 || status === 403) {
    return {
      category: "auth",
      message: "DocuSeal rejected the API token. Check Settings → Integrations → NoralSign.",
    };
  }
  if (status === 404) {
    return {
      category: "not_found",
      message: "DocuSeal resource not found.",
    };
  }
  if (status === 429) {
    return { category: "rate_limit", message: "DocuSeal rate limit hit. Try again shortly." };
  }
  if (status >= 500) {
    return { category: "server", message: `DocuSeal upstream error (HTTP ${status}).` };
  }
  if (status >= 400) {
    return { category: "malformed", message: `DocuSeal rejected the request (HTTP ${status}).` };
  }
  return { category: "unknown", message: `Unexpected DocuSeal status ${status}.` };
}

function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as { any?: unknown }).any === "function") {
    return (AbortSignal as { any: (sigs: AbortSignal[]) => AbortSignal }).any([a, b]);
  }
  const merged = new AbortController();
  const onAbort = () => merged.abort();
  if (a.aborted || b.aborted) merged.abort();
  else {
    a.addEventListener("abort", onAbort, { once: true });
    b.addEventListener("abort", onAbort, { once: true });
  }
  return merged.signal;
}

interface DocusealRequestOpts {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  config: DocusealClientConfig;
  signal?: AbortSignal;
}

interface DocusealRequestResult<T> {
  data: T;
  attempts: number;
  latencyMs: number;
}

async function docusealRequest<T>(opts: DocusealRequestOpts): Promise<DocusealRequestResult<T>> {
  const baseUrl = normalizeBaseUrl(opts.config.apiUrl);
  const url = new URL(`${baseUrl}${opts.path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const timeoutMs = opts.config.timeoutMs ?? DOCUSEAL_DEFAULT_TIMEOUT_MS;
  const internal = new AbortController();
  const timeoutId = setTimeout(() => internal.abort(), timeoutMs);
  const signal = opts.signal ? linkSignals(opts.signal, internal.signal) : internal.signal;

  const headers: Record<string, string> = {
    "X-Auth-Token": opts.config.apiToken,
    Accept: "application/json",
  };
  let bodyInit: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyInit = JSON.stringify(opts.body);
  }
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: opts.method,
      headers,
      body: bodyInit,
      signal,
    });
    if (!response.ok) {
      const { category, message } = classifyResponse(response.status);
      throw new DocusealProviderError(category, message, { status: response.status });
    }
    // 204 responses are common for DELETEs; treat as empty object.
    const text = await response.text();
    const data = (text ? JSON.parse(text) : {}) as T;
    return { data, attempts: 1, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof DocusealProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new DocusealProviderError("timeout", `DocuSeal request timed out after ${timeoutMs}ms.`);
    }
    throw new DocusealProviderError(
      "network",
      "Could not reach DocuSeal. Verify the apiUrl is reachable from the NoralOS server.",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Field-shaping helpers
// ---------------------------------------------------------------------------

function asStringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asArrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readTemplateSummary(raw: unknown): DocusealTemplateSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "number" || typeof o.name !== "string") return null;
  return {
    id: o.id,
    name: o.name,
    updatedAt: asStringOr(o.updated_at ?? o.updatedAt, ""),
    fieldCount: Array.isArray(o.fields) ? o.fields.length : 0,
  };
}

function readTemplateDetail(raw: unknown): DocusealTemplateDetail | null {
  const summary = readTemplateSummary(raw);
  if (!summary) return null;
  const o = raw as Record<string, unknown>;
  const submitters = asArrayOrEmpty(o.submitters)
    .map((s) => (s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string" ? (s as { name: string }).name : null))
    .filter((v): v is string => v !== null);
  const fields = asArrayOrEmpty(o.fields)
    .map((f) => {
      if (!f || typeof f !== "object") return null;
      const fo = f as Record<string, unknown>;
      if (typeof fo.uuid !== "string" || typeof fo.name !== "string") return null;
      return {
        uuid: fo.uuid,
        name: fo.name,
        type: asStringOr(fo.type, "text"),
        required: fo.required === true,
        submitter: asStringOr(fo.submitter, ""),
      };
    })
    .filter((f): f is DocusealTemplateField => f !== null);
  return { ...summary, submitters, fields };
}

function readSubmitter(raw: unknown): DocusealSubmitter | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = asNumberOrNull(o.id);
  const email = typeof o.email === "string" ? o.email : null;
  if (id === null || email === null) return null;
  const status = (typeof o.status === "string" ? o.status : "pending") as DocusealSubmitterStatus;
  return {
    id,
    uuid: asStringOr(o.uuid, ""),
    email,
    role: typeof o.role === "string" ? o.role : null,
    status,
    signingUrl: typeof o.embed_src === "string"
      ? o.embed_src
      : typeof o.sign_url === "string"
        ? o.sign_url
        : null,
    sentAt: typeof o.sent_at === "string" ? o.sent_at : null,
    openedAt: typeof o.opened_at === "string" ? o.opened_at : null,
    completedAt: typeof o.completed_at === "string" ? o.completed_at : null,
  };
}

function readSubmission(raw: unknown): DocusealSubmission | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = asNumberOrNull(o.id);
  if (id === null) return null;
  const templateId = asNumberOrNull((o.template as { id?: number })?.id ?? o.template_id);
  if (templateId === null) return null;
  const status = (typeof o.status === "string" ? o.status : "pending") as DocusealSubmission["status"];
  return {
    id,
    templateId,
    status,
    createdAt: asStringOr(o.created_at, ""),
    completedAt: typeof o.completed_at === "string" ? o.completed_at : null,
    auditLogUrl: typeof o.audit_log_url === "string" ? o.audit_log_url : null,
    submitters: asArrayOrEmpty(o.submitters)
      .map(readSubmitter)
      .filter((s): s is DocusealSubmitter => s !== null),
  };
}

function unwrapList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: unknown[] }).data;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listTemplates(
  config: DocusealClientConfig,
  request: ListTemplatesRequest = {},
): Promise<ListTemplatesResult> {
  const limit = Math.min(request.limit ?? 25, DOCUSEAL_MAX_PAGE_SIZE);
  const result = await docusealRequest<unknown>({
    method: "GET",
    path: "/templates",
    query: {
      limit,
      q: request.query?.trim() || undefined,
    },
    config,
    signal: request.signal,
  });
  const templates = unwrapList(result.data)
    .map(readTemplateSummary)
    .filter((t): t is DocusealTemplateSummary => t !== null);
  return { templates, attempts: result.attempts, latencyMs: result.latencyMs };
}

export async function getTemplate(
  config: DocusealClientConfig,
  templateId: number,
  signal?: AbortSignal,
): Promise<DocusealTemplateDetail> {
  const result = await docusealRequest<unknown>({
    method: "GET",
    path: `/templates/${encodeURIComponent(String(templateId))}`,
    config,
    signal,
  });
  const template = readTemplateDetail(result.data);
  if (!template) {
    throw new DocusealProviderError(
      "malformed",
      `DocuSeal returned an unexpected template payload for id ${templateId}.`,
    );
  }
  return template;
}

export async function createSubmission(
  config: DocusealClientConfig,
  request: CreateSubmissionRequest,
): Promise<DocusealSubmission> {
  if (request.submitters.length === 0) {
    throw new DocusealProviderError("malformed", "createSubmission requires at least one submitter.");
  }
  const body: Record<string, unknown> = {
    template_id: request.templateId,
    send_email: request.sendEmail !== false,
    submitters: request.submitters.map((s) => ({
      role: s.role,
      name: s.name,
      email: s.email,
      values: s.values,
    })),
  };
  if (request.message) body.message = { body: request.message };
  const result = await docusealRequest<unknown>({
    method: "POST",
    path: "/submissions",
    body,
    config,
    signal: request.signal,
  });
  // DocuSeal returns an array of submission rows when multiple submitters were created.
  // Normalise to a single submission view for the agent.
  const list = unwrapList(result.data);
  const first = list.length > 0 ? readSubmission(list[0]) : readSubmission(result.data);
  if (!first) {
    throw new DocusealProviderError(
      "malformed",
      "DocuSeal returned an unexpected submission payload.",
    );
  }
  return first;
}

export async function getSubmission(
  config: DocusealClientConfig,
  submissionId: number,
  signal?: AbortSignal,
): Promise<DocusealSubmission> {
  const result = await docusealRequest<unknown>({
    method: "GET",
    path: `/submissions/${encodeURIComponent(String(submissionId))}`,
    config,
    signal,
  });
  const submission = readSubmission(result.data);
  if (!submission) {
    throw new DocusealProviderError(
      "malformed",
      `DocuSeal returned an unexpected submission payload for id ${submissionId}.`,
    );
  }
  return submission;
}

export async function listSubmissions(
  config: DocusealClientConfig,
  request: ListSubmissionsRequest = {},
): Promise<ListSubmissionsResult> {
  const limit = Math.min(request.limit ?? 25, DOCUSEAL_MAX_PAGE_SIZE);
  const result = await docusealRequest<unknown>({
    method: "GET",
    path: "/submissions",
    query: {
      limit,
      status: request.status,
      template_id: request.templateId,
    },
    config,
    signal: request.signal,
  });
  const submissions = unwrapList(result.data)
    .map(readSubmission)
    .filter((s): s is DocusealSubmission => s !== null);
  return { submissions, attempts: result.attempts, latencyMs: result.latencyMs };
}

/**
 * Archive (void) a submission. DocuSeal exposes this as a soft-delete that
 * blocks further signer activity but preserves the audit trail.
 */
export async function voidSubmission(
  config: DocusealClientConfig,
  request: VoidSubmissionRequest,
): Promise<{ submissionId: number }> {
  await docusealRequest<unknown>({
    method: "DELETE",
    path: `/submissions/${encodeURIComponent(String(request.submissionId))}`,
    query: { reason: request.reason },
    config,
    signal: request.signal,
  });
  return { submissionId: request.submissionId };
}

export async function remindSigner(
  config: DocusealClientConfig,
  request: RemindSignerRequest,
): Promise<{ submissionId: number; remindedEmails: string[] }> {
  const submission = await getSubmission(config, request.submissionId, request.signal);
  // DocuSeal's reminder endpoint is keyed by submitter id, not email.
  const targets = submission.submitters.filter((s) => {
    if (s.status === "completed" || s.status === "declined") return false;
    if (request.signerEmail) return s.email.toLowerCase() === request.signerEmail.toLowerCase();
    return true;
  });
  if (targets.length === 0) {
    throw new DocusealProviderError(
      "not_found",
      request.signerEmail
        ? "No pending signer matched that email on this submission."
        : "No pending signers remain on this submission.",
    );
  }
  const remindedEmails: string[] = [];
  for (const submitter of targets) {
    await docusealRequest<unknown>({
      method: "POST",
      path: `/submitters/${encodeURIComponent(String(submitter.id))}/remind`,
      body: {},
      config,
      signal: request.signal,
    });
    remindedEmails.push(submitter.email);
  }
  return { submissionId: request.submissionId, remindedEmails };
}

export async function downloadSignedDocuments(
  config: DocusealClientConfig,
  submissionId: number,
  signal?: AbortSignal,
): Promise<DownloadSignedDocumentsResult> {
  const result = await docusealRequest<unknown>({
    method: "GET",
    path: `/submissions/${encodeURIComponent(String(submissionId))}/documents`,
    config,
    signal,
  });
  const documents = unwrapList(result.data)
    .map((raw): SignedDocument | null => {
      if (!raw || typeof raw !== "object") return null;
      const o = raw as Record<string, unknown>;
      const url = typeof o.url === "string" ? o.url : null;
      if (!url) return null;
      return { name: asStringOr(o.name, "signed-document.pdf"), url };
    })
    .filter((d): d is SignedDocument => d !== null);
  return { submissionId, documents, attempts: result.attempts, latencyMs: result.latencyMs };
}
