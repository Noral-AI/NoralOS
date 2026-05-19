/**
 * `noralvoice:get_run_detail` tool handler.
 *
 * Phase 9C — Tier 2 read tool (worker tier).
 * Returns the full run record for a given run id, including transcript,
 * recording, gathered context, and cost info.
 */

import {
  type NoralVoiceClientConfig,
  type RunDetail,
  getRunDetail,
} from "../noralvoice-client.js";

export interface GetRunDetailParams {
  runId: string;
}

export interface GetRunDetailResult {
  content: string;
  data: RunDetail;
}

export async function executeGetRunDetail(
  config: NoralVoiceClientConfig,
  params: GetRunDetailParams,
): Promise<GetRunDetailResult> {
  const run = await getRunDetail(config, params.runId);
  return {
    content: `Run ${run.id}: state=${run.state}, workflow=${run.workflowUuid ?? run.workflowId ?? "unknown"}.`,
    data: run,
  };
}
