/**
 * One-shot migration: push every voice-config row that has a voice_id
 * up to NoralVoice via the `noralvoice:set_agent_voice` tool chain.
 *
 * Run manually after Phase 3 deploys with:
 *
 *   pnpm --filter @noralos/server exec tsx ../scripts/migrate-voice-config-to-noralvoice.ts [--apply]
 *
 * Without `--apply` the script does a dry run and prints the planned
 * actions per row. With `--apply` it actually invokes the SDK.
 *
 * Idempotent: rows where `migrated_to_noralvoice_at IS NOT NULL` are
 * skipped on every run. Reruns safely after partial failures.
 *
 * Boundaries:
 *   - Skips companies that have no NoralVoice integration configured
 *     (the plugin_config row is missing or apiKeyRef can't be
 *     resolved). Those agents continue to read voice-config until
 *     their company onboards NoralVoice.
 *   - Skips rows where `provider = 'google_tts'` — NoralVoice doesn't
 *     have a google_tts equivalent in its TTS catalog today
 *     (elevenlabs/deepgram/sarvam/cartesia/dograh/rime only). Operators
 *     can re-pick a voice via the new VoiceSettingsTab.
 *   - Skips rows where `provider = 'default'` — there's no concrete
 *     provider to write through. Same remediation.
 *   - Stamps `migrated_to_noralvoice_at = now()` only on full success
 *     (workflow provisioned if needed + voice pushed to NoralVoice).
 *     A failure during the NV call leaves the row unmarked so the
 *     next run retries.
 *
 * Outcome categories logged + summarised at the end:
 *   - migrated      — full success
 *   - skipped       — explicit skip (no_nv_integration | provider_unsupported | no_voice_id)
 *   - failed        — provision or push to NV errored; details on stderr
 *
 * The script does NOT touch voice-config's surface-flag columns
 * (dashboard/conference_room/slack/phone) or tier/visibility overrides
 * — those stay in voice-config until Phase 6 retires the plugin.
 */

import { eq, sql } from "drizzle-orm";

import { agents, companies, createDb } from "@noralos/db";

import { pluginRegistryService } from "../src/services/plugin-registry.js";
import { secretService } from "../src/services/secrets.js";

const PLUGIN_ID = "noralai.noralvoice";

// NoralVoice's six TTS providers. voice-config writes can use any of:
// 'elevenlabs', 'google_tts', 'default'. Only 'elevenlabs' maps cleanly;
// the other two are skipped.
const SUPPORTED_NORALVOICE_PROVIDERS = new Set([
  "elevenlabs",
  "deepgram",
  "sarvam",
  "cartesia",
  "dograh",
  "rime",
]);

interface VoiceConfigRow {
  company_id: string;
  agent_id: string;
  provider: string;
  voice_id: string;
  voice_enabled: boolean;
}

interface PluginInstanceConfig {
  baseUrl?: unknown;
  apiKeyRef?: unknown;
  organizationId?: unknown;
}

interface NoralVoiceCreds {
  baseUrl: string;
  apiKey: string;
}

async function resolveNoralVoiceCreds(
  registry: ReturnType<typeof pluginRegistryService>,
  secrets: ReturnType<typeof secretService>,
  companyId: string,
): Promise<NoralVoiceCreds | { skip: "no_nv_integration"; reason: string }> {
  const instance = await registry.getInstanceConfig(companyId, PLUGIN_ID);
  if (!instance) return { skip: "no_nv_integration", reason: "plugin instance missing" };
  const cfg = (instance.configJson ?? {}) as PluginInstanceConfig;
  const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl.replace(/\/+$/, "") : "";
  const apiKeyRef = typeof cfg.apiKeyRef === "string" ? cfg.apiKeyRef : "";
  if (!baseUrl || !apiKeyRef) {
    return { skip: "no_nv_integration", reason: "baseUrl or apiKeyRef missing" };
  }
  try {
    const apiKey = await secrets.resolveRef(companyId, apiKeyRef);
    if (!apiKey) return { skip: "no_nv_integration", reason: "apiKey empty" };
    return { baseUrl, apiKey };
  } catch (err) {
    return {
      skip: "no_nv_integration",
      reason: `apiKey resolve failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

async function nvRequest<T>(
  creds: NoralVoiceCreds,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; detail: string }> {
  const headers: Record<string, string> = {
    "X-API-Key": creds.apiKey,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(`${creds.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (resp.status >= 200 && resp.status < 300) {
      const data = (await resp.json().catch(() => ({}))) as T;
      return { ok: true, data };
    }
    let detail = "";
    try {
      const body = (await resp.json()) as { detail?: string };
      detail = body.detail ?? "";
    } catch {
      // ignore
    }
    return { ok: false, status: resp.status, detail };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      detail: err instanceof Error ? err.message : "transport error",
    };
  } finally {
    clearTimeout(timer);
  }
}

interface Counters {
  migrated: number;
  skipped: number;
  failed: number;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const db = createDb(dbUrl);
  const registry = pluginRegistryService(db);
  const secrets = secretService(db);

  console.log(
    `voice-config -> noralvoice migration (${apply ? "APPLY" : "dry-run"})...`,
  );

  // Read all voice-config rows that have a non-empty voice_id and
  // haven't been migrated yet. Cross-schema query: voice-config lives
  // under its own plugin schema.
  const rows = (await db.execute(
    sql`SELECT company_id::text AS company_id, agent_id::text AS agent_id, provider, voice_id, voice_enabled
        FROM plugin_voiceconfig_d9257ba961.agent_voice_config
        WHERE voice_id IS NOT NULL AND voice_id <> ''
          AND migrated_to_noralvoice_at IS NULL`,
  )) as unknown as { rows: VoiceConfigRow[] };

  const counters: Counters = { migrated: 0, skipped: 0, failed: 0 };
  const credsByCompany = new Map<string, NoralVoiceCreds | "skip">();

  for (const row of rows.rows) {
    const tag = `[company=${row.company_id} agent=${row.agent_id}]`;

    // Skip unsupported providers up front.
    if (!SUPPORTED_NORALVOICE_PROVIDERS.has(row.provider)) {
      counters.skipped++;
      console.log(`${tag} SKIP provider_unsupported (${row.provider})`);
      continue;
    }

    // Resolve company → NoralVoice creds, cached per company.
    let creds = credsByCompany.get(row.company_id);
    if (creds === undefined) {
      const resolved = await resolveNoralVoiceCreds(registry, secrets, row.company_id);
      if ("skip" in resolved) {
        credsByCompany.set(row.company_id, "skip");
        console.log(`${tag} SKIP no_nv_integration (${resolved.reason})`);
        counters.skipped++;
        continue;
      }
      creds = resolved;
      credsByCompany.set(row.company_id, creds);
    }
    if (creds === "skip") {
      counters.skipped++;
      console.log(`${tag} SKIP no_nv_integration (cached)`);
      continue;
    }

    // Check the agent's current voice_agent_uuid; provision if null.
    const agentRow = await db
      .select({ name: agents.name, voiceAgentUuid: agents.voiceAgentUuid })
      .from(agents)
      .where(eq(agents.id, row.agent_id))
      .then((r) => r[0]);
    if (!agentRow) {
      counters.skipped++;
      console.log(`${tag} SKIP agent_not_found`);
      continue;
    }

    let voiceAgentUuid = agentRow.voiceAgentUuid ?? null;
    if (!voiceAgentUuid) {
      if (!apply) {
        console.log(
          `${tag} DRY would provision voice_agent + set ${row.provider}/${row.voice_id}`,
        );
        counters.migrated++;
        continue;
      }
      const result = await nvRequest<{ workflow_uuid: string; name: string }>(
        creds,
        "POST",
        "/api/v1/workflow/create/definition",
        {
          name: `${agentRow.name} voice`,
          workflow_definition: {
            nodes: [
              {
                id: "agent-1",
                type: "agentNode",
                position: { x: 0, y: 0 },
                data: {
                  name: "Conversation",
                  prompt:
                    "You are a helpful voice assistant. Greet the caller and ask how you can help.",
                },
              },
            ],
            edges: [],
          },
        },
      );
      if (!result.ok) {
        counters.failed++;
        console.error(
          `${tag} FAIL provision (status=${result.status} detail=${result.detail})`,
        );
        continue;
      }
      voiceAgentUuid = String(result.data.workflow_uuid ?? "");
      if (!voiceAgentUuid) {
        counters.failed++;
        console.error(`${tag} FAIL provision (no workflow_uuid in response)`);
        continue;
      }
      await db
        .update(agents)
        .set({ voiceAgentUuid, updatedAt: new Date() })
        .where(eq(agents.id, row.agent_id));
      console.log(`${tag} provisioned voice_agent_uuid=${voiceAgentUuid}`);
    }

    if (!apply) {
      console.log(
        `${tag} DRY would set ${row.provider}/${row.voice_id} on voice_agent_uuid=${voiceAgentUuid}`,
      );
      counters.migrated++;
      continue;
    }

    // Read-then-write NoralVoice settings: fetch the workflow to get
    // its numeric id + existing workflow_configurations, merge in the
    // TTS block, PUT the result back.
    const list = await nvRequest<unknown>(creds, "GET", "/api/v1/workflow/");
    if (!list.ok) {
      counters.failed++;
      console.error(`${tag} FAIL list (status=${list.status} detail=${list.detail})`);
      continue;
    }
    const arr = Array.isArray(list.data) ? (list.data as Record<string, unknown>[]) : [];
    const match = arr.find((r) => r.workflow_uuid === voiceAgentUuid);
    if (!match) {
      counters.failed++;
      console.error(`${tag} FAIL workflow ${voiceAgentUuid} not found in NV`);
      continue;
    }
    const workflowId = Number(match.id ?? 0);
    if (!workflowId) {
      counters.failed++;
      console.error(`${tag} FAIL workflow id missing from list response`);
      continue;
    }
    const detail = await nvRequest<Record<string, unknown>>(
      creds,
      "GET",
      `/api/v1/workflow/${workflowId}`,
    );
    if (!detail.ok) {
      counters.failed++;
      console.error(
        `${tag} FAIL get-detail (status=${detail.status} detail=${detail.detail})`,
      );
      continue;
    }
    const existingConfigs =
      detail.data.workflow_configurations && typeof detail.data.workflow_configurations === "object"
        ? (detail.data.workflow_configurations as Record<string, unknown>)
        : {};
    const existingOverrides =
      (existingConfigs.model_overrides as Record<string, unknown>) ?? {};
    const nextConfigs = {
      ...existingConfigs,
      model_overrides: {
        ...existingOverrides,
        tts: { provider: row.provider, voice: row.voice_id },
      },
    };
    const put = await nvRequest<unknown>(
      creds,
      "PUT",
      `/api/v1/workflow/${workflowId}`,
      { workflow_configurations: nextConfigs },
    );
    if (!put.ok) {
      counters.failed++;
      console.error(`${tag} FAIL put (status=${put.status} detail=${put.detail})`);
      continue;
    }

    // Stamp migrated_to_noralvoice_at — the voice-config row stays as
    // a legacy read source but is now marked migrated.
    await db.execute(sql`
      UPDATE plugin_voiceconfig_d9257ba961.agent_voice_config
      SET migrated_to_noralvoice_at = now(), updated_at = now()
      WHERE company_id = ${row.company_id}::uuid AND agent_id = ${row.agent_id}::uuid
    `);

    counters.migrated++;
    console.log(
      `${tag} MIGRATED provider=${row.provider} voice=${row.voice_id} voice_agent_uuid=${voiceAgentUuid}`,
    );
  }

  console.log("\n=== migration summary ===");
  console.log(`migrated: ${counters.migrated}`);
  console.log(`skipped:  ${counters.skipped}`);
  console.log(`failed:   ${counters.failed}`);
  if (!apply) {
    console.log("\n(dry run — no changes written. Re-run with --apply to commit.)");
  }
}

main().catch((err) => {
  console.error("migration crashed:", err);
  process.exit(1);
});
