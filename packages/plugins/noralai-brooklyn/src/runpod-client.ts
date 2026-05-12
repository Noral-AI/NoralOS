/**
 * Brooklyn LLM — OpenAI-compatible chat completion client.
 *
 * Brooklyn talks to a RunPod-hosted OpenAI-compatible endpoint. The
 * client is intentionally narrow: one POST, typed errors, bounded
 * retries on transient categories.
 *
 * Secrets handling:
 *   - The API key is passed in via `cfg.apiKey`, used immediately to
 *     build a `Bearer` header, and never logged or echoed in errors.
 *   - Error messages are sanitized by category; raw provider response
 *     bodies are not surfaced to callers.
 *   - The upstream technical model id (e.g. "Qwen/Qwen3-32B-FP8") is
 *     sent to RunPod but never written to log lines at warn+ level.
 */

export interface BrooklynClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Upstream technical model id, e.g. "Qwen/Qwen3-32B-FP8". */
  upstreamModel: string;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
  /** Max retries on transient errors (network, timeout, 408/429/5xx). */
  maxRetries?: number;
}

export interface BrooklynChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface BrooklynChatRequest {
  messages: BrooklynChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Optional JSON-mode hint for OpenAI-compatible endpoints. */
  jsonMode?: boolean;
  /** Caller-controlled abort. */
  signal?: AbortSignal;
}

export interface BrooklynChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface BrooklynChatResult {
  text: string;
  usage?: BrooklynChatUsage;
  /** HTTP attempts the client made (1 = first-try success). */
  attempts: number;
  /** Round-trip latency in ms. */
  latencyMs: number;
}

export type BrooklynErrorCategory =
  | "misconfigured"
  | "auth"
  | "not_found"
  | "rate_limit"
  | "server"
  | "timeout"
  | "network"
  | "malformed"
  | "unknown";

export class BrooklynProviderError extends Error {
  category: BrooklynErrorCategory;
  status?: number;
  constructor(category: BrooklynErrorCategory, message: string, status?: number) {
    super(message);
    this.name = "BrooklynProviderError";
    this.category = category;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CATEGORIES: ReadonlySet<BrooklynErrorCategory> = new Set([
  "network",
  "timeout",
  "rate_limit",
  "server",
]);

export function isRetryable(err: BrooklynProviderError): boolean {
  if (err.status && RETRYABLE_STATUSES.has(err.status)) return true;
  return RETRYABLE_CATEGORIES.has(err.category);
}

/**
 * Single chat completion against the Brooklyn LLM endpoint with bounded
 * retry on transient categories.
 */
export async function brooklynChatComplete(
  cfg: BrooklynClientConfig,
  req: BrooklynChatRequest,
): Promise<BrooklynChatResult> {
  if (!cfg.baseUrl) {
    throw new BrooklynProviderError("misconfigured", "Brooklyn client missing baseUrl");
  }
  if (!cfg.apiKey) {
    throw new BrooklynProviderError("misconfigured", "Brooklyn client missing apiKey");
  }
  if (!cfg.upstreamModel) {
    throw new BrooklynProviderError("misconfigured", "Brooklyn client missing upstreamModel");
  }

  const url = `${trimTrailingSlash(cfg.baseUrl)}/chat/completions`;
  const body: Record<string, unknown> = {
    model: cfg.upstreamModel,
    messages: req.messages,
    stream: false,
  };
  if (typeof req.maxTokens === "number") body.max_tokens = req.maxTokens;
  if (typeof req.temperature === "number") body.temperature = req.temperature;
  if (req.jsonMode) body.response_format = { type: "json_object" };

  const maxRetries = Math.max(0, cfg.maxRetries ?? DEFAULT_MAX_RETRIES);
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const t0 = Date.now();
  let lastErr: BrooklynProviderError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const text = await singleAttempt(url, body, cfg.apiKey, timeoutMs, req.signal);
      const parsed = parseChatResponse(text);
      return {
        text: parsed.text,
        usage: parsed.usage,
        attempts: attempt + 1,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      const e = err instanceof BrooklynProviderError
        ? err
        : new BrooklynProviderError("unknown", (err as Error)?.message ?? "unknown error");
      lastErr = e;
      if (req.signal?.aborted) throw e;
      if (!isRetryable(e) || attempt >= maxRetries) {
        throw e;
      }
      await delayWithJitter(attempt, req.signal);
    }
  }
  throw lastErr ?? new BrooklynProviderError("unknown", "retry loop exhausted");
}

async function singleAttempt(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): Promise<string> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  let onCallerAbort: (() => void) | undefined;
  if (callerSignal) {
    if (callerSignal.aborted) ctrl.abort();
    else {
      onCallerAbort = () => ctrl.abort();
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(tid);
    if (callerSignal && onCallerAbort) {
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
    if (ctrl.signal.aborted && !callerSignal?.aborted) {
      throw new BrooklynProviderError("timeout", `Request timed out after ${timeoutMs}ms`);
    }
    throw new BrooklynProviderError("network", (err as Error)?.message ?? "network error");
  } finally {
    clearTimeout(tid);
    if (callerSignal && onCallerAbort) {
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }

  if (!res.ok) {
    // Drain the body without surfacing it. Provider responses on auth
    // failures occasionally echo headers; never let that leak.
    try { await res.text(); } catch { /* ignore */ }
    throw new BrooklynProviderError(
      classifyStatus(res.status),
      sanitizeMessage(res.status),
      res.status,
    );
  }

  // Capture as text first so a non-JSON body doesn't throw inside the
  // parser without our error-class wrapping.
  return await res.text();
}

interface ParsedResponse {
  text: string;
  usage?: BrooklynChatUsage;
}

function parseChatResponse(raw: string): ParsedResponse {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new BrooklynProviderError("malformed", "Brooklyn endpoint returned non-JSON body");
  }
  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new BrooklynProviderError("malformed", "Brooklyn response missing choices array");
  }
  const c = choices[0] as Record<string, unknown>;
  const msg = c.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  let text: string | null = null;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts = content
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as Record<string, unknown>).text ?? "") : ""))
      .filter(Boolean);
    if (parts.length > 0) text = parts.join("");
  }
  if (text === null) {
    throw new BrooklynProviderError("malformed", "Brooklyn response missing assistant text");
  }
  const usageRaw = json.usage as Record<string, number> | undefined;
  const usage = usageRaw
    ? {
        promptTokens: usageRaw.prompt_tokens,
        completionTokens: usageRaw.completion_tokens,
        totalTokens: usageRaw.total_tokens,
      }
    : undefined;
  return { text, usage };
}

function classifyStatus(status: number): BrooklynErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "unknown";
}

/**
 * Hand-curated error messages, never the provider body. The status code
 * is the only operator-visible signal.
 */
function sanitizeMessage(status: number): string {
  switch (status) {
    case 401: case 403: return "Brooklyn rejected the request (auth error)";
    case 404: return "Brooklyn endpoint not found";
    case 408: case 504: return "Brooklyn request timed out";
    case 429: return "Brooklyn rate limit hit; try later";
    default:
      if (status >= 500) return "Brooklyn server error";
      return "Brooklyn request failed";
  }
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

async function delayWithJitter(attempt: number, signal?: AbortSignal): Promise<void> {
  const base = Math.min(8000, 500 * 2 ** attempt);
  const jitter = Math.random() * base * 0.25;
  const total = base + jitter;
  if (!signal) {
    await new Promise((r) => setTimeout(r, total));
    return;
  }
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, total);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
