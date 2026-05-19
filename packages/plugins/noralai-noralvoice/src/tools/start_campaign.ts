/**
 * `noralvoice:start_campaign` tool handler.
 *
 * Phase 9C — Tier 1 write tool (manager tier).
 * Starts a previously created campaign.
 */

import {
  type CreateCampaignResult,
  type NoralVoiceClientConfig,
  startCampaign,
} from "../noralvoice-client.js";

export interface StartCampaignParams {
  campaignId: number;
}

export interface StartCampaignResult {
  content: string;
  data: CreateCampaignResult;
}

export async function executeStartCampaign(
  config: NoralVoiceClientConfig,
  params: StartCampaignParams,
): Promise<StartCampaignResult> {
  const result = await startCampaign(config, params.campaignId);
  return {
    content: `Campaign id=${result.id} ("${result.name}") started — status=${result.status}.`,
    data: result,
  };
}
