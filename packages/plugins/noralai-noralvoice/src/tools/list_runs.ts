/**
 * `noralvoice:list_runs` tool handler.
 *
 * Read-only, worker tier. Lists the organization's recent voice runs
 * (most recent first) via NoralVoice's org-scoped usage history. Runs are
 * NOT scoped to a single workflow here: after dialing an agent-trigger, the
 * agent holds a run id / trigger path, not a numeric workflow id — so a
 * workflow-scoped list would resolve to nothing. `cursor` pages forward.
 */

import {
  type NoralVoiceClientConfig,
  type RunListItem,
  listOrgRuns,
} from "../noralvoice-client.js";

export interface ListRunsParams {
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
  const page = await listOrgRuns(config, {
    limit: params.limit,
    cursor: params.cursor ?? null,
  });
  return {
    content:
      page.items.length === 0
        ? "No voice runs found for this organization yet."
        : `Found ${page.items.length} recent run${page.items.length === 1 ? "" : "s"}.`,
    data: { runs: page.items, nextCursor: page.nextCursor ?? null },
  };
}
