/**
 * `noralvoice:update_workflow_tool` tool handler.
 *
 * Phase 9C — Tier 1 write tool (manager tier).
 * Updates an existing workflow function-tool's name, description, or definition.
 */

import {
  type NoralVoiceClientConfig,
  type WorkflowToolRecord,
  updateWorkflowTool,
} from "../noralvoice-client.js";

export interface UpdateWorkflowToolParams {
  toolUuid: string;
  name?: string;
  description?: string;
  toolDefinition?: Record<string, unknown>;
}

export interface UpdateWorkflowToolResult {
  content: string;
  data: WorkflowToolRecord;
}

export async function executeUpdateWorkflowTool(
  config: NoralVoiceClientConfig,
  params: UpdateWorkflowToolParams,
): Promise<UpdateWorkflowToolResult> {
  const result = await updateWorkflowTool(config, params);
  return {
    content: `Updated workflow tool "${result.name}" (uuid=${result.tool_uuid}).`,
    data: result,
  };
}
