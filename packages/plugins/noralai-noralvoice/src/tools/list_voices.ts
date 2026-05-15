/**
 * `noralvoice:list_voices` tool handler.
 *
 * Returns the voice catalog from NoralVoice's
 * `GET /api/v1/configurations/voices/{provider}` endpoint. When the
 * caller doesn't specify a provider, fans out across the six providers
 * NoralVoice supports today (elevenlabs / deepgram / sarvam / cartesia
 * / dograh / rime) and concatenates the results.
 *
 * Tier: worker (read-only).
 */

import {
  type NoralVoiceClientConfig,
  type NoralVoiceTTSProvider,
  type NoralVoiceVoice,
  NORALVOICE_TTS_PROVIDERS,
  listVoicesAcrossProviders,
  listVoicesForProvider,
} from "../noralvoice-client.js";

export interface ListVoicesParams {
  provider?: NoralVoiceTTSProvider;
}

export interface ListVoicesResult {
  content: string;
  data: { voices: NoralVoiceVoice[]; providers: NoralVoiceTTSProvider[] };
}

export async function executeListVoices(
  config: NoralVoiceClientConfig,
  params: ListVoicesParams,
): Promise<ListVoicesResult> {
  let voices: NoralVoiceVoice[];
  let providers: NoralVoiceTTSProvider[];
  if (params.provider) {
    providers = [params.provider];
    voices = await listVoicesForProvider(config, params.provider);
  } else {
    providers = [...NORALVOICE_TTS_PROVIDERS];
    voices = await listVoicesAcrossProviders(config);
  }
  return {
    content:
      voices.length === 0
        ? `No voices returned for ${providers.join(", ")}.`
        : `Found ${voices.length} voice${voices.length === 1 ? "" : "s"} across ${providers.length} provider${providers.length === 1 ? "" : "s"}.`,
    data: { voices, providers },
  };
}
