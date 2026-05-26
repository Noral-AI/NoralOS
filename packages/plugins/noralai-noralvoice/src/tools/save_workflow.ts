/**
 * `noralvoice:save_workflow` tool handler.
 *
 * Phase 9C — Tier 1 write tool (manager tier).
 * Updates an existing voice workflow's definition and/or name.
 */

import {
  type NoralVoiceClientConfig,
  agentSaveWorkflow,
} from "../noralvoice-client.js";

export interface SaveWorkflowParams {
  workflowId: number;
  name?: string;
  workflowDefinition: Record<string, unknown>;
}

export interface SaveWorkflowResult {
  content: string;
  data: { id: number; workflow_uuid: string; name: string; status?: string };
}

export async function executeSaveWorkflow(
  config: NoralVoiceClientConfig,
  params: SaveWorkflowParams,
): Promise<SaveWorkflowResult> {
  const result = await agentSaveWorkflow(config, params);
  return {
    content: `Saved workflow id=${result.id} ("${result.name}").`,
    data: result,
  };
}
