/**
 * `noralvoice:pause_campaign` tool handler.
 *
 * Phase 9D — Tier 3 write tool (manager tier).
 * Pauses a running campaign.
 */

import {
  type CreateCampaignResult,
  type NoralVoiceClientConfig,
  pauseCampaign,
} from "../noralvoice-client.js";

export interface PauseCampaignParams {
  campaignId: number;
}

export interface PauseCampaignResult {
  content: string;
  data: CreateCampaignResult;
}

export async function executePauseCampaign(
  config: NoralVoiceClientConfig,
  params: PauseCampaignParams,
): Promise<PauseCampaignResult> {
  const result = await pauseCampaign(config, params.campaignId);
  return {
    content: `Campaign id=${result.id} ("${result.name}") paused — status=${result.status}.`,
    data: result,
  };
}
