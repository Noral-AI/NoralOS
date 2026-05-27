/**
 * `noralvoice:set_agent_voice` tool handler.
 *
 * Pushes a new TTS provider+voice into a NoralVoice workflow's settings.
 * Phase 6 PR-4b: the voice-config mirror write was removed — there's no
 * legacy reader to keep in sync. NoralVoice is the sole source of truth
 * for picker state; agents.surface_flags (PR-4a) is the source of truth
 * for surface visibility.
 *
 * The handler is split into two side-effect islands so the worker can
 * wire them with the right context:
 *
 *   1. `resolveVoiceAgentUuid(agentId)` — read agents.voice_agent_uuid.
 *      Returns `{ uuid }` or `{ error: NO_VOICE_AGENT }`.
 *   2. `setWorkflowVoiceSettings(config, uuid, ...)` — PUT to NoralVoice
 *      (delegated to the SDK wrapper in noralvoice-client.ts).
 *
 * Tier: manager.
 */

import {
  type NoralVoiceClientConfig,
  type NoralVoiceTTSProvider,
  setWorkflowVoiceSettings,
} from "../noralvoice-client.js";

export interface SetAgentVoiceParams {
  noralosAgentId: string;
  provider: NoralVoiceTTSProvider;
  voiceId: string;
  voiceOptions?: Record<string, unknown>;
}

export type SetAgentVoiceResult =
  | {
      ok: true;
      content: string;
      data: {
        voice_agent_uuid: string;
        provider: NoralVoiceTTSProvider;
        voiceId: string;
      };
    }
  | {
      ok: false;
      error: "NO_VOICE_AGENT";
      message: string;
    };

export interface SetAgentVoiceContext {
  /** Resolve the agent's linked NoralVoice workflow uuid (or null). */
  resolveVoiceAgentUuid: (agentId: string) => Promise<string | null>;
  /** Companion CompanyId derived by the worker from the run-context. */
  companyId: string;
}

export async function executeSetAgentVoice(
  config: NoralVoiceClientConfig,
  params: SetAgentVoiceParams,
  ctx: SetAgentVoiceContext,
): Promise<SetAgentVoiceResult> {
  const uuid = await ctx.resolveVoiceAgentUuid(params.noralosAgentId);
  if (!uuid) {
    return {
      ok: false,
      error: "NO_VOICE_AGENT",
      message:
        "Agent has no linked voice agent. Call provision_voice_agent first to create one.",
    };
  }
  // Push to NoralVoice. Surface NV errors to the caller via the
  // NoralVoiceClientError bubble — the worker normalises them.
  await setWorkflowVoiceSettings(config, uuid, {
    provider: params.provider,
    voiceId: params.voiceId,
    voiceOptions: params.voiceOptions,
  });
  return {
    ok: true,
    content: `Set NoralVoice agent ${uuid} to ${params.provider} / ${params.voiceId}.`,
    data: {
      voice_agent_uuid: uuid,
      provider: params.provider,
      voiceId: params.voiceId,
    },
  };
}
