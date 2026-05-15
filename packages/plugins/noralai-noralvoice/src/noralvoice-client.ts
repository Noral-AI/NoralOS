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
 */
export async function registerIntegrationWebhook(
  config: NoralVoiceClientConfig,
  params: { eventType: string; targetUrl: string },
): Promise<{ id: number; secret: string }> {
  const body = await request<Record<string, unknown>>(
    config,
    "POST",
    "/api/v1/integration-webhooks",
    { event_type: params.eventType, target_url: params.targetUrl },
  );
  return {
    id: Number(body.id ?? 0),
    secret: String(body.secret ?? ""),
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
