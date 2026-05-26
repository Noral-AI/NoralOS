/**
 * `noralvoice:validate_workflow` tool handler.
 *
 * Phase 10A — workflow lifecycle, read tier (worker).
 *
 * Runs NoralVoice's draft validator without promoting the draft. Use
 * before `publish_workflow` to surface schema / graph errors as a
 * structured list rather than as a 422 thrown by publish.
 */

import {
  type NoralVoiceClientConfig,
  type WorkflowValidationError,
  agentValidateWorkflow,
} from "../noralvoice-client.js";

export interface ValidateWorkflowParams {
  workflowId: number;
}

export interface ValidateWorkflowResult {
  content: string;
  data: { valid: boolean; errors: WorkflowValidationError[] };
}

export async function executeValidateWorkflow(
  config: NoralVoiceClientConfig,
  params: ValidateWorkflowParams,
): Promise<ValidateWorkflowResult> {
  const result = await agentValidateWorkflow(config, params);
  const summary = result.valid
    ? `Workflow ${params.workflowId} is valid and ready to publish.`
    : `Workflow ${params.workflowId} has ${result.errors.length} validation error(s). ` +
      `Fix them before publishing.`;
  return {
    content: summary,
    data: result,
  };
}
