// Helper for calling voice-config's effective-config endpoint.
// Uses native global fetch (not ctx.http.fetch) because the SDK's outbound
// HTTP enforces a public-IP allowlist that blocks localhost — this is
// in-process plugin-to-plugin RPC, not external traffic.
//
// The SDK explicitly permits standard fetch for cases like this.

import type { EffectiveOrFailClosed } from "./types.js";
import { VOICE_CONFIG_API_BASE } from "./constants.js";

export interface VoiceConfigClientError extends Error {
  code: "unreachable" | "non-2xx" | "parse-error" | "missing-token";
  status?: number;
}

function makeError(
  code: VoiceConfigClientError["code"],
  message: string,
  status?: number,
): VoiceConfigClientError {
  const err = new Error(message) as VoiceConfigClientError;
  err.code = code;
  err.status = status;
  return err;
}

export async function fetchEffectiveConfig(opts: {
  baseUrl: string;
  agentToken: string;
  companyId: string;
  agentId: string;
}): Promise<EffectiveOrFailClosed> {
  const url = `${opts.baseUrl}${VOICE_CONFIG_API_BASE}/agents/${encodeURIComponent(opts.agentId)}/effective-config?companyId=${encodeURIComponent(opts.companyId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.agentToken}` },
    });
  } catch (err) {
    throw makeError(
      "unreachable",
      `voice-config fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw makeError(
      "non-2xx",
      `voice-config returned HTTP ${res.status}: ${body.slice(0, 200)}`,
      res.status,
    );
  }
  try {
    return (await res.json()) as EffectiveOrFailClosed;
  } catch (err) {
    throw makeError(
      "parse-error",
      `voice-config response parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
