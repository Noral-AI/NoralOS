/**
 * `noralvoice:set_agent_voice` tool handler.
 *
 * Pushes a new TTS provider+voice into a NoralVoice workflow's settings
 * and mirrors the change to voice-config (legacy reader) so
 * voice-cascade / Conference Room don't go stale between this phase and
 * Phase 6.
 *
 * The handler is split into three side-effect islands so the worker can
 * wire them with the right context:
 *
 *   1. `resolveVoiceAgentUuid(agentId)` — read agents.voice_agent_uuid.
 *      Returns `{ uuid }` or `{ error: NO_VOICE_AGENT }`.
 *   2. `setWorkflowVoiceSettings(config, uuid, ...)` — PUT to NoralVoice
 *      (delegated to the SDK wrapper in noralvoice-client.ts).
 *   3. `mirrorToVoiceConfig(companyId, agentId, provider, voiceId)` —
 *      best-effort write to voice-config + stamp
 *      migrated_to_noralvoice_at. Failures here log but don't fail
 *      the tool — NoralVoice is the source of truth and a stale legacy
 *      reader is preferable to a phantom rollback.
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
        mirrored: boolean;
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
  /** Best-effort mirror write to voice-config + stamp migrated_to_noralvoice_at. */
  mirrorToVoiceConfig: (args: {
    companyId: string;
    agentId: string;
    provider: NoralVoiceTTSProvider;
    voiceId: string;
  }) => Promise<{ mirrored: boolean }>;
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
  // Best-effort mirror; never throw. The companyId comes from the
  // tool run-context, not from the params, so a misbehaving caller
  // can't write to another company's voice-config row.
  let mirrored = false;
  try {
    const result = await ctx.mirrorToVoiceConfig({
      companyId: ctx.companyId,
      agentId: params.noralosAgentId,
      provider: params.provider,
      voiceId: params.voiceId,
    });
    mirrored = result.mirrored;
  } catch {
    mirrored = false;
  }
  return {
    ok: true,
    content: `Set NoralVoice agent ${uuid} to ${params.provider} / ${params.voiceId}${mirrored ? " (mirrored to voice-config)" : ""}.`,
    data: {
      voice_agent_uuid: uuid,
      provider: params.provider,
      voiceId: params.voiceId,
      mirrored,
    },
  };
}
