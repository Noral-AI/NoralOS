/**
 * `noralvoice:resume_campaign` tool handler.
 *
 * Phase 9D — Tier 3 write tool (manager tier).
 * Resumes a paused campaign.
 */

import {
  type CreateCampaignResult,
  type NoralVoiceClientConfig,
  resumeCampaign,
} from "../noralvoice-client.js";

export interface ResumeCampaignParams {
  campaignId: number;
}

export interface ResumeCampaignResult {
  content: string;
  data: CreateCampaignResult;
}

export async function executeResumeCampaign(
  config: NoralVoiceClientConfig,
  params: ResumeCampaignParams,
): Promise<ResumeCampaignResult> {
  const result = await resumeCampaign(config, params.campaignId);
  return {
    content: `Campaign id=${result.id} ("${result.name}") resumed — status=${result.status}.`,
    data: result,
  };
}
