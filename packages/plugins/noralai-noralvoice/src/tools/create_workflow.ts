/**
 * `noralvoice:create_workflow` tool handler.
 *
 * Phase 9C — Tier 1 write tool (manager tier).
 * Creates a new voice workflow definition in NoralVoice.
 */

import {
  type NoralVoiceClientConfig,
  agentCreateWorkflow,
} from "../noralvoice-client.js";

export interface CreateWorkflowParams {
  name: string;
  workflowDefinition?: Record<string, unknown>;
}

export interface CreateWorkflowResult {
  content: string;
  data: { id: number; workflow_uuid: string; name: string };
}

export async function executeCreateWorkflow(
  config: NoralVoiceClientConfig,
  params: CreateWorkflowParams,
): Promise<CreateWorkflowResult> {
  const result = await agentCreateWorkflow(config, params);
  return {
    content: `Created workflow "${result.name}" (id=${result.id}, uuid=${result.workflow_uuid}).`,
    data: result,
  };
}
