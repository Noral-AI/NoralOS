/**
 * `noralvoice:redial_campaign` tool handler.
 *
 * Phase 9D — Tier 3 write tool (manager tier).
 * Creates a new redial campaign from an existing one, retrying contacts
 * based on their outcome (voicemail, no-answer, busy).
 */

import {
  type CreateCampaignResult,
  type NoralVoiceClientConfig,
  type RedialCampaignParams,
  redialCampaign,
} from "../noralvoice-client.js";

export interface RedialCampaignToolParams {
  campaignId: number;
  name?: string;
  retryOnVoicemail?: boolean;
  retryOnNoAnswer?: boolean;
  retryOnBusy?: boolean;
}

export interface RedialCampaignResult {
  content: string;
  data: CreateCampaignResult;
}

export async function executeRedialCampaign(
  config: NoralVoiceClientConfig,
  params: RedialCampaignToolParams,
): Promise<RedialCampaignResult> {
  const clientParams: RedialCampaignParams = {
    campaignId: params.campaignId,
    name: params.name,
    retryOnVoicemail: params.retryOnVoicemail,
    retryOnNoAnswer: params.retryOnNoAnswer,
    retryOnBusy: params.retryOnBusy,
  };
  const result = await redialCampaign(config, clientParams);
  return {
    content: `Redial campaign id=${result.id} ("${result.name}") created from campaign ${params.campaignId} — status=${result.status}.`,
    data: result,
  };
}
