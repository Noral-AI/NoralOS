/**
 * `noralvoice:list_runs` tool handler.
 *
 * Phase 7 — promoted from the board-callable apiRoute of the same name.
 * Read-only, worker tier. Takes workflowUuid (agents work with uuids,
 * not numeric ids), resolves to numeric workflow id, then pages runs.
 */

import {
  type NoralVoiceClientConfig,
  type RunListItem,
  getWorkflowByUuid,
  listWorkflowRuns,
} from "../noralvoice-client.js";

export interface ListRunsParams {
  workflowUuid: string;
  limit?: number;
  cursor?: string | null;
}

export interface ListRunsResult {
  content: string;
  data: { runs: RunListItem[]; nextCursor: string | null };
}

export async function executeListRuns(
  config: NoralVoiceClientConfig,
  params: ListRunsParams,
): Promise<ListRunsResult> {
  const wf = await getWorkflowByUuid(config, params.workflowUuid);
  if (!wf) {
    return {
      content: `Workflow ${params.workflowUuid} not found in NoralVoice.`,
      data: { runs: [], nextCursor: null },
    };
  }
  const page = await listWorkflowRuns(config, wf.id, {
    limit: params.limit,
    cursor: params.cursor ?? null,
  });
  return {
    content:
      page.items.length === 0
        ? `No runs yet for workflow ${params.workflowUuid}.`
        : `Found ${page.items.length} run${page.items.length === 1 ? "" : "s"} for workflow ${params.workflowUuid}.`,
    data: { runs: page.items, nextCursor: page.nextCursor ?? null },
  };
}
