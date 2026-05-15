/**
 * `noralvoice:list_workflows` tool handler.
 *
 * Pure function over a `NoralVoiceClientConfig` and parsed params.
 * Returns a structured `ToolResult`-compatible shape. Worker glue
 * (tier gate, secret resolution, error normalisation) lives in
 * `worker.ts`.
 */

import {
  type NoralVoiceClientConfig,
  type WorkflowSummary,
  listWorkflows,
} from "../noralvoice-client.js";

export interface ListWorkflowsParams {
  limit?: number;
}

export interface ListWorkflowsResult {
  content: string;
  data: { workflows: WorkflowSummary[] };
}

export async function executeListWorkflows(
  config: NoralVoiceClientConfig,
  params: ListWorkflowsParams,
): Promise<ListWorkflowsResult> {
  const workflows = await listWorkflows(config, { limit: params.limit });
  return {
    content:
      workflows.length === 0
        ? "No voice workflows found in this NoralVoice organization."
        : `Found ${workflows.length} voice workflow${workflows.length === 1 ? "" : "s"}.`,
    data: { workflows },
  };
}
