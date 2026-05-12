/**
 * Host-side secret-reference resolution for the Brooklyn LLM adapter.
 *
 * The Brooklyn plugin stores its API key as an integration credential
 * (PR #46) and references it from `agents.adapterConfig.apiKeyRef`
 * using the string format `company-secret:<credential-id>`. The plugin
 * itself refuses to run when it sees that prefix (so a bug in the host
 * cannot leak an unresolved reference to the upstream service).
 *
 * This module supplies the wrapping logic that turns the reference
 * into plaintext immediately before the adapter's `execute()` /
 * `testEnvironment()` are invoked. The plaintext is never written to
 * the database, never echoed to logs, and never returned in error
 * messages — only the wrapped adapter sees it, and only for the
 * duration of the call.
 *
 * The resolver function is injected by the bootstrap (`server/src/index.ts`)
 * because the adapter registry is module-scoped and cannot import a
 * live `Db` handle. The wrapper closes over a runtime lookup so the
 * resolver can be set after registration without re-wiring anything.
 *
 * Boundaries:
 *   - This module knows nothing about the upstream provider; the
 *     plaintext is opaque.
 *   - It does NOT mutate the original `ctx.config` object; it builds
 *     a shallow copy so the heartbeat layer's redaction / persistence
 *     view of the config is unchanged.
 *   - It does NOT call into `secretService` directly — that would
 *     bypass the integration-credentials authorization layer.
 */

import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@noralos/adapter-utils";

import type { ServerAdapterModule } from "./types.js";

export const BROOKLYN_ADAPTER_TYPE = "noralai_brooklyn";
const SECRET_REF_PREFIX = "company-secret:";

export type BrooklynCredentialResolver = (
  companyId: string,
  credentialId: string,
) => Promise<string>;

let credentialResolver: BrooklynCredentialResolver | null = null;

/**
 * Inject the host's credential resolver. Call once during bootstrap,
 * after the `Db` handle is created and before any adapter `execute()`
 * can run. Passing `null` clears the resolver (used by tests).
 */
export function setBrooklynCredentialResolver(
  fn: BrooklynCredentialResolver | null,
): void {
  credentialResolver = fn;
}

export function getBrooklynCredentialResolver(): BrooklynCredentialResolver | null {
  return credentialResolver;
}

function parseRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(SECRET_REF_PREFIX)) return null;
  const id = value.slice(SECRET_REF_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

type ResolveOutcome =
  | { kind: "passthrough"; config: Record<string, unknown> }
  | { kind: "resolved"; config: Record<string, unknown> }
  | { kind: "no_resolver" }
  | { kind: "resolve_failed" };

async function resolveConfigSecrets(
  config: Record<string, unknown>,
  companyId: string,
): Promise<ResolveOutcome> {
  const ref = parseRef(config.apiKeyRef);
  if (!ref) return { kind: "passthrough", config };

  const resolver = credentialResolver;
  if (!resolver) return { kind: "no_resolver" };

  try {
    const plaintext = await resolver(companyId, ref);
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      return { kind: "resolve_failed" };
    }
    // Shallow copy: the heartbeat layer keeps its own view of the
    // original config (with the ref intact) for persistence / audit.
    const next: Record<string, unknown> = { ...config, apiKey: plaintext };
    delete next.apiKeyRef;
    return { kind: "resolved", config: next };
  } catch {
    // Swallow the cause — `errorMessage` below is the only thing the
    // operator sees, and we never want a stack trace or DB error
    // string echoing back to the run log.
    return { kind: "resolve_failed" };
  }
}

function unresolvedResult(reason: "no_resolver" | "resolve_failed"): AdapterExecutionResult {
  const message =
    reason === "no_resolver"
      ? "Brooklyn adapter received an apiKeyRef but no host-side credential resolver is registered."
      : "Brooklyn adapter could not resolve apiKeyRef to a credential. Confirm the credential exists for this company and is still active.";
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorMessage: message,
    errorCode: `brooklyn_${reason}`,
    errorFamily: null,
    provider: BROOKLYN_ADAPTER_TYPE,
    biller: BROOKLYN_ADAPTER_TYPE,
    model: "brooklyn-core",
    costUsd: null,
    errorMeta: { adapter: BROOKLYN_ADAPTER_TYPE },
  };
}

/**
 * Wrap a Brooklyn `ServerAdapterModule` so that any
 * `company-secret:<id>` value on `adapterConfig.apiKeyRef` is
 * resolved to plaintext on `apiKey` before the inner adapter sees
 * the call. The wrapping is type-agnostic at the host layer — it
 * just relies on the Brooklyn config-key contract — so adding a
 * second LLM adapter later that follows the same convention is a
 * one-line registry change.
 */
export function wrapBrooklynAdapter(adapter: ServerAdapterModule): ServerAdapterModule {
  const innerExecute = adapter.execute;
  const innerTestEnvironment = adapter.testEnvironment;

  const wrappedExecute = async (
    ctx: AdapterExecutionContext,
  ): Promise<AdapterExecutionResult> => {
    const outcome = await resolveConfigSecrets(ctx.config, ctx.agent.companyId);
    if (outcome.kind === "no_resolver") return unresolvedResult("no_resolver");
    if (outcome.kind === "resolve_failed") return unresolvedResult("resolve_failed");
    if (outcome.kind === "passthrough") return innerExecute(ctx);
    return innerExecute({ ...ctx, config: outcome.config });
  };

  const wrappedTestEnvironment = async (
    ctx: AdapterEnvironmentTestContext,
  ): Promise<AdapterEnvironmentTestResult> => {
    const outcome = await resolveConfigSecrets(ctx.config, ctx.companyId);
    if (outcome.kind === "resolved") {
      return innerTestEnvironment({ ...ctx, config: outcome.config });
    }
    // For `no_resolver` / `resolve_failed` / `passthrough`, defer to
    // the plugin: its static-check phase already produces a
    // structured `unresolved_secret_ref` check that the operator
    // can act on. Re-emitting it here would be redundant.
    return innerTestEnvironment(ctx);
  };

  return {
    ...adapter,
    execute: wrappedExecute,
    testEnvironment: wrappedTestEnvironment,
  };
}
