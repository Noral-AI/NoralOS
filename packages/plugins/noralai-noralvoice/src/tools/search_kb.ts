/**
 * `noralvoice:search_kb` tool handler.
 *
 * Phase 7 — promoted from board apiRoute. Read-only, worker tier.
 * Semantic search over the organization's knowledge-base chunks.
 */

import {
  type KbSearchHit,
  type NoralVoiceClientConfig,
  searchKbDocuments,
} from "../noralvoice-client.js";

export interface SearchKbParams {
  query: string;
  limit?: number;
}

export interface SearchKbResult {
  content: string;
  data: { hits: KbSearchHit[] };
}

export async function executeSearchKb(
  config: NoralVoiceClientConfig,
  params: SearchKbParams,
): Promise<SearchKbResult> {
  const { hits } = await searchKbDocuments(config, params);
  return {
    content:
      hits.length === 0
        ? `No KB chunks matched "${params.query}".`
        : `${hits.length} KB chunk${hits.length === 1 ? "" : "s"} matched "${params.query}".`,
    data: { hits },
  };
}
