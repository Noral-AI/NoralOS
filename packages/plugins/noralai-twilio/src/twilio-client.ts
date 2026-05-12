/**
 * Twilio Messages API client.
 *
 * Narrow surface: a single `sendSms()` that POSTs to
 * `/2010-04-01/Accounts/{AccountSid}/Messages.json` with HTTP Basic
 * authentication (accountSid:authToken) and returns a structured result
 * or a typed error.
 *
 * Secrets handling:
 *   - `authToken` is captured by `sendSms()`, base64-encoded once into
 *     an `Authorization` header, and never logged or echoed in errors.
 *   - `accountSid` is treated as identifying-but-non-secret (it is
 *     visible in every Twilio API URL) — included in error context so
 *     operators can tell which account a failure belongs to.
 *   - Twilio response bodies are parsed for `code` / `message` to
 *     populate category and a safe, hand-shaped error message. Raw
 *     bodies are not surfaced to callers and not logged.
 *   - On retryable failures the message body and recipient number are
 *     reused exactly; nothing about the message content reaches a log
 *     line at warn+ level.
 */

const TWILIO_API_HOST = "https://api.twilio.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 1;

export interface TwilioClientConfig {
  /** Twilio Account SID. E.164-style "AC…" identifier. */
  accountSid: string;
  /** Twilio Auth Token. Used only to build the Authorization header. */
  authToken: string;
  /**
   * Override the default `https://api.twilio.com` base. Useful for
   * regional endpoints (e.g. Twilio Ireland) and for test stubs.
   */
  baseUrl?: string;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
  /** Max retries on transient errors (network, timeout, 429, 5xx). */
  maxRetries?: number;
}

export interface SendSmsRequest {
  /** E.164 destination number (e.g. "+15551234567"). */
  to: string;
  /** E.164 sender number; must be a number bound to the Twilio account. */
  from: string;
  /** Message body. Twilio enforces 1600 chars max; sender-side concat optional. */
  body: string;
  /** Caller-controlled abort. */
  signal?: AbortSignal;
}

export interface SendSmsResult {
  /** Twilio's `sid` for the created Message resource. */
  sid: string;
  /** Twilio status at the moment of the create call: usually `queued`. */
  status: string;
  /** Round-trip latency in ms. */
  latencyMs: number;
  /** HTTP attempts the client made (1 = first-try success). */
  attempts: number;
}

export type TwilioErrorCategory =
  | "misconfigured"
  | "auth"
  | "invalid_phone_number"
  | "rate_limit"
  | "server"
  | "timeout"
  | "network"
  | "malformed"
  | "unknown";

export class TwilioProviderError extends Error {
  category: TwilioErrorCategory;
  status?: number;
  /** Twilio's numeric error code, when the body parsed cleanly. */
  twilioCode?: number;
  constructor(
    category: TwilioErrorCategory,
    message: string,
    opts?: { status?: number; twilioCode?: number },
  ) {
    super(message);
    this.name = "TwilioProviderError";
    this.category = category;
    this.status = opts?.status;
    this.twilioCode = opts?.twilioCode;
  }
}

export function isRetryable(category: TwilioErrorCategory): boolean {
  return category === "network" || category === "timeout" || category === "rate_limit" || category === "server";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basicAuthHeader(accountSid: string, authToken: string): string {
  // Node-side: Buffer.from(...).toString("base64") matches what the
  // Twilio docs show for `curl -u sid:token`. Constant-time concerns
  // are not relevant — this header is sent over TLS and the auth token
  // is the only secret in the pair.
  const encoded = Buffer.from(`${accountSid}:${authToken}`, "utf-8").toString("base64");
  return `Basic ${encoded}`;
}

function classifyResponse(
  status: number,
  parsed: { code?: number; message?: string } | null,
): { category: TwilioErrorCategory; message: string; twilioCode?: number } {
  const twilioCode = typeof parsed?.code === "number" ? parsed.code : undefined;

  // Twilio error codes worth special-casing:
  //   20003 — Authentication error.
  //   21211 — Invalid 'To' phone number.
  //   21212 — Invalid 'From' phone number.
  //   21408 — Permission to send to that number not granted.
  //   21610 — Recipient has unsubscribed (STOP).
  //   20429 — Rate limit on a Messaging Service.
  if (status === 401 || twilioCode === 20003) {
    return {
      category: "auth",
      message: "Twilio rejected the Account SID / Auth Token pair.",
      twilioCode,
    };
  }
  if (status === 400) {
    if (twilioCode === 21211 || twilioCode === 21212 || twilioCode === 21408 || twilioCode === 21610) {
      return {
        category: "invalid_phone_number",
        message: "Twilio rejected the phone number (bad format, unauthorized sender, or unsubscribed recipient).",
        twilioCode,
      };
    }
    return {
      category: "malformed",
      message: "Twilio rejected the request payload.",
      twilioCode,
    };
  }
  if (status === 404) {
    return {
      category: "misconfigured",
      message: "Twilio account or messaging resource not found at the configured base URL.",
      twilioCode,
    };
  }
  if (status === 429 || twilioCode === 20429) {
    return {
      category: "rate_limit",
      message: "Twilio rate-limited the request.",
      twilioCode,
    };
  }
  if (status >= 500 && status < 600) {
    return {
      category: "server",
      message: "Twilio reported a server-side error.",
      twilioCode,
    };
  }
  return {
    category: "unknown",
    message: `Twilio returned HTTP ${status}.`,
    twilioCode,
  };
}

function jitterSleep(attempt: number): Promise<void> {
  // Exponential with bounded jitter. Twilio doesn't publish a retry-after
  // header for 429 reliably, so we fall back to client-side backoff.
  const base = Math.min(200 * Math.pow(2, attempt), 2_000);
  const delay = base + Math.floor(Math.random() * 200);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export async function sendSms(
  cfg: TwilioClientConfig,
  req: SendSmsRequest,
): Promise<SendSmsResult> {
  if (!cfg.accountSid || !cfg.accountSid.trim()) {
    throw new TwilioProviderError("misconfigured", "Missing Twilio accountSid.");
  }
  if (!cfg.authToken || !cfg.authToken.trim()) {
    throw new TwilioProviderError("misconfigured", "Missing Twilio authToken.");
  }
  if (!req.to.trim() || !req.from.trim() || !req.body) {
    throw new TwilioProviderError("malformed", "send_sms requires non-empty `to`, `from`, and `body`.");
  }

  const baseUrl = cfg.baseUrl?.replace(/\/+$/, "") ?? TWILIO_API_HOST;
  const url = `${baseUrl}/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
  const auth = basicAuthHeader(cfg.accountSid, cfg.authToken);

  // Twilio's Messages endpoint takes form-urlencoded, not JSON.
  const form = new URLSearchParams();
  form.set("To", req.to);
  form.set("From", req.from);
  form.set("Body", req.body);

  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = Math.max(0, cfg.maxRetries ?? DEFAULT_MAX_RETRIES);

  let attempt = 0;
  const startedAt = Date.now();
  // Outer loop = first attempt + retries. Break on success or on a
  // non-retryable error category.
  for (;;) {
    attempt += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cleanup = () => clearTimeout(timer);
    const upstreamSignal = req.signal;
    const onAbort = () => controller.abort();
    if (upstreamSignal) {
      if (upstreamSignal.aborted) controller.abort();
      else upstreamSignal.addEventListener("abort", onAbort, { once: true });
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      cleanup();
      upstreamSignal?.removeEventListener("abort", onAbort);
      const aborted = (err as Error)?.name === "AbortError";
      const category: TwilioErrorCategory = aborted ? "timeout" : "network";
      if (attempt <= maxRetries && isRetryable(category)) {
        await jitterSleep(attempt - 1);
        continue;
      }
      throw new TwilioProviderError(
        category,
        aborted
          ? `Twilio request timed out after ${timeoutMs}ms.`
          : "Twilio request failed before a response was received.",
      );
    }
    cleanup();
    upstreamSignal?.removeEventListener("abort", onAbort);

    if (res.status >= 200 && res.status < 300) {
      let parsed: { sid?: unknown; status?: unknown } = {};
      try {
        parsed = (await res.json()) as { sid?: unknown; status?: unknown };
      } catch {
        throw new TwilioProviderError(
          "malformed",
          "Twilio accepted the request but returned a non-JSON body.",
          { status: res.status },
        );
      }
      const sid = typeof parsed.sid === "string" ? parsed.sid : null;
      const status = typeof parsed.status === "string" ? parsed.status : null;
      if (!sid || !status) {
        throw new TwilioProviderError(
          "malformed",
          "Twilio response is missing the `sid` or `status` field.",
          { status: res.status },
        );
      }
      return {
        sid,
        status,
        latencyMs: Date.now() - startedAt,
        attempts: attempt,
      };
    }

    // Drain + parse the body once, then never reuse it. The error body
    // can legitimately contain the customer's `to` / `from` number,
    // which is why we hand-construct the safeMessage rather than echo.
    let parsedErr: { code?: number; message?: string } | null = null;
    try {
      parsedErr = (await res.json()) as { code?: number; message?: string };
    } catch {
      // Non-JSON error body — leave parsedErr null and rely on the HTTP
      // status alone for classification.
    }
    const classified = classifyResponse(res.status, parsedErr);

    if (attempt <= maxRetries && isRetryable(classified.category)) {
      await jitterSleep(attempt - 1);
      continue;
    }
    throw new TwilioProviderError(classified.category, classified.message, {
      status: res.status,
      twilioCode: classified.twilioCode,
    });
  }
}
