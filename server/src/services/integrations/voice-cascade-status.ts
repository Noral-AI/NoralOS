/**
 * Read the *actual* runtime status of the `voice-cascade` plugin so the
 * Settings → Integrations Assignments tab can display the real `ttsMode`
 * rather than a hard-coded label.
 *
 * Returns `installed: false` if the plugin isn't installed; otherwise
 * returns the current `ttsMode` enum value (or `null` if the field has
 * not been configured yet).
 *
 * This endpoint deliberately does NOT return secret refs — those are
 * already exposed through the assignments list. It only surfaces
 * non-sensitive operational state (`ttsMode`).
 */
import { eq } from "drizzle-orm";
import type { Db } from "@noralos/db";
import { pluginConfig, plugins } from "@noralos/db";

export type VoiceCascadeMode = "live" | "dry_run" | null;

export interface VoiceCascadeStatus {
  pluginKey: "voice-cascade";
  installed: boolean;
  ttsMode: VoiceCascadeMode;
}

const VOICE_CASCADE_PLUGIN_KEY = "voice-cascade";

function asMode(raw: unknown): VoiceCascadeMode {
  if (raw === "live" || raw === "dry_run") return raw;
  return null;
}

export function voiceCascadeStatusService(db: Db) {
  async function get(): Promise<VoiceCascadeStatus> {
    const plugin = await db
      .select({ id: plugins.id })
      .from(plugins)
      .where(eq(plugins.pluginKey, VOICE_CASCADE_PLUGIN_KEY))
      .then((rows) => rows[0] ?? null);

    if (!plugin) {
      return { pluginKey: VOICE_CASCADE_PLUGIN_KEY, installed: false, ttsMode: null };
    }

    const config = await db
      .select({ configJson: pluginConfig.configJson })
      .from(pluginConfig)
      .where(eq(pluginConfig.pluginId, plugin.id))
      .then((rows) => rows[0] ?? null);

    const configJson = (config?.configJson as Record<string, unknown> | null) ?? {};
    return {
      pluginKey: VOICE_CASCADE_PLUGIN_KEY,
      installed: true,
      ttsMode: asMode(configJson.ttsMode),
    };
  }

  return { get };
}
