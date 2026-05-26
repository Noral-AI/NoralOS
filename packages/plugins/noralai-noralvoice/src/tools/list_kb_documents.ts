/**
 * `noralvoice:list_kb_documents` tool handler.
 *
 * Phase 9C — Tier 2 read tool (worker tier).
 * Lists knowledge-base documents, optionally filtered by processing status.
 */

import {
  type KbDocumentSummary,
  type NoralVoiceClientConfig,
  type PagedResult,
  listKbDocumentsFiltered,
} from "../noralvoice-client.js";

export interface ListKbDocumentsParams {
  status?: string;
  limit?: number;
}

export interface ListKbDocumentsResult {
  content: string;
  data: PagedResult<KbDocumentSummary>;
}

export async function executeListKbDocuments(
  config: NoralVoiceClientConfig,
  params: ListKbDocumentsParams,
): Promise<ListKbDocumentsResult> {
  const result = await listKbDocumentsFiltered(config, {
    status: params.status,
    limit: params.limit,
  });
  return {
    content:
      result.items.length === 0
        ? "No knowledge-base documents found."
        : `Found ${result.items.length} KB document${result.items.length === 1 ? "" : "s"}.`,
    data: result,
  };
}
