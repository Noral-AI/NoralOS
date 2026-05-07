/**
 * Result of a provider credential test.
 *
 * `error` is constrained to a fixed enum so we can never accidentally
 * surface raw provider response bodies through this channel.
 */
export type TestErrorCode =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "network"
  | "timeout"
  | "unknown";

export type TestResult =
  | { status: "ok"; statusCode: number }
  | { status: "fail"; statusCode?: number; error: TestErrorCode; message: string };

const ALLOWED_ERROR_CODES: ReadonlySet<TestErrorCode> = new Set([
  "unauthorized",
  "forbidden",
  "rate_limited",
  "network",
  "timeout",
  "unknown",
]);

const SAFE_MESSAGES: Readonly<Record<TestErrorCode, string>> = {
  unauthorized: "The provider rejected the credential as unauthorized.",
  forbidden: "The credential is valid but lacks required permissions.",
  rate_limited: "The provider rate-limited the test. Try again shortly.",
  network: "Could not reach the provider.",
  timeout: "The provider did not respond in time.",
  unknown: "The provider returned an unexpected response.",
};

export function failResult(error: TestErrorCode, statusCode?: number): TestResult {
  if (!ALLOWED_ERROR_CODES.has(error)) {
    return { status: "fail", error: "unknown", message: SAFE_MESSAGES.unknown, statusCode };
  }
  return { status: "fail", error, message: SAFE_MESSAGES[error], statusCode };
}

export function okResult(statusCode: number): TestResult {
  return { status: "ok", statusCode };
}

/**
 * Map a fetch failure (TypeError/AbortError/etc) to a sanitised TestResult.
 * Callers MUST never include the raw `err.message` from a provider response —
 * use this helper or `failResult` directly.
 */
export function failFromException(err: unknown): TestResult {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name?: string }).name;
    if (name === "AbortError" || name === "TimeoutError") {
      return failResult("timeout");
    }
  }
  return failResult("network");
}

/**
 * Map an HTTP status code to a sanitised TestResult for failure cases.
 * Provider response bodies are intentionally never read or returned.
 */
export function failFromStatus(statusCode: number): TestResult {
  if (statusCode === 401) return failResult("unauthorized", statusCode);
  if (statusCode === 403) return failResult("forbidden", statusCode);
  if (statusCode === 429) return failResult("rate_limited", statusCode);
  return failResult("unknown", statusCode);
}

const TIMEOUT_MS = 5_000;

/**
 * Shared fetch helper with a hard timeout. The response body is NOT consumed
 * here — callers should only inspect `res.status`. Reading the body could
 * leak provider error text into the caller and downstream logs.
 */
export async function timedFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
