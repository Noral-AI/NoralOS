/**
 * `noralvoice:get_campaign` tool handler.
 *
 * Phase 7 — promoted from board apiRoute. Read-only, worker tier.
 */

import {
  type CampaignSummary,
  type NoralVoiceClientConfig,
  getCampaign,
} from "../noralvoice-client.js";

export interface GetCampaignParams {
  campaignId: number;
}

export interface GetCampaignResult {
  content: string;
  data: CampaignSummary & { progress?: Record<string, unknown> | null };
}

export async function executeGetCampaign(
  config: NoralVoiceClientConfig,
  params: GetCampaignParams,
): Promise<GetCampaignResult> {
  const campaign = await getCampaign(config, params.campaignId);
  return {
    content: `Campaign ${campaign.id}: status=${campaign.status}, workflow=${campaign.workflowId}.`,
    data: campaign,
  };
}
