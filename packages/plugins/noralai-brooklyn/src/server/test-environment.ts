/**
 * Brooklyn adapter `testEnvironment()`.
 *
 * Called by the Adapter Manager UI's "Test" button. Validates that the
 * configured `baseUrl` + `apiKey` can reach a Brooklyn LLM
 * endpoint. The probe issues a tiny chat completion so a `pass` result
 * implies both auth and basic model availability.
 *
 * Safety:
 *   - Never logs the API key.
 *   - Never echoes the upstream model id at warn+ level.
 *   - Returns hand-curated check messages, not the provider response
 *     body.
 */

import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@noralos/adapter-utils";
import { asNumber, asString, parseObject } from "@noralos/adapter-utils/server-utils";

import {
  BrooklynProviderError,
  brooklynChatComplete,
} from "../runpod-client.js";

const ADAPTER_TYPE = "noralai_brooklyn";

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const config = parseObject(ctx.config);
  const baseUrl = asString(config.baseUrl, "");
  const upstreamModel = asString(config.upstreamModel, "");
  const apiKey =
    asString(config.apiKey, "") || asString(config.apiKeyRef, "");
  const timeoutMs = Math.max(1, asNumber(config.timeoutSec, 10)) * 1000;

  const checks: AdapterEnvironmentCheck[] = [];
  const testedAt = new Date().toISOString();

  // ── Static config checks ──────────────────────────────────────
  if (!baseUrl) {
    checks.push({
      code: "missing_base_url",
      level: "error",
      message: "Brooklyn baseUrl is not configured.",
      hint: "Set adapterConfig.baseUrl to the OpenAI-compatible HTTPS endpoint.",
    });
  }
  if (!upstreamModel) {
    checks.push({
      code: "missing_upstream_model",
      level: "error",
      message: "Brooklyn upstreamModel is not configured.",
      hint: "Set adapterConfig.upstreamModel to the technical model id (e.g. provider/model-name).",
    });
  }
  if (!apiKey) {
    checks.push({
      code: "missing_api_key",
      level: "error",
      message: "Brooklyn API key credential is not assigned.",
      hint: "Save an API key under /company/settings/integrations and assign it to this adapter.",
    });
  } else if (apiKey.startsWith("company-secret:")) {
    checks.push({
      code: "unresolved_secret_ref",
      level: "error",
      message: "API key credential reference was not resolved by the host runtime.",
      hint: "This usually indicates a host integration issue; report to the operator.",
    });
  }

  if (checks.some((c) => c.level === "error")) {
    return { adapterType: ADAPTER_TYPE, status: "fail", checks, testedAt };
  }

  // ── Live probe ────────────────────────────────────────────────
  try {
    await brooklynChatComplete(
      {
        baseUrl,
        apiKey,
        upstreamModel,
        timeoutMs,
        // Don't retry on the test path — a single round-trip is what
        // the operator asked for and they'd rather see an honest fail
        // fast than a delayed pass.
        maxRetries: 0,
      },
      {
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 4,
        temperature: 0,
      },
    );
    checks.push({
      code: "probe_ok",
      level: "info",
      message: "Brooklyn LLM endpoint responded to a probe.",
    });
    return { adapterType: ADAPTER_TYPE, status: "pass", checks, testedAt };
  } catch (err) {
    const isBrooklynErr = err instanceof BrooklynProviderError;
    const category = isBrooklynErr ? err.category : "unknown";
    const status = isBrooklynErr ? err.status : undefined;
    checks.push({
      code: `probe_${category}`,
      level: "error",
      message: isBrooklynErr ? err.message : "Brooklyn probe failed",
      detail: status ? `HTTP ${status}` : null,
    });
    return { adapterType: ADAPTER_TYPE, status: "fail", checks, testedAt };
  }
}
