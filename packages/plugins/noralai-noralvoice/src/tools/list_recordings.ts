/**
 * `noralvoice:list_recordings` tool handler.
 *
 * Phase 9C — Tier 2 read tool (worker tier).
 * Lists TTS recordings, optionally filtered by workflow.
 */

import {
  type NoralVoiceClientConfig,
  type PagedResult,
  type RecordingListItem,
  listRecordings,
} from "../noralvoice-client.js";

export interface ListRecordingsParams {
  workflowId?: number;
  limit?: number;
}

export interface ListRecordingsResult {
  content: string;
  data: PagedResult<RecordingListItem>;
}

export async function executeListRecordings(
  config: NoralVoiceClientConfig,
  params: ListRecordingsParams,
): Promise<ListRecordingsResult> {
  const result = await listRecordings(config, {
    workflowId: params.workflowId,
    limit: params.limit,
  });
  return {
    content:
      result.items.length === 0
        ? "No recordings found."
        : `Found ${result.items.length} recording${result.items.length === 1 ? "" : "s"}.`,
    data: result,
  };
}
