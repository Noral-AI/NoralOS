/**
 * Backward-compat write path to the voice-config plugin's table.
 *
 * voice-config (`noralos.voice-config`) owns the legacy
 * `agent_voice_config` row that voice-cascade + Conference Room read at
 * runtime. Phase 3 makes NoralVoice the source of truth for new writes
 * but keeps voice-config alive as a reader until Phase 6 retires it —
 * so every successful `set_agent_voice` mirrors the change into
 * voice-config's table so legacy readers don't go stale.
 *
 * The mirror is best-effort: voice-config might be uninstalled in a
 * given environment, the row might already be locked, or a column may
 * have drifted. None of those should fail the upstream NoralVoice
 * write — the worker logs and continues.
 *
 * Provider mapping caveat: voice-config's `provider` CHECK constraint
 * admits only `('elevenlabs', 'google_tts', 'default')` per its
 * `001_voice_config.sql`. NoralVoice has six providers. The mapping:
 *
 *   - elevenlabs → "elevenlabs"
 *   - everything else  → "default" (we don't pretend it's google_tts).
 *
 * voice-config's CHECK constraint may need to expand in Phase 6's
 * migration if we want to round-trip provider names cleanly. Until
 * then the legacy reader treats anything non-elevenlabs as "default",
 * which voice-cascade resolves through its own provider routing.
 */

import type { NoralVoiceTTSProvider } from "./noralvoice-client.js";

// Hardcoded per `packages/plugins/voice-config/src/constants.ts` —
// re-deriving via crypto.subtle each call would be wasted work since
// the slug + plugin id are immutable.
export const VOICE_CONFIG_SCHEMA = "plugin_voiceconfig_d9257ba961";
export const VOICE_CONFIG_TABLE = "agent_voice_config";

export type VoiceConfigProvider = "elevenlabs" | "google_tts" | "default";

export function mapNoralVoiceToLegacyProvider(provider: NoralVoiceTTSProvider): VoiceConfigProvider {
  return provider === "elevenlabs" ? "elevenlabs" : "default";
}

export interface MirrorWriteInput {
  companyId: string;
  agentId: string;
  provider: NoralVoiceTTSProvider;
  voiceId: string;
}

/**
 * Execute the mirror write. Caller provides a `query` function that
 * runs parameterised SQL — the plugin SDK exposes per-company DB
 * access through `ctx.host.queryHostDb` (or equivalent); concrete
 * binding lives in worker.ts so this module stays SDK-free.
 *
 * The SQL is an UPSERT keyed by (company_id, agent_id) so the mirror
 * is idempotent: a row that already exists gets its provider/voice_id
 * updated + `migrated_to_noralvoice_at` stamped; a row that doesn't
 * exist is inserted with sensible defaults for the surface flags.
 */
export async function mirrorToVoiceConfig(
  query: (sql: string, params: unknown[]) => Promise<unknown>,
  input: MirrorWriteInput,
): Promise<{ mirrored: boolean }> {
  const legacyProvider = mapNoralVoiceToLegacyProvider(input.provider);
  // Defaults align with voice-config's `company_voice_defaults` shipped
  // defaults (true for dashboard + conference room + tts replies). The
  // operator can override these via voice-config's own UI; we just
  // ensure the row exists so legacy readers don't fail-closed.
  const sql = `
    INSERT INTO ${VOICE_CONFIG_SCHEMA}.${VOICE_CONFIG_TABLE} (
      company_id,
      agent_id,
      voice_enabled,
      provider,
      voice_id,
      dashboard_voice_enabled,
      conference_room_enabled,
      slack_voice_enabled,
      phone_voice_enabled,
      tts_replies_enabled,
      updated_by_kind,
      migrated_to_noralvoice_at
    ) VALUES (
      $1::uuid, $2::uuid, true, $3, $4,
      true, true, false, false, true,
      'plugin',
      now()
    )
    ON CONFLICT (company_id, agent_id) DO UPDATE SET
      provider = EXCLUDED.provider,
      voice_id = EXCLUDED.voice_id,
      updated_by_kind = 'plugin',
      migrated_to_noralvoice_at = now(),
      updated_at = now()
  `;
  try {
    await query(sql, [input.companyId, input.agentId, legacyProvider, input.voiceId]);
    return { mirrored: true };
  } catch {
    // Caller logs; the upstream write to NoralVoice has already landed.
    return { mirrored: false };
  }
}
