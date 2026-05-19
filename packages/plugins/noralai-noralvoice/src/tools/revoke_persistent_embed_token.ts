/**
 * `noralvoice:revoke_persistent_embed_token` tool handler.
 *
 * Phase 9D — Tier 3 write tool (manager tier).
 *
 * Security contract:
 *   Revokes the embed token in NoralVoice, deletes the stored token value
 *   from plugin state, and returns only `{ revoked: true; workflow_id }`.
 *   The previously-stored raw token is NEVER returned.
 */

import type { PluginStateClient } from "@noralos/plugin-sdk";
import {
  type NoralVoiceClientConfig,
  revokeWorkflowEmbedToken,
} from "../noralvoice-client.js";
import { STATE_NAMESPACE } from "../constants.js";
import { embedTokenStateKey } from "./create_persistent_embed_token.js";

export interface RevokePersistentEmbedTokenParams {
  workflowId: number;
}

export interface RevokePersistentEmbedTokenResult {
  content: string;
  data: {
    revoked: true;
    workflow_id: number;
  };
}

export async function executeRevokePersistentEmbedToken(
  config: NoralVoiceClientConfig,
  params: RevokePersistentEmbedTokenParams,
  state: PluginStateClient,
  companyId: string,
): Promise<RevokePersistentEmbedTokenResult> {
  // Revoke in NoralVoice first.
  await revokeWorkflowEmbedToken(config, params.workflowId);

  // Delete the stored token from plugin state.
  const stateKey = embedTokenStateKey(params.workflowId);
  await state.delete({
    scopeKind: "company",
    scopeId: companyId,
    namespace: STATE_NAMESPACE,
    stateKey,
  });

  // Return only revocation confirmation — never the previously-stored token.
  return {
    content: `Embed token for workflow ${params.workflowId} has been revoked and the stored ref deleted.`,
    data: {
      revoked: true,
      workflow_id: params.workflowId,
    },
  };
}
