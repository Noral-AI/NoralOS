/**
 * Brooklyn adapter `execute()`.
 *
 * Translates the canonical `AdapterExecutionContext` into a Brooklyn
 * (OpenAI-compatible) chat completion request, fires it, and packages
 * the response into the canonical `AdapterExecutionResult` shape so
 * the heartbeat layer, cost service, and UI consume it identically
 * to any other adapter.
 *
 * Boundaries:
 *   - This file does NOT resolve `company-secret:` references. The
 *     host runtime is expected to pre-resolve any `*Ref` fields in
 *     `adapterConfig` to plaintext before invoking the adapter. For
 *     PR 1, dev operators can paste the plaintext key directly into
 *     `agents.adapterConfig.apiKey`; the production
 *     pre-resolution hook is a follow-up integration task tracked in
 *     `BROOKLYN_LLM_INTEGRATION_MAP.md`.
 *   - This file does NOT write to `costEvents`. The host runtime
 *     reads `AdapterExecutionResult.usage` and writes the row.
 *   - This file does NOT log the API key, the upstream model id, or
 *     the assistant response text at INFO+ levels.
 */

import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@noralos/adapter-utils";
import { asNumber, asString, parseObject } from "@noralos/adapter-utils/server-utils";

import {
  BrooklynProviderError,
  brooklynChatComplete,
  type BrooklynChatMessage,
  type BrooklynClientConfig,
} from "../runpod-client.js";

const ADAPTER_TYPE = "noralai_brooklyn";
const DEFAULT_MODEL_ID = "brooklyn-core";

/**
 * Default upstream technical model id. This is the model the adapter
 * sends in the OpenAI-compatible request body when the operator has
 * not set `adapterConfig.upstreamModel` explicitly. Documented as a
 * named constant rather than scattered inline so a future config
 * change (different backend, different model family) is a one-line
 * edit and a one-line test update.
 *
 * Operators can override this per-agent without touching the adapter:
 *   agents.adapterConfig.upstreamModel = "<backend-specific-id>"
 *
 * This value is NEVER an operator-facing label; it is only sent in the
 * `model` field of the OpenAI-compatible HTTPS request body and
 * surfaced in `resultJson.upstreamModel` for admin diagnostics.
 */
export const DEFAULT_UPSTREAM_MODEL_ID = "Qwen/Qwen3-32B-FP8";

const SECRET_REF_PREFIX = "company-secret:";

export async function execute(
  ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  const config = parseObject(ctx.config);
  const context = parseObject(ctx.context);

  // ── Required configuration ────────────────────────────────────
  const baseUrl = asString(config.baseUrl, "");
  // `upstreamModel` is configurable per-agent. When unset, fall back
  // to `DEFAULT_UPSTREAM_MODEL_ID` (a named internal constant so the
  // backend swap is a one-line edit).
  const upstreamModel = asString(config.upstreamModel, DEFAULT_UPSTREAM_MODEL_ID);
  const model = asString(config.model, DEFAULT_MODEL_ID);
  const apiKeyOrRef =
    asString(config.apiKey, "") || asString(config.apiKeyRef, "");

  const missing: string[] = [];
  if (!baseUrl) missing.push("baseUrl");
  if (!apiKeyOrRef) missing.push("apiKey or apiKeyRef");
  if (missing.length > 0) {
    return errorResult(
      "config_missing",
      `Brooklyn adapter is missing required adapterConfig fields: ${missing.join(", ")}`,
    );
  }
  if (apiKeyOrRef.startsWith(SECRET_REF_PREFIX)) {
    return errorResult(
      "secret_ref_unresolved",
      "Brooklyn adapter received an unresolved secret reference. The host runtime must resolve company-secret refs to plaintext before invoking execute().",
    );
  }

  // ── Prompt assembly ───────────────────────────────────────────
  // Brooklyn is a chat-completion adapter, not a CLI tool. The host
  // doesn't currently emit a single `noralosWakePrompt` string for
  // non-local adapters, so we assemble one from the canonical context
  // fields it does populate (heartbeat.ts):
  //   - noralosContinuationSummary.body : prior-run handoff, if any
  //   - noralosTaskMarkdown             : task framing + issue body
  //   - noralosUserMessageMarkdown      : direct user message, if any
  // Anything still in `noralosWakePrompt` wins as an override so a
  // future host-side wake-prompt builder slots in without a plugin
  // bump.
  const overrideWakePrompt = asString(context.noralosWakePrompt, "");
  const continuationSummary = asString(
    parseObject(context.noralosContinuationSummary).body,
    "",
  );
  const taskMarkdown = asString(context.noralosTaskMarkdown, "");
  const userMessageMarkdown = asString(context.noralosUserMessageMarkdown, "");
  const wakePrompt = overrideWakePrompt
    ? overrideWakePrompt
    : [continuationSummary, taskMarkdown, userMessageMarkdown]
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join("\n\n---\n\n");
  if (!wakePrompt) {
    return errorResult(
      "no_prompt",
      "Brooklyn adapter received an empty wake prompt; nothing to send.",
    );
  }

  const messages: BrooklynChatMessage[] = [
    { role: "user", content: wakePrompt },
  ];

  // ── Client tuning ─────────────────────────────────────────────
  // `timeoutSec` of 0 (or anything non-positive) means "unset" — the host
  // defaults agents' adapter_config.timeoutSec to 0 across all adapters, so
  // we must not interpret it literally as a 1-second cap. Cold-start latency
  // on a serverless vLLM endpoint can be tens of seconds.
  const timeoutSecRaw = asNumber(config.timeoutSec, 0);
  const timeoutSec = timeoutSecRaw > 0 ? timeoutSecRaw : 30;
  const timeoutMs = timeoutSec * 1000;
  const maxRetries = Math.max(0, asNumber(config.maxRetries, 1));
  const temperature = asNumber(config.temperature, Number.NaN);
  const maxTokens = asNumber(config.maxTokens, Number.NaN);

  const clientCfg: BrooklynClientConfig = {
    baseUrl,
    apiKey: apiKeyOrRef,
    upstreamModel,
    timeoutMs,
    maxRetries,
  };

  // ── Fire ──────────────────────────────────────────────────────
  try {
    const result = await brooklynChatComplete(clientCfg, {
      messages,
      temperature: Number.isFinite(temperature) ? temperature : undefined,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
    });

    // Emit the assistant text to the host's log stream so the
    // standard issue-thread UI surfaces it. The text itself is the
    // operator-visible payload; the API key never reaches this path.
    await ctx.onLog("stdout", result.text);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: {
        inputTokens: result.usage?.promptTokens ?? 0,
        outputTokens: result.usage?.completionTokens ?? 0,
        // Cache-read tokens aren't reported by OpenAI-compatible
        // endpoints today; leave at 0 and let the cost layer treat
        // it as a "no cache" run.
        cachedInputTokens: 0,
      },
      provider: "noralai_brooklyn",
      biller: "noralai_brooklyn",
      model,
      // RunPod is GPU-time priced. NoralOS's per-token USD mapping
      // doesn't apply; we leave costUsd null so the host's cost
      // pipeline records tokens without an inferred dollar figure.
      // A follow-up PR can plug a per-credential rate table into
      // this slot.
      costUsd: null,
      billingType: "metered_api",
      resultJson: {
        attempts: result.attempts,
        latencyMs: result.latencyMs,
        // ADMIN-ONLY field. Never used as a UI label.
        upstreamModel,
      },
      summary: result.text.length > 240
        ? `${result.text.slice(0, 240)}…`
        : result.text,
    };
  } catch (err) {
    const isBrooklynErr = err instanceof BrooklynProviderError;
    const category = isBrooklynErr ? err.category : "unknown";
    const status = isBrooklynErr ? err.status : undefined;
    const safe = isBrooklynErr ? err.message : "Brooklyn call failed";

    // Log a safe summary. The pino redact list at the server layer
    // covers Authorization headers / keys; we don't repeat raw
    // bearer tokens here.
    await ctx.onLog(
      "stderr",
      `Brooklyn execute failed: category=${category}${status ? ` status=${status}` : ""}`,
    );

    return {
      exitCode: 1,
      signal: null,
      timedOut: category === "timeout",
      errorMessage: safe,
      errorCode: `brooklyn_${category}`,
      errorFamily: mapCategoryToErrorFamily(category),
      provider: "noralai_brooklyn",
      biller: "noralai_brooklyn",
      model,
      costUsd: null,
      errorMeta: { adapter: ADAPTER_TYPE, status },
    };
  }
}

type ErrorFamily = NonNullable<AdapterExecutionResult["errorFamily"]>;

/**
 * Map our internal categories to the (currently single-valued)
 * `AdapterExecutionErrorFamily` union. The host uses this to decide
 * whether to schedule a retry. Anything that's a clear caller-side
 * problem (config, auth, malformed) returns null so the host does
 * NOT retry.
 */
function mapCategoryToErrorFamily(category: string): ErrorFamily | null {
  switch (category) {
    case "rate_limit":
    case "timeout":
    case "network":
    case "server":
      return "transient_upstream";
    default:
      return null;
  }
}

function errorResult(code: string, message: string): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorMessage: message,
    errorCode: `brooklyn_${code}`,
    errorFamily: null,
    provider: "noralai_brooklyn",
    biller: "noralai_brooklyn",
    model: DEFAULT_MODEL_ID,
    costUsd: null,
    errorMeta: { adapter: ADAPTER_TYPE },
  };
}
