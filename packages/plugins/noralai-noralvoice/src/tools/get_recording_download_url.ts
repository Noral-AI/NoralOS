/**
 * `noralvoice:get_recording_download_url` tool handler.
 *
 * Phase 9C — Tier 2 read tool (worker tier).
 * Returns a short-lived download URL for a specific recording.
 */

import {
  type NoralVoiceClientConfig,
  getRecordingDownloadUrl,
} from "../noralvoice-client.js";

export interface GetRecordingDownloadUrlParams {
  recordingId: number;
}

export interface GetRecordingDownloadUrlResult {
  content: string;
  data: { url: string; expires_in: number; expiresAt?: string };
}

export async function executeGetRecordingDownloadUrl(
  config: NoralVoiceClientConfig,
  params: GetRecordingDownloadUrlParams,
): Promise<GetRecordingDownloadUrlResult> {
  const result = await getRecordingDownloadUrl(config, params.recordingId);
  return {
    content: `Download URL ready for recording ${params.recordingId}.`,
    data: {
      url: result.url,
      // NoralVoice doesn't return a numeric expires_in today; surface a
      // sensible default (3600s = 1 hour) so callers have a usable value.
      expires_in: 3600,
      expiresAt: result.expiresAt,
    },
  };
}
