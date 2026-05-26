/**
 * `noralvoice:create_persistent_embed_token` tool handler.
 *
 * Phase 9D — Tier 3 write tool (manager tier).
 *
 * Security contract:
 *   The raw embed token returned by NoralVoice is NEVER returned to the
 *   calling agent. Instead it is written to plugin state under a
 *   deterministic key (`embed-token-secret:<workflowId>`) scoped to the
 *   company. The tool result contains only the storage key (the "ref")
 *   and metadata. A reviewer can confirm by JSON.stringify-scanning the
 *   return value — the raw token must not appear.
 *
 * Why plugin state instead of ctx.secrets?
 *   `PluginSecretsClient` exposes only `resolve(ref)` — there is no
 *   write path. Plugin state (`ctx.state`) is the appropriate durable
 *   per-company KV store. The storage key returned here is the stable
 *   "ref" the agent keeps; the actual token is stored as the state value.
 *   Tokens are company-scoped (scopeKind="company") so they are isolated
 *   across tenants by the SDK.
 */

import type { PluginStateClient } from "@noralos/plugin-sdk";
import {
  type NoralVoiceClientConfig,
  createWorkflowEmbedToken,
} from "../noralvoice-client.js";
import { STATE_NAMESPACE } from "../constants.js";

/** Deterministic state key for the embed token of a given workflow. */
export function embedTokenStateKey(workflowId: number): string {
  return `embed-token-secret:${workflowId}`;
}

export interface CreatePersistentEmbedTokenParams {
  workflowId: number;
  expiresInDays?: number;
}

export interface CreatePersistentEmbedTokenResult {
  content: string;
  data: {
    embed_token_ref: string;
    workflow_id: number;
    expires_at?: string;
  };
}

export async function executeCreatePersistentEmbedToken(
  config: NoralVoiceClientConfig,
  params: CreatePersistentEmbedTokenParams,
  state: PluginStateClient,
  companyId: string,
): Promise<CreatePersistentEmbedTokenResult> {
  // Fetch the raw token from NoralVoice.
  const nvResult = await createWorkflowEmbedToken(
    config,
    params.workflowId,
    params.expiresInDays,
  );

  // Write the raw token to plugin state, scoped to this company.
  const stateKey = embedTokenStateKey(params.workflowId);
  await state.set(
    {
      scopeKind: "company",
      scopeId: companyId,
      namespace: STATE_NAMESPACE,
      stateKey,
    },
    nvResult.token,
  );

  // The ref is the storage key — agents use this to look up the token
  // later via ctx.secrets.resolve() or by calling get_persistent_embed_token.
  // IMPORTANT: nvResult.token MUST NOT appear in this return value.
  return {
    content: `Embed token created for workflow ${params.workflowId}. Secret ref: ${stateKey}.${nvResult.expiresAt ? ` Expires at ${nvResult.expiresAt}.` : ""}`,
    data: {
      embed_token_ref: stateKey,
      workflow_id: params.workflowId,
      expires_at: nvResult.expiresAt,
    },
  };
}
