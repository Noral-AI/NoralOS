// Provider-specific test handlers for the visible Integrations page.
//
// HARD SECURITY RULES:
//
//   1. Plaintext secret values are accepted only inside this module's
//      `runProviderTest` function. They are immediately substituted into
//      a request URL/header and the request is fired. The plaintext is
//      never assigned to a logger-visible variable, never returned, and
//      never echoed back to the caller.
//   2. The provider's HTTP response body is read into a junk variable
//      solely to drain the socket. Its content is never returned and
//      never logged.
//   3. The result returned to the caller is `{ ok, statusCode, safeMessage }`
//      — a hand-curated message string, not the provider body.
//   4. Tests have a hard 10-second timeout PER PROBE to prevent hanging the
//      admin's request thread on a slow provider. A provider may declare
//      fallback probes (tried only when the primary probe fails); each is
//      bounded by the same 10s timeout and the same no-body-leak rules, and
//      the operator-facing failure message always comes from the PRIMARY
//      probe so a fallback's upstream identity never leaks.
//
// Phase 1 supports `google_tts` and `elevenlabs` only.

import {
  INTEGRATION_PROVIDERS,
  type IntegrationProviderTestResult,
  type IntegrationTestSpec,
} from "@noralos/shared";

const TEST_TIMEOUT_MS = 10_000;

function substitutePlaceholders(
  template: string,
  fields: Record<string, string>,
): { ok: true; value: string } | { ok: false; missing: string } {
  let result = template;
  const tokens = [...template.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)];
  for (const match of tokens) {
    const key = match[1]!;
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      return { ok: false, missing: key };
    }
    result = result.replaceAll(`{{${key}}}`, fields[key]!);
  }
  return { ok: true, value: result };
}

function buildRequest(
  spec: IntegrationTestSpec,
  fields: Record<string, string>,
): { url: string; headers: Record<string, string>; method: "GET" } | { error: string } {
  // If the provider declares HTTP Basic auth via two fields, derive the
  // base64-encoded token once and expose it as `__basicAuth` so headers
  // can substitute it like any other placeholder. We do NOT mutate the
  // caller's map; this scratch copy is discarded with the request.
  let resolvedFields = fields;
  if (spec.basicAuth) {
    const user = fields[spec.basicAuth.userField];
    const pass = fields[spec.basicAuth.passField];
    if (!user || !pass) {
      return {
        error: `Provider basicAuth references missing field(s): ${spec.basicAuth.userField}, ${spec.basicAuth.passField}`,
      };
    }
    resolvedFields = {
      ...fields,
      __basicAuth: Buffer.from(`${user}:${pass}`, "utf8").toString("base64"),
    };
  }

  let url: string;
  if (spec.urlTemplate) {
    const sub = substitutePlaceholders(spec.urlTemplate, resolvedFields);
    if (!sub.ok) return { error: `Provider config references missing field: ${sub.missing}` };
    url = sub.value;
  } else if (spec.url) {
    url = spec.url;
  } else {
    return { error: "Provider test config has neither url nor urlTemplate" };
  }
  const headers: Record<string, string> = {};
  for (const [name, valueTemplate] of Object.entries(spec.headers ?? {})) {
    const sub = substitutePlaceholders(valueTemplate, resolvedFields);
    if (!sub.ok) return { error: `Provider config references missing field: ${sub.missing}` };
    headers[name] = sub.value;
  }
  return { url, headers, method: spec.method };
}

/**
 * The result of firing one probe. No response body is ever captured here —
 * the socket is drained into a junk variable and discarded. `config_error`
 * is a registry/caller problem (e.g. a placeholder field is missing) and is
 * detected before any network call fires.
 */
type ProbeOutcome =
  | { kind: "ok"; statusCode: number }
  | { kind: "bad_status"; statusCode: number }
  | { kind: "config_error"; message: string }
  | { kind: "timeout" }
  | { kind: "network" };

/**
 * Fire a single probe. Builds the request, applies the per-probe timeout,
 * drains the body without surfacing it, and classifies the outcome. Never
 * returns the response body or the plaintext fields.
 */
async function attemptProbe(
  spec: IntegrationTestSpec,
  fields: Record<string, string>,
): Promise<ProbeOutcome> {
  const built = buildRequest(spec, fields);
  if ("error" in built) {
    return { kind: "config_error", message: built.error };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const res = await fetch(built.url, {
      method: built.method,
      headers: built.headers,
      signal: controller.signal,
    });
    // Drain the socket without surfacing the body.
    await res.text().catch(() => "");
    return spec.okStatuses.includes(res.status)
      ? { kind: "ok", statusCode: res.status }
      : { kind: "bad_status", statusCode: res.status };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return aborted ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the provider-specific test for a credential. The plaintext value is
 * accepted only here, used immediately, and discarded.
 *
 * A provider declares one primary `test` probe and may declare ordered
 * `fallbackProbes`. The credential passes if the primary OR any fallback
 * returns an ok status. When nothing validates, the operator-facing message
 * always reflects the PRIMARY probe — a fallback's upstream identity (e.g.
 * the DeepSeek backend behind the NoralAI brand) never leaks.
 */
export async function runProviderTest(
  providerId: string,
  /** Plaintext fields. For Phase 1 providers this is `{ apiKey: "<value>" }`. */
  fields: Record<string, string>,
): Promise<IntegrationProviderTestResult> {
  const provider = INTEGRATION_PROVIDERS[providerId];
  if (!provider) {
    return {
      ok: false,
      statusCode: 0,
      safeMessage: `Unknown provider: ${providerId}`,
    };
  }

  const primary = provider.test;

  // Primary probe first. A config error (e.g. a missing placeholder field)
  // is a registry/caller problem; it short-circuits before any network call
  // and before any fallback, preserving the existing "missing field" /
  // "no url" behavior.
  const primaryOutcome = await attemptProbe(primary, fields);
  if (primaryOutcome.kind === "config_error") {
    return { ok: false, statusCode: 0, safeMessage: primaryOutcome.message };
  }
  if (primaryOutcome.kind === "ok") {
    return {
      ok: true,
      statusCode: primaryOutcome.statusCode,
      safeMessage: "Provider accepted the credential.",
    };
  }

  // Primary did not pass. Try fallback probes in order; the credential
  // passes if any returns an ok status. A fallback's own config errors,
  // timeouts, and network failures are skipped silently — only an ok
  // result matters here.
  for (const fallback of primary.fallbackProbes ?? []) {
    const outcome = await attemptProbe(fallback, fields);
    if (outcome.kind === "ok") {
      return {
        ok: true,
        statusCode: outcome.statusCode,
        safeMessage: "Provider accepted the credential.",
      };
    }
  }

  // Nothing validated. Surface the PRIMARY probe's failure verbatim so the
  // message wording matches the previous single-probe behavior exactly and
  // no fallback upstream is named.
  if (primaryOutcome.kind === "bad_status") {
    return {
      ok: false,
      statusCode: primaryOutcome.statusCode,
      safeMessage: `${primary.safeErrorPrefix} (HTTP ${primaryOutcome.statusCode}).`,
    };
  }
  if (primaryOutcome.kind === "timeout") {
    return {
      ok: false,
      statusCode: 0,
      safeMessage: `${primary.safeErrorPrefix}: request timed out after ${TEST_TIMEOUT_MS / 1000}s.`,
    };
  }
  return {
    ok: false,
    statusCode: 0,
    safeMessage: `${primary.safeErrorPrefix}: network error.`,
  };
}
