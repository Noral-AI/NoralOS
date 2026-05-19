/**
 * `noralvoice:delete_workflow_tool` tool handler.
 *
 * Phase 9C — Tier 1 write tool (manager tier).
 * Archives (soft-deletes) a workflow function-tool.
 */

import {
  type NoralVoiceClientConfig,
  deleteWorkflowTool,
} from "../noralvoice-client.js";

export interface DeleteWorkflowToolParams {
  toolUuid: string;
}

export interface DeleteWorkflowToolResult {
  content: string;
  data: { status: "archived"; tool_uuid: string };
}

export async function executeDeleteWorkflowTool(
  config: NoralVoiceClientConfig,
  params: DeleteWorkflowToolParams,
): Promise<DeleteWorkflowToolResult> {
  const result = await deleteWorkflowTool(config, params.toolUuid);
  return {
    content: `Workflow tool ${result.tool_uuid} archived.`,
    data: result,
  };
}
