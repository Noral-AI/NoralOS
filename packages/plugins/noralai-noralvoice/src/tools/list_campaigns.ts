/**
 * `noralvoice:list_campaigns` tool handler.
 *
 * Phase 7 — promoted from board apiRoute. Read-only, worker tier.
 */

import {
  type CampaignSummary,
  type NoralVoiceClientConfig,
  type PagedResult,
  listCampaigns,
} from "../noralvoice-client.js";

export interface ListCampaignsParams {
  status?: string;
  limit?: number;
}

export interface ListCampaignsResult {
  content: string;
  data: PagedResult<CampaignSummary>;
}

export async function executeListCampaigns(
  config: NoralVoiceClientConfig,
  params: ListCampaignsParams,
): Promise<ListCampaignsResult> {
  const page = await listCampaigns(config, params);
  return {
    content:
      page.items.length === 0
        ? "No NoralVoice campaigns found for this organization."
        : `Found ${page.items.length} campaign${page.items.length === 1 ? "" : "s"}.`,
    data: page,
  };
}
