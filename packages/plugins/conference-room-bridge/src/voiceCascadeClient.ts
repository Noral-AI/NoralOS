// Helper for calling voice-cascade's /synthesize endpoint.
// Same fetch rationale as voiceConfigClient: in-process RPC, plain fetch.

import type { SynthesisResult } from "./types.js";
import { VOICE_CASCADE_API_BASE } from "./constants.js";

export interface VoiceCascadeClientError extends Error {
  code: "unreachable" | "non-2xx" | "parse-error";
  status?: number;
}

function makeError(
  code: VoiceCascadeClientError["code"],
  message: string,
  status?: number,
): VoiceCascadeClientError {
  const err = new Error(message) as VoiceCascadeClientError;
  err.code = code;
  err.status = status;
  return err;
}

export async function callSynthesize(opts: {
  baseUrl: string;
  agentToken: string;
  companyId: string;
  agentId: string;
  text: string;
}): Promise<SynthesisResult> {
  const url = `${opts.baseUrl}${VOICE_CASCADE_API_BASE}/synthesize?companyId=${encodeURIComponent(opts.companyId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.agentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: opts.agentId,
        text: opts.text,
        surface: "conference_room",
      }),
    });
  } catch (err) {
    throw makeError(
      "unreachable",
      `voice-cascade fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw makeError(
      "non-2xx",
      `voice-cascade returned HTTP ${res.status}: ${body.slice(0, 200)}`,
      res.status,
    );
  }
  try {
    return (await res.json()) as SynthesisResult;
  } catch (err) {
    throw makeError(
      "parse-error",
      `voice-cascade response parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
