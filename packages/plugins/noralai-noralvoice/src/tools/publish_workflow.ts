/**
 * `noralvoice:publish_workflow` tool handler.
 *
 * Phase 10A — workflow lifecycle, write tier (manager).
 *
 * Promotes the current draft of a workflow to a published version that
 * the runtime will execute. Closes the agent-authoring loop:
 *
 *   create_workflow → save_workflow → validate_workflow → publish_workflow
 *                                                        └── executable
 *
 * NoralVoice re-runs the full DTO + graph + trigger-conflict checks on
 * publish; a draft that passes `validate_workflow` should pass publish
 * (race conditions on overlapping trigger paths are the one exception).
 */

import {
  type NoralVoiceClientConfig,
  agentPublishWorkflow,
} from "../noralvoice-client.js";

export interface PublishWorkflowParams {
  workflowId: number;
}

export interface PublishWorkflowResult {
  content: string;
  data: {
    id: number;
    version_number: number;
    status: string;
    published_at: string | null;
  };
}

export async function executePublishWorkflow(
  config: NoralVoiceClientConfig,
  params: PublishWorkflowParams,
): Promise<PublishWorkflowResult> {
  const result = await agentPublishWorkflow(config, params);
  return {
    content:
      `Published workflow ${params.workflowId} as version ${result.version_number} ` +
      `(status=${result.status}). Runtime will now execute this version.`,
    data: result,
  };
}
