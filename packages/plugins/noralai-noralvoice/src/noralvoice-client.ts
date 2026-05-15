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
