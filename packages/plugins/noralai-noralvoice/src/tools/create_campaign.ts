/**
 * `noralvoice:create_campaign` tool handler.
 *
 * Phase 9C — Tier 1 write tool (manager tier).
 * Creates a new outbound dialing campaign.
 */

import {
  type CreateCampaignResult,
  type NoralVoiceClientConfig,
  createCampaign,
} from "../noralvoice-client.js";

export interface CreateCampaignParams {
  name: string;
  workflowId: number;
  sourceType: "google-sheet" | "csv";
  sourceId: string;
  telephonyConfigurationId?: number;
  maxConcurrency?: number;
}

export interface CreateCampaignToolResult {
  content: string;
  data: CreateCampaignResult;
}

export async function executeCreateCampaign(
  config: NoralVoiceClientConfig,
  params: CreateCampaignParams,
): Promise<CreateCampaignToolResult> {
  const result = await createCampaign(config, params);
  return {
    content: `Created campaign "${result.name}" (id=${result.id}, status=${result.status}).`,
    data: result,
  };
}
