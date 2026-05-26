/**
 * `noralvoice:get_run` tool handler.
 *
 * Read-only — admits any tier (worker, manager, exec). Returns the full
 * Phase-1B RunSummary shape: status, transcript URL, recording URL,
 * extracted variables, and cost info.
 */

import { type NoralVoiceClientConfig, getRun, type RunSummary } from "../noralvoice-client.js";

export interface GetRunParams {
  runId: string;
}

export interface GetRunResult {
  content: string;
  data: { run: RunSummary };
}

export async function executeGetRun(
  config: NoralVoiceClientConfig,
  params: GetRunParams,
): Promise<GetRunResult> {
  const run = await getRun(config, params.runId);
  return {
    content: `Run ${run.runId} status: ${run.status}${run.transcriptUrl ? "; transcript ready" : ""}.`,
    data: { run },
  };
}
