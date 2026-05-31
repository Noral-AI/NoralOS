/**
 * Backfill: seed the NoralVoice clone-and-fill build guide onto EXISTING
 * Voice Director agents.
 *
 * Newly-provisioned Voice Directors get the template's default skills written
 * into `adapterConfig.noralosSkillSync` at creation time (see
 * `provisionVoiceDirector`). Voice Directors provisioned BEFORE that change
 * have a skill-less preference, so this one-off backfill unions the default
 * skills into each existing Voice Director's desired-skill set.
 *
 * - Identifies Voice Directors by `runtime_config->>'template' = 'voice-director'`
 *   (falls back to `metadata->>'provisionedFromTemplate'`).
 * - Idempotent: an agent that already has every default skill is skipped, so
 *   re-running is safe.
 * - Preserves any skills the operator already chose (it unions, never
 *   replaces). Required company skills are unaffected — they're unioned in at
 *   resolve time by `resolveNoralosDesiredSkillNames`.
 * - Skips terminated agents.
 *
 * Usage — dry run first (prints what would change, persists nothing):
 *
 *   DATABASE_URL=postgres://… pnpm run voice-director:backfill-skills
 *
 * …then persist with --apply (use the direct invocation to avoid pnpm's
 * argument-forwarding ambiguity):
 *
 *   DATABASE_URL=postgres://… pnpm --filter @noralos/server exec \
 *     tsx ../scripts/backfill-voice-director-skills.ts --apply
 *
 * Run this AFTER the skill ships: the bundled skill must exist in the catalog
 * (it's discovered from ./skills/) for the seeded key to materialize — i.e.
 * after the next image build + deploy. DATABASE_URL must point at the target
 * database; without it the script falls back to the local embedded Postgres.
 */

import { createDb } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";

// Keep in sync with VOICE_DIRECTOR_TEMPLATE in
// server/src/services/agent-templates/voice-director.ts. Hardcoded (rather
// than imported) so this standalone backfill depends only on createDb +
// loadConfig and never pulls the agent-service module graph. A bundled
// NoralOS skill's canonical key is always `noralos/noralos/<slug>`.
const VOICE_DIRECTOR_TEMPLATE_ID = "voice-director";
const DEFAULT_SKILLS = ["noralos/noralos/noralvoice-build-from-template"];

type SqlClient = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Mirror of read/writeNoralosSkillSyncPreference
// (packages/adapter-utils/src/server-utils.ts). Inlined so this script's only
// cross-package imports are the proven-resolvable createDb + loadConfig. The
// preference shape (adapterConfig.noralosSkillSync.desiredSkills: string[]) is
// stable — it's persisted on every agent row.
function readDesiredSkills(adapterConfig: Record<string, unknown>): string[] {
  const raw = asRecord(adapterConfig.noralosSkillSync).desiredSkills;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function writeDesiredSkills(
  adapterConfig: Record<string, unknown>,
  desired: string[],
): Record<string, unknown> {
  return {
    ...adapterConfig,
    noralosSkillSync: {
      ...asRecord(adapterConfig.noralosSkillSync),
      desiredSkills: Array.from(new Set(desired.map((s) => s.trim()).filter(Boolean))),
    },
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const config = loadConfig();
  const dbUrl =
    process.env.DATABASE_URL?.trim()
    || config.databaseUrl
    || `postgres://noralos:paperclip@127.0.0.1:${config.embeddedPostgresPort}/noralos`;

  const db = createDb(dbUrl);
  const conn = (db as unknown as { $client: SqlClient }).$client;
  if (typeof conn !== "function") {
    throw new Error(
      "createDb wrapper did not expose a postgres-js client at $client. Update this script if the wrapper shape changed.",
    );
  }

  const rows = (await conn`
    SELECT id::text AS id, name, adapter_config
    FROM agents
    WHERE status <> 'terminated'
      AND (
        runtime_config->>'template' = ${VOICE_DIRECTOR_TEMPLATE_ID}
        OR metadata->>'provisionedFromTemplate' = ${VOICE_DIRECTOR_TEMPLATE_ID}
      )
    ORDER BY name
  `) as Array<{ id: string; name: string | null; adapter_config: unknown }>;

  let changed = 0;
  for (const row of rows) {
    const adapterConfig = asRecord(row.adapter_config);
    const current = readDesiredSkills(adapterConfig);
    const missing = DEFAULT_SKILLS.filter((key) => !current.includes(key));
    if (missing.length === 0) continue;

    changed += 1;
    console.log(
      `${apply ? "Updated" : "Would update"} ${row.name ?? "(unnamed)"} (${row.id}): +${missing.join(", ")}`,
    );

    if (apply) {
      const next = writeDesiredSkills(adapterConfig, [...current, ...missing]);
      await conn`
        UPDATE agents
        SET adapter_config = ${JSON.stringify(next)}::jsonb,
            updated_at = now()
        WHERE id = ${row.id}::uuid
      `;
    }
  }

  console.log(
    `${apply ? "Backfill complete" : "Dry run"} — ${rows.length} Voice Director(s) scanned, ${changed} ${
      apply ? "updated" : "would be updated"
    }.`,
  );
  if (!apply && changed > 0) {
    console.log("Re-run with --apply to persist.");
  }
}

void main().catch((error) => {
  console.error(
    `Voice Director skill backfill failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
