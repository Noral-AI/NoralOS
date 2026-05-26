/**
 * `noralvoice:get_persistent_embed_token` tool handler.
 *
 * Phase 9D — Tier 3 write tool (manager tier).
 *
 * Security contract:
 *   Returns the storage key ("ref") that was recorded when
 *   `create_persistent_embed_token` was called — NOT the raw token.
 *   If no ref has been stored for this workflow, returns null (the agent
 *   must call `create_persistent_embed_token` first).
 */

import type { PluginStateClient } from "@noralos/plugin-sdk";
import type { NoralVoiceClientConfig } from "../noralvoice-client.js";
import { STATE_NAMESPACE } from "../constants.js";
import { embedTokenStateKey } from "./create_persistent_embed_token.js";

export interface GetPersistentEmbedTokenParams {
  workflowId: number;
}

export interface GetPersistentEmbedTokenResult {
  content: string;
  data: {
    embed_token_ref: string | null;
    workflow_id: number;
  };
}

export async function executeGetPersistentEmbedToken(
  _config: NoralVoiceClientConfig,
  params: GetPersistentEmbedTokenParams,
  state: PluginStateClient,
  companyId: string,
): Promise<GetPersistentEmbedTokenResult> {
  const stateKey = embedTokenStateKey(params.workflowId);

  // Check whether the token was previously stored. We do NOT re-fetch
  // the raw token from NoralVoice — if nothing is stored, the agent
  // must call create_persistent_embed_token first.
  const stored = await state.get({
    scopeKind: "company",
    scopeId: companyId,
    namespace: STATE_NAMESPACE,
    stateKey,
  });

  if (stored === null || stored === undefined) {
    return {
      content: `No embed token ref found for workflow ${params.workflowId}. Call \`create_persistent_embed_token\` first.`,
      data: {
        embed_token_ref: null,
        workflow_id: params.workflowId,
      },
    };
  }

  // Return the ref (the storage key), not the stored token value.
  return {
    content: `Embed token ref for workflow ${params.workflowId}: ${stateKey}.`,
    data: {
      embed_token_ref: stateKey,
      workflow_id: params.workflowId,
    },
  };
}
