/**
 * `noralvoice:add_workflow_tool` tool handler.
 *
 * Phase 9C — Tier 1 write tool (manager tier).
 * Registers a new function-tool in NoralVoice (a callable tool
 * available inside workflow Agent nodes).
 */

import {
  type NoralVoiceClientConfig,
  type WorkflowToolRecord,
  addWorkflowTool,
} from "../noralvoice-client.js";

export interface AddWorkflowToolParams {
  name: string;
  description: string;
  toolDefinition: Record<string, unknown>;
}

export interface AddWorkflowToolResult {
  content: string;
  data: WorkflowToolRecord;
}

export async function executeAddWorkflowTool(
  config: NoralVoiceClientConfig,
  params: AddWorkflowToolParams,
): Promise<AddWorkflowToolResult> {
  const result = await addWorkflowTool(config, params);
  return {
    content: `Registered workflow tool "${result.name}" (uuid=${result.tool_uuid}).`,
    data: result,
  };
}
