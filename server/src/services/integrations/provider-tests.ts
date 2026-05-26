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
//   4. Tests have a hard 10-second timeout to prevent hanging the
//      admin's request thread on a slow provider.
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
 * Run the provider-specific test for a credential. The plaintext value is
 * accepted only here, used immediately, and discarded.
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
  const built = buildRequest(provider.test, fields);
  if ("error" in built) {
    return { ok: false, statusCode: 0, safeMessage: built.error };
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
    const ok = provider.test.okStatuses.includes(res.status);
    return {
      ok,
      statusCode: res.status,
      safeMessage: ok
        ? "Provider accepted the credential."
        : `${provider.test.safeErrorPrefix} (HTTP ${res.status}).`,
    };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return {
      ok: false,
      statusCode: 0,
      safeMessage: aborted
        ? `${provider.test.safeErrorPrefix}: request timed out after ${TEST_TIMEOUT_MS / 1000}s.`
        : `${provider.test.safeErrorPrefix}: network error.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
