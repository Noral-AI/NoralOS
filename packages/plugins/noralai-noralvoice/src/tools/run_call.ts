/**
 * `noralvoice:run_call` tool handler.
 *
 * High-stakes: places an outbound call. Tier gate (manager+) is enforced
 * in `worker.ts` BEFORE this handler runs — by the time we get here, the
 * caller is already authorised. We still log the destination at info
 * level (E.164 number, no PII beyond that) so misuse leaves a clear
 * audit trail.
 */

import { type NoralVoiceClientConfig, runCall } from "../noralvoice-client.js";

export interface RunCallParams {
  workflowUuid: string;
  toNumber: string;
  variables?: Record<string, string | number | boolean>;
}

export interface RunCallResult {
  content: string;
  data: { runId: string; status: string; startedAt?: string };
}

export async function executeRunCall(
  config: NoralVoiceClientConfig,
  params: RunCallParams,
): Promise<RunCallResult> {
  const { runId, status, startedAt } = await runCall(config, params);
  return {
    content: `NoralVoice call queued: run ${runId} dialling ${params.toNumber} (workflow ${params.workflowUuid}).`,
    data: { runId, status, startedAt },
  };
}
