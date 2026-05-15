/**
 * Thin wrapper around `@noralai/voice-sdk`.
 *
 * Why a wrapper at all: the SDK's `DograhClient` is the right surface
 * for most callers, but the plugin needs (a) per-call construction
 * (apiKey resolved fresh from secrets store on each tool invocation),
 * (b) a small, stable error vocabulary that handler code can branch on
 * (`NO_API_KEY`, `UNREACHABLE`, `HTTP_4XX`, `HTTP_5XX`, `UNKNOWN`), and
 * (c) types narrowed to just what the Phase 1B tools consume.
 *
 * The wrapper does NOT cache clients across calls — the plugin's
 * security model is that an API key can be rotated mid-session and the
 * next tool call must see the new value. `ctx.secrets.resolve()` hits
 * the live key store; we construct a fresh client around its return
 * value every time.
 *
 * Phase 7 expects ~20 more tools. When we hit that scale we'll likely
 * promote this wrapper into a per-tool method surface; today it stays
 * intentionally thin.
 */

import { NORALVOICE_DEFAULT_TIMEOUT_MS } from "./constants.js";

export interface NoralVoiceClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface WorkflowSummary {
  uuid: string;
  name: string;
  status?: string;
  version?: number | string;
  lastRunAt?: string | null;
}

export interface RunSummary {
  runId: string;
  status: string;
  startedAt?: string;
  endedAt?: string | null;
  transcriptUrl?: string | null;
  recordingUrl?: string | null;
  extractedVariables?: Record<string, unknown>;
  costInfo?: Record<string, unknown>;
}

export type NoralVoiceErrorCategory =
  | "NO_API_KEY"
  | "UNREACHABLE"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "UNKNOWN";

export class NoralVoiceClientError extends Error {
  readonly category: NoralVoiceErrorCategory;
  readonly httpStatus?: number;

  constructor(message: string, category: NoralVoiceErrorCategory, httpStatus?: number) {
    super(message);
    this.name = "NoralVoiceClientError";
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

function buildHeaders(config: NoralVoiceClientConfig): Record<string, string> {
  return {
    "X-API-Key": config.apiKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

async function request<T>(
  config: NoralVoiceClientConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!config.apiKey) {
    throw new NoralVoiceClientError(
      "NoralVoice API key is empty.",
      "NO_API_KEY",
    );
  }
  const timeoutMs = config.timeoutMs ?? NORALVOICE_DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(joinUrl(config.baseUrl, path), {
      method,
      headers: buildHeaders(config),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new NoralVoiceClientError(
      `Could not reach NoralVoice at ${config.baseUrl}.`,
      "UNREACHABLE",
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 200 && response.status < 300) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const isClient = response.status >= 400 && response.status < 500;
  let detail = "";
  try {
    const body = (await response.json()) as { detail?: string; error?: string };
    detail = body.detail ?? body.error ?? "";
  } catch {
    detail = "";
  }
  throw new NoralVoiceClientError(
    detail || `NoralVoice returned HTTP ${response.status}.`,
    isClient ? "HTTP_4XX" : "HTTP_5XX",
    response.status,
  );
}

/** Internal — convert a NoralVoice workflow record to the Phase 1B summary shape. */
function toWorkflowSummary(record: Record<string, unknown>): WorkflowSummary {
  return {
    uuid: String(record.workflow_uuid ?? record.uuid ?? ""),
    name: String(record.name ?? ""),
    status: typeof record.status === "string" ? record.status : undefined,
    version:
      typeof record.version === "number" || typeof record.version === "string"
        ? record.version
        : undefined,
    lastRunAt:
      typeof record.last_run_at === "string" ? record.last_run_at : null,
  };
}

/** Internal — convert a NoralVoice run record to the Phase 1B summary shape. */
function toRunSummary(record: Record<string, unknown>): RunSummary {
  return {
    runId: String(record.id ?? record.run_id ?? ""),
    status: String(record.state ?? record.status ?? ""),
    startedAt:
      typeof record.created_at === "string" ? record.created_at : undefined,
    endedAt: null,
    transcriptUrl:
      typeof record.transcript_url === "string" ? record.transcript_url : null,
    recordingUrl:
      typeof record.recording_url === "string" ? record.recording_url : null,
    extractedVariables:
      record.gathered_context && typeof record.gathered_context === "object"
        ? (record.gathered_context as Record<string, unknown>)
        : {},
    costInfo:
      record.cost_info && typeof record.cost_info === "object"
        ? (record.cost_info as Record<string, unknown>)
        : {},
  };
}

export async function listWorkflows(
  config: NoralVoiceClientConfig,
  options: { limit?: number } = {},
): Promise<WorkflowSummary[]> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const path = params.toString()
    ? `/api/v1/workflow/?${params.toString()}`
    : "/api/v1/workflow/";
  const body = await request<unknown>(config, "GET", path);
  if (!Array.isArray(body)) return [];
  return body.map((r) => toWorkflowSummary(r as Record<string, unknown>));
}

export async function runCall(
  config: NoralVoiceClientConfig,
  params: {
    workflowUuid: string;
    toNumber: string;
    variables?: Record<string, string | number | boolean>;
  },
): Promise<{ runId: string; status: string; startedAt?: string }> {
  const body = await request<Record<string, unknown>>(
    config,
    "POST",
    `/api/v1/workflow/${encodeURIComponent(params.workflowUuid)}/run`,
    {
      to_number: params.toNumber,
      initial_context: params.variables ?? {},
    },
  );
  return {
    runId: String(body.id ?? body.run_id ?? ""),
    status: String(body.state ?? body.status ?? "queued"),
    startedAt: typeof body.created_at === "string" ? body.created_at : undefined,
  };
}

export async function getRun(
  config: NoralVoiceClientConfig,
  runId: string,
): Promise<RunSummary> {
  const body = await request<Record<string, unknown>>(
    config,
    "GET",
    `/api/v1/workflow-run/${encodeURIComponent(runId)}`,
  );
  return toRunSummary(body);
}

/**
 * Register a webhook with NoralVoice for an event type. Returns the
 * id + secret of the registration. The plugin must persist the secret
 * — subsequent inbound webhooks include it in their HMAC signature.
 *
 * Phase 5d: optional reverse-RPC fields. When the plugin wants to
 * receive ``noralos://<pluginId>/<toolName>`` reverse-RPC dispatches,
 * it includes ``reverseRpcUrl`` (where NoralVoice POSTs the signed
 * envelope) and ``reverseRpcSecret`` (HMAC-SHA256 key). NoralVoice
 * persists both; one row per organization is sufficient.
 *
 * The response carries the reverse_rpc_secret back so the plugin can
 * regenerate / rotate it server-side without keeping client-side
 * state. If neither field is supplied the row participates only in
 * the outbound webhook firing path.
 */
export async function registerIntegrationWebhook(
  config: NoralVoiceClientConfig,
  params: {
    eventType: string;
    targetUrl: string;
    reverseRpcUrl?: string;
    reverseRpcSecret?: string;
  },
): Promise<{
  id: number;
  secret: string;
  reverseRpcSecret: string | null;
}> {
  const body = await request<Record<string, unknown>>(
    config,
    "POST",
    "/api/v1/integration-webhooks",
    {
      event_type: params.eventType,
      target_url: params.targetUrl,
      ...(params.reverseRpcUrl ? { reverse_rpc_url: params.reverseRpcUrl } : {}),
      ...(params.reverseRpcSecret
        ? { reverse_rpc_secret: params.reverseRpcSecret }
        : {}),
    },
  );
  const reverseRpcSecret = body.reverse_rpc_secret;
  return {
    id: Number(body.id ?? 0),
    secret: String(body.secret ?? ""),
    reverseRpcSecret:
      typeof reverseRpcSecret === "string" && reverseRpcSecret.length > 0
        ? reverseRpcSecret
        : null,
  };
}

/** Idempotent delete; 404 is treated as success (already gone). */
export async function deleteIntegrationWebhook(
  config: NoralVoiceClientConfig,
  webhookId: number,
): Promise<void> {
  try {
    await request<unknown>(
      config,
      "DELETE",
      `/api/v1/integration-webhooks/${webhookId}`,
    );
  } catch (err) {
    if (err instanceof NoralVoiceClientError && err.httpStatus === 404) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Phase 3 surface: workflow CRUD + voice catalog
// ---------------------------------------------------------------------------

/**
 * NoralVoice TTS providers exposed by `GET /configurations/voices/{provider}`.
 *
 * Sourced from `api/routes/user.py`'s `TTSProvider` Literal as of 2026-05-15
 * (`elevenlabs|deepgram|sarvam|cartesia|dograh|rime`). If NoralVoice adds
 * providers later (the Phase 1B spec mentioned openai/speaches/camb as
 * candidates), expand this list to keep the typed surface honest.
 */
export const NORALVOICE_TTS_PROVIDERS = [
  "elevenlabs",
  "deepgram",
  "sarvam",
  "cartesia",
  "dograh",
  "rime",
] as const;
export type NoralVoiceTTSProvider = (typeof NORALVOICE_TTS_PROVIDERS)[number];

export interface NoralVoiceVoice {
  provider: NoralVoiceTTSProvider;
  voiceId: string;
  name: string;
  language?: string;
  gender?: string;
  previewUrl?: string;
}

/**
 * The Phase 3 settings shape that matters here: provider + voice (+
 * provider-specific options blob). Mirrors NoralVoice's
 * `workflow_configurations.model_overrides.tts` structure
 * (`api/services/configuration/registry.py` BaseTTSConfiguration +
 * provider subclasses).
 */
export interface WorkflowVoiceSettings {
  provider: NoralVoiceTTSProvider | null;
  voiceId: string | null;
  voiceName?: string;
  providerOptions?: Record<string, unknown>;
}

/** Full workflow record as returned by `GET /workflow/{id}` (the fields Phase 3 cares about). */
export interface WorkflowDetail {
  id: number;
  workflowUuid: string;
  name: string;
  status?: string;
  workflowConfigurations: Record<string, unknown>;
}

function toWorkflowDetail(record: Record<string, unknown>): WorkflowDetail {
  return {
    id: Number(record.id ?? 0),
    workflowUuid: String(record.workflow_uuid ?? ""),
    name: String(record.name ?? ""),
    status: typeof record.status === "string" ? record.status : undefined,
    workflowConfigurations:
      record.workflow_configurations && typeof record.workflow_configurations === "object"
        ? (record.workflow_configurations as Record<string, unknown>)
        : {},
  };
}

/** GET /api/v1/workflow/{workflow_id}. The integer id is required by NV here. */
export async function getWorkflowById(
  config: NoralVoiceClientConfig,
  workflowId: number,
): Promise<WorkflowDetail> {
  const body = await request<Record<string, unknown>>(
    config,
    "GET",
    `/api/v1/workflow/${workflowId}`,
  );
  return toWorkflowDetail(body);
}

/**
 * Resolve a workflow_uuid → numeric workflow id (NoralVoice's PUT /workflow/{id}
 * keys by integer id, not uuid). Implementation: list workflows and find the
 * matching uuid. Phase 7 should add an explicit `GET /workflow/by-uuid/{uuid}`
 * endpoint on NV — this is a cost-of-Phase-3 workaround.
 */
export async function getWorkflowByUuid(
  config: NoralVoiceClientConfig,
  workflowUuid: string,
): Promise<WorkflowDetail | null> {
  // /workflow/ accepts no uuid filter today, so we list + filter. The
  // typical NV org has ≤ low double digits of workflows; if that grows
  // we'll need an indexed endpoint.
  const all = await request<unknown>(config, "GET", "/api/v1/workflow/");
  if (!Array.isArray(all)) return null;
  const hit = all.find(
    (r) =>
      r && typeof r === "object" && (r as Record<string, unknown>).workflow_uuid === workflowUuid,
  ) as Record<string, unknown> | undefined;
  if (!hit) return null;
  // The list response may be summary-only; fetch full detail to get
  // workflow_configurations.
  return getWorkflowById(config, Number(hit.id));
}

/**
 * POST /api/v1/workflow/create/definition. Phase 3 uses the simplest
 * possible definition (one Agent node) so a freshly-provisioned voice
 * agent has a syntactically valid graph the operator can extend in the
 * NoralVoice editor (Phase 4 iframes it).
 *
 * NB: NV will reject an empty workflow_definition; the minimal viable
 * graph is the constant below.
 */
const MINIMAL_CONVERSATIONAL_DEFINITION: Record<string, unknown> = {
  nodes: [
    {
      id: "agent-1",
      type: "agentNode",
      position: { x: 0, y: 0 },
      data: {
        name: "Conversation",
        prompt: "You are a helpful voice assistant. Greet the caller and ask how you can help.",
      },
    },
  ],
  edges: [],
};

export async function createWorkflow(
  config: NoralVoiceClientConfig,
  params: { name: string; definition?: Record<string, unknown> },
): Promise<WorkflowDetail> {
  const body = await request<Record<string, unknown>>(
    config,
    "POST",
    "/api/v1/workflow/create/definition",
    {
      name: params.name,
      workflow_definition: params.definition ?? MINIMAL_CONVERSATIONAL_DEFINITION,
    },
  );
  return toWorkflowDetail(body);
}

/**
 * PUT /api/v1/workflow/{id}. NoralVoice's update endpoint is all-or-
 * nothing (no surgical PATCH for workflow_configurations), so callers
 * MUST read-then-write: GET to obtain current `workflow_configurations`,
 * merge the change, then PUT the whole back. The helpers below
 * (`getWorkflowVoiceSettings` / `setWorkflowVoiceSettings`) bundle that
 * pattern.
 */
export async function updateWorkflow(
  config: NoralVoiceClientConfig,
  workflowId: number,
  params: {
    name?: string;
    workflowDefinition?: Record<string, unknown>;
    workflowConfigurations?: Record<string, unknown>;
    templateContextVariables?: Record<string, unknown>;
  },
): Promise<WorkflowDetail> {
  const body = await request<Record<string, unknown>>(
    config,
    "PUT",
    `/api/v1/workflow/${workflowId}`,
    {
      name: params.name,
      workflow_definition: params.workflowDefinition,
      workflow_configurations: params.workflowConfigurations,
      template_context_variables: params.templateContextVariables,
    },
  );
  return toWorkflowDetail(body);
}

/** Read just the voice-related slice of a workflow's settings. */
export function extractVoiceSettings(workflow: WorkflowDetail): WorkflowVoiceSettings {
  const overrides = workflow.workflowConfigurations.model_overrides;
  if (!overrides || typeof overrides !== "object") {
    return { provider: null, voiceId: null };
  }
  const tts = (overrides as Record<string, unknown>).tts;
  if (!tts || typeof tts !== "object") {
    return { provider: null, voiceId: null };
  }
  const ttsObj = tts as Record<string, unknown>;
  const provider = typeof ttsObj.provider === "string" ? ttsObj.provider : null;
  const voiceId = typeof ttsObj.voice === "string" ? ttsObj.voice : null;
  // Whitelist provider names against the supported set; downstream
  // callers shouldn't have to re-check.
  const validProvider =
    provider && (NORALVOICE_TTS_PROVIDERS as readonly string[]).includes(provider)
      ? (provider as NoralVoiceTTSProvider)
      : null;
  return {
    provider: validProvider,
    voiceId,
    providerOptions: ttsObj,
  };
}

/**
 * Merge a new TTS provider+voice into a workflow's settings and PUT the
 * whole back. Preserves any other model_overrides fields (LLM, STT,
 * embeddings) verbatim.
 */
export async function setWorkflowVoiceSettings(
  config: NoralVoiceClientConfig,
  workflowUuid: string,
  next: { provider: NoralVoiceTTSProvider; voiceId: string; voiceOptions?: Record<string, unknown> },
): Promise<WorkflowVoiceSettings> {
  const current = await getWorkflowByUuid(config, workflowUuid);
  if (!current) {
    throw new NoralVoiceClientError(
      `Workflow ${workflowUuid} not found in NoralVoice.`,
      "HTTP_4XX",
      404,
    );
  }
  const cfg = { ...(current.workflowConfigurations ?? {}) };
  const overrides = { ...((cfg.model_overrides as Record<string, unknown>) ?? {}) };
  const ttsBlock: Record<string, unknown> = {
    provider: next.provider,
    voice: next.voiceId,
    ...(next.voiceOptions ?? {}),
  };
  overrides.tts = ttsBlock;
  cfg.model_overrides = overrides;
  const updated = await updateWorkflow(config, current.id, {
    workflowConfigurations: cfg,
  });
  return extractVoiceSettings(updated);
}

/**
 * GET /api/v1/configurations/voices/{provider}. The endpoint requires a
 * specific provider; iterating across all 6 happens client-side when
 * the caller doesn't pass a filter.
 */
export async function listVoicesForProvider(
  config: NoralVoiceClientConfig,
  provider: NoralVoiceTTSProvider,
): Promise<NoralVoiceVoice[]> {
  const body = await request<Record<string, unknown>>(
    config,
    "GET",
    `/api/v1/configurations/voices/${encodeURIComponent(provider)}`,
  );
  const arr = body.voices;
  if (!Array.isArray(arr)) return [];
  return arr.map((v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    return {
      provider,
      voiceId: String(r.voice_id ?? r.id ?? ""),
      name: String(r.name ?? ""),
      language: typeof r.language === "string" ? r.language : undefined,
      gender: typeof r.gender === "string" ? r.gender : undefined,
      previewUrl: typeof r.preview_url === "string" ? r.preview_url : undefined,
    };
  });
}

export async function listVoicesAcrossProviders(
  config: NoralVoiceClientConfig,
  providers: readonly NoralVoiceTTSProvider[] = NORALVOICE_TTS_PROVIDERS,
): Promise<NoralVoiceVoice[]> {
  // Sequential fan-out: the test runner has a 10s per-request timeout
  // and the catalog endpoints are cached server-side, so concurrency
  // doesn't buy us much here. Sequential gives nicer error attribution
  // when one provider fails.
  const all: NoralVoiceVoice[] = [];
  for (const provider of providers) {
    try {
      const voices = await listVoicesForProvider(config, provider);
      all.push(...voices);
    } catch (err) {
      // Don't fail the whole listing because one provider 5xx'd —
      // surface as an empty contribution. The caller log will see
      // partial results.
      if (err instanceof NoralVoiceClientError && err.category === "HTTP_5XX") continue;
      throw err;
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Phase 4: browse surfaces — runs, recordings, KB, campaigns, telephony, usage
// ---------------------------------------------------------------------------

export interface RunListItem {
  id: number;
  name: string;
  state: string;
  isCompleted: boolean;
  callType?: string;
  createdAt?: string;
  transcriptUrl?: string | null;
  recordingUrl?: string | null;
  costInfo?: Record<string, unknown> | null;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  nextCursor?: string | null;
}

function toRunListItem(r: Record<string, unknown>): RunListItem {
  return {
    id: Number(r.id ?? 0),
    name: String(r.name ?? ""),
    state: String(r.state ?? r.status ?? ""),
    isCompleted: Boolean(r.is_completed),
    callType: typeof r.call_type === "string" ? r.call_type : undefined,
    createdAt: typeof r.created_at === "string" ? r.created_at : undefined,
    transcriptUrl: typeof r.transcript_url === "string" ? r.transcript_url : null,
    recordingUrl: typeof r.recording_url === "string" ? r.recording_url : null,
    costInfo: r.cost_info && typeof r.cost_info === "object"
      ? (r.cost_info as Record<string, unknown>)
      : null,
  };
}

/**
 * List runs for a workflow. NoralVoice indexes workflows by integer id;
 * callers who only have the UUID resolve via getWorkflowByUuid first.
 *
 * The endpoint's pagination is offset-based (?limit=&offset=) rather
 * than cursor-based — we expose a cursor field on the wrapper to keep
 * the plugin apiRoute contract uniform, encoding `offset` as the cursor
 * string.
 */
export async function listWorkflowRuns(
  config: NoralVoiceClientConfig,
  workflowId: number,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<PagedResult<RunListItem>> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const offset =
    options.cursor && /^\d+$/.test(options.cursor) ? Number.parseInt(options.cursor, 10) : 0;
  const path = `/api/v1/workflow/${workflowId}/runs?limit=${limit}&offset=${offset}`;
  const body = await request<{ runs?: unknown[]; total?: number }>(config, "GET", path);
  const raw = Array.isArray(body.runs) ? body.runs : [];
  const items = raw.map((r) => toRunListItem(r as Record<string, unknown>));
  const total = Number(body.total ?? items.length);
  const nextOffset = offset + items.length;
  return {
    items,
    total,
    nextCursor: nextOffset < total ? String(nextOffset) : null,
  };
}

export async function getWorkflowRun(
  config: NoralVoiceClientConfig,
  workflowId: number,
  runId: number,
): Promise<RunListItem & { gatheredContext?: Record<string, unknown> | null }> {
  const r = await request<Record<string, unknown>>(
    config,
    "GET",
    `/api/v1/workflow/${workflowId}/runs/${runId}`,
  );
  return {
    ...toRunListItem(r),
    gatheredContext:
      r.gathered_context && typeof r.gathered_context === "object"
        ? (r.gathered_context as Record<string, unknown>)
        : null,
  };
}

// ---- Recordings ------------------------------------------------------------

export interface RecordingListItem {
  id: number;
  workflowId?: number;
  name?: string;
  ttsProvider?: string;
  ttsVoiceId?: string;
  durationSec?: number;
  createdAt?: string;
}

function toRecordingListItem(r: Record<string, unknown>): RecordingListItem {
  return {
    id: Number(r.id ?? 0),
    workflowId: typeof r.workflow_id === "number" ? r.workflow_id : undefined,
    name: typeof r.name === "string" ? r.name : undefined,
    ttsProvider: typeof r.tts_provider === "string" ? r.tts_provider : undefined,
    ttsVoiceId: typeof r.tts_voice_id === "string" ? r.tts_voice_id : undefined,
    durationSec: typeof r.duration_sec === "number" ? r.duration_sec : undefined,
    createdAt: typeof r.created_at === "string" ? r.created_at : undefined,
  };
}

export async function listRecordings(
  config: NoralVoiceClientConfig,
  options: { limit?: number; workflowId?: number } = {},
): Promise<PagedResult<RecordingListItem>> {
  const params = new URLSearchParams();
  if (options.workflowId !== undefined) params.set("workflow_id", String(options.workflowId));
  const path = params.toString()
    ? `/api/v1/workflow-recordings/?${params}`
    : "/api/v1/workflow-recordings/";
  const body = await request<{ recordings?: unknown[]; total?: number }>(config, "GET", path);
  const raw = Array.isArray(body.recordings) ? body.recordings : [];
  const items = raw.map((r) => toRecordingListItem(r as Record<string, unknown>));
  const total = Number(body.total ?? items.length);
  const limit = Math.max(1, Math.min(100, options.limit ?? items.length));
  return {
    items: items.slice(0, limit),
    total,
    // Recordings endpoint doesn't paginate today; cursor is null until
    // NV adds offset support.
    nextCursor: null,
  };
}

export async function getRecordingDownloadUrl(
  config: NoralVoiceClientConfig,
  recordingId: number,
): Promise<{ url: string; expiresAt?: string }> {
  const body = await request<Record<string, unknown>>(
    config,
    "GET",
    `/api/v1/workflow-recordings/${recordingId}/download-url`,
  );
  return {
    url: String(body.url ?? body.download_url ?? ""),
    expiresAt: typeof body.expires_at === "string" ? body.expires_at : undefined,
  };
}

// ---- Knowledge base --------------------------------------------------------

export interface KbDocumentSummary {
  id: number;
  name: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: string;
  chunkCount?: number;
}

export interface KbSearchHit {
  documentId: number;
  documentName?: string;
  chunkIndex?: number;
  text: string;
  score: number;
}

function toKbDocument(r: Record<string, unknown>): KbDocumentSummary {
  return {
    id: Number(r.id ?? 0),
    name: String(r.name ?? r.filename ?? ""),
    filename: typeof r.filename === "string" ? r.filename : undefined,
    mimeType: typeof r.mime_type === "string" ? r.mime_type : undefined,
    sizeBytes: typeof r.size_bytes === "number" ? r.size_bytes : undefined,
    createdAt: typeof r.created_at === "string" ? r.created_at : undefined,
    chunkCount: typeof r.chunk_count === "number" ? r.chunk_count : undefined,
  };
}

export async function listKbDocuments(
  config: NoralVoiceClientConfig,
  options: { limit?: number } = {},
): Promise<PagedResult<KbDocumentSummary>> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const body = await request<{ documents?: unknown[]; total?: number }>(
    config,
    "GET",
    `/api/v1/knowledge-base/documents?limit=${limit}`,
  );
  const raw = Array.isArray(body.documents) ? body.documents : [];
  const items = raw.map((r) => toKbDocument(r as Record<string, unknown>));
  return {
    items,
    total: Number(body.total ?? items.length),
    nextCursor: null,
  };
}

export async function searchKbDocuments(
  config: NoralVoiceClientConfig,
  params: { query: string; limit?: number },
): Promise<{ hits: KbSearchHit[] }> {
  const limit = Math.max(1, Math.min(50, params.limit ?? 10));
  const body = await request<{ hits?: unknown[] }>(
    config,
    "POST",
    "/api/v1/knowledge-base/search",
    { query: params.query, limit },
  );
  const raw = Array.isArray(body.hits) ? body.hits : [];
  return {
    hits: raw.map((h) => {
      const r = (h ?? {}) as Record<string, unknown>;
      return {
        documentId: Number(r.document_id ?? 0),
        documentName: typeof r.document_name === "string" ? r.document_name : undefined,
        chunkIndex: typeof r.chunk_index === "number" ? r.chunk_index : undefined,
        text: String(r.text ?? ""),
        score: typeof r.score === "number" ? r.score : 0,
      };
    }),
  };
}

// ---- Campaigns -------------------------------------------------------------

export interface CampaignSummary {
  id: number;
  name: string;
  status: string;
  workflowId?: number;
  totalContacts?: number;
  completedCalls?: number;
  createdAt?: string;
}

function toCampaign(r: Record<string, unknown>): CampaignSummary {
  return {
    id: Number(r.id ?? 0),
    name: String(r.name ?? ""),
    status: String(r.status ?? ""),
    workflowId: typeof r.workflow_id === "number" ? r.workflow_id : undefined,
    totalContacts: typeof r.total_contacts === "number" ? r.total_contacts : undefined,
    completedCalls: typeof r.completed_calls === "number" ? r.completed_calls : undefined,
    createdAt: typeof r.created_at === "string" ? r.created_at : undefined,
  };
}

export async function listCampaigns(
  config: NoralVoiceClientConfig,
  options: { status?: string; limit?: number } = {},
): Promise<PagedResult<CampaignSummary>> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.limit !== undefined) params.set("limit", String(Math.min(100, options.limit)));
  const path = params.toString() ? `/api/v1/campaign/?${params}` : "/api/v1/campaign/";
  const body = await request<{ campaigns?: unknown[]; total?: number }>(
    config,
    "GET",
    path,
  );
  const raw = Array.isArray(body.campaigns) ? body.campaigns : [];
  const items = raw.map((c) => toCampaign(c as Record<string, unknown>));
  return {
    items,
    total: Number(body.total ?? items.length),
    nextCursor: null,
  };
}

export async function getCampaign(
  config: NoralVoiceClientConfig,
  campaignId: number,
): Promise<CampaignSummary & { progress?: Record<string, unknown> | null }> {
  const r = await request<Record<string, unknown>>(
    config,
    "GET",
    `/api/v1/campaign/${campaignId}`,
  );
  return {
    ...toCampaign(r),
    progress: r.progress && typeof r.progress === "object"
      ? (r.progress as Record<string, unknown>)
      : null,
  };
}

// ---- Telephony -------------------------------------------------------------

export interface PhoneNumberSummary {
  id: number;
  phoneNumber: string;
  provider?: string;
  inboundWorkflowId?: number | null;
  isActive?: boolean;
  createdAt?: string;
}

export interface TelephonyProviderSummary {
  id: number;
  name: string;
  provider: string;
  isActive: boolean;
  isDefault?: boolean;
  createdAt?: string;
}

/**
 * NoralVoice exposes phone numbers under
 * /api/v1/organizations/telephony-configs/{config_id}/phone-numbers
 * (scoped to a telephony config). Phase 4 surfaces a flat list — we fan
 * out across the org's telephony configs and concatenate, attaching the
 * provider so the UI can display it. This is the cheapest path that
 * doesn't extend NV; if/when NV adds a flat
 * /telephony-phone-numbers endpoint, swap in here.
 */
export async function listTelephonyProviders(
  config: NoralVoiceClientConfig,
): Promise<TelephonyProviderSummary[]> {
  const body = await request<{ configurations?: unknown[] }>(
    config,
    "GET",
    "/api/v1/organizations/telephony-configs",
  );
  const raw = Array.isArray(body.configurations) ? body.configurations : [];
  return raw.map((c) => {
    const r = (c ?? {}) as Record<string, unknown>;
    return {
      id: Number(r.id ?? 0),
      name: String(r.name ?? ""),
      provider: String(r.provider ?? ""),
      isActive: Boolean(r.is_active),
      isDefault: typeof r.is_default === "boolean" ? r.is_default : undefined,
      createdAt: typeof r.created_at === "string" ? r.created_at : undefined,
    };
  });
}

export async function listTelephonyNumbers(
  config: NoralVoiceClientConfig,
): Promise<PhoneNumberSummary[]> {
  const providers = await listTelephonyProviders(config);
  const all: PhoneNumberSummary[] = [];
  for (const p of providers) {
    try {
      const body = await request<{ phone_numbers?: unknown[] }>(
        config,
        "GET",
        `/api/v1/organizations/telephony-configs/${p.id}/phone-numbers`,
      );
      const raw = Array.isArray(body.phone_numbers) ? body.phone_numbers : [];
      for (const n of raw) {
        const r = (n ?? {}) as Record<string, unknown>;
        all.push({
          id: Number(r.id ?? 0),
          phoneNumber: String(r.phone_number ?? r.number ?? ""),
          provider: p.provider,
          inboundWorkflowId:
            typeof r.inbound_workflow_id === "number" ? r.inbound_workflow_id : null,
          isActive: Boolean(r.is_active ?? true),
          createdAt: typeof r.created_at === "string" ? r.created_at : undefined,
        });
      }
    } catch (err) {
      // One config 5xx shouldn't fail the whole listing.
      if (err instanceof NoralVoiceClientError && err.category === "HTTP_5XX") continue;
      throw err;
    }
  }
  return all;
}

// ---- Usage / costs ---------------------------------------------------------

export interface CurrentPeriodUsage {
  /** Cents — caller treats as integer. */
  totalCostCents: number;
  callDurationSec?: number;
  callCount?: number;
  periodStart?: string;
  periodEnd?: string;
  perWorkflow?: Array<{
    workflowId?: number;
    workflowUuid?: string;
    workflowName?: string;
    costCents: number;
    callCount?: number;
  }>;
}

/**
 * NoralVoice's /usage/current-period returns spend in USD. Convert to
 * cents for parity with NoralOS's cost_events table (integer cents).
 * If NV adds time-window filtering later, pass it through as
 * `?period_start=&period_end=`.
 */
export async function getCurrentPeriodUsage(
  config: NoralVoiceClientConfig,
): Promise<CurrentPeriodUsage> {
  const body = await request<Record<string, unknown>>(
    config,
    "GET",
    "/api/v1/organizations/usage/current-period",
  );
  const totalCostUsd = Number(body.total_cost_usd ?? body.total_cost ?? 0);
  return {
    totalCostCents: Math.round(totalCostUsd * 100),
    callDurationSec:
      typeof body.call_duration_seconds === "number"
        ? body.call_duration_seconds
        : undefined,
    callCount: typeof body.call_count === "number" ? body.call_count : undefined,
    periodStart: typeof body.period_start === "string" ? body.period_start : undefined,
    periodEnd: typeof body.period_end === "string" ? body.period_end : undefined,
    perWorkflow: Array.isArray(body.per_workflow)
      ? (body.per_workflow as Record<string, unknown>[]).map((r) => ({
          workflowId: typeof r.workflow_id === "number" ? r.workflow_id : undefined,
          workflowUuid: typeof r.workflow_uuid === "string" ? r.workflow_uuid : undefined,
          workflowName: typeof r.workflow_name === "string" ? r.workflow_name : undefined,
          costCents: Math.round(Number(r.cost_usd ?? r.total_cost_usd ?? 0) * 100),
          callCount: typeof r.call_count === "number" ? r.call_count : undefined,
        }))
      : undefined,
  };
}

// ---- Phase 4 PR-B: exchange-token wrapper ---------------------------------

export interface ExchangeTokenResult {
  token: string;
  expiresAt: string;
  embedUrl: string;
}

export async function createEmbedExchangeToken(
  config: NoralVoiceClientConfig,
  params: { targetUserEmail: string; targetPath: string; ttlSeconds?: number },
): Promise<ExchangeTokenResult> {
  const body = await request<Record<string, unknown>>(
    config,
    "POST",
    "/api/v1/embed/exchange-token",
    {
      target_user_email: params.targetUserEmail,
      target_path: params.targetPath,
      ttl_seconds: params.ttlSeconds ?? 90,
    },
  );
  return {
    token: String(body.token ?? ""),
    expiresAt: String(body.expires_at ?? ""),
    embedUrl: String(body.embed_url ?? ""),
  };
}
