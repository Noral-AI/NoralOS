/**
 * Backfill cost_events.cost_cents from the linked heartbeat_runs.result_json.
 *
 * Context: prior to the fix in heartbeat.ts:normalizeBilledCostCents,
 * runs authed via Claude subscription/OAuth (no ANTHROPIC_API_KEY) were
 * stamped with billingType="subscription_included" and had their
 * cost_cents forced to 0, even though the underlying Claude CLI reported
 * a real total_cost_usd. This script restores those amounts so the
 * Month Spend tile and Costs page reflect actual API-equivalent usage.
 *
 * Idempotent: only updates rows where cost_cents = 0 AND a non-null
 * costUsd is present on the linked heartbeat run, so re-running is safe
 * and won't overwrite already-correct rows.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-cost-events-cents.ts            # all companies
 *   pnpm tsx scripts/backfill-cost-events-cents.ts --company <uuid>
 *   pnpm tsx scripts/backfill-cost-events-cents.ts --dry-run  # report only
 */
import { createDb } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";

function parseFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const config = loadConfig();
  const dbUrl =
    process.env.DATABASE_URL?.trim()
    || config.databaseUrl
    || `postgres://noralos:paperclip@127.0.0.1:${config.embeddedPostgresPort}/noralos`;

  const db = createDb(dbUrl);
  const dryRun = hasFlag("--dry-run");
  const companyFilter = parseFlag("--company");

  // Use db.session.client.unsafe (or equivalent) — the createDb wrapper
  // exposes a postgres-js client. We invoke parameterized queries via
  // the underlying sql tag through a tiny helper.
  // drizzle's db.execute accepts a SQL template; we use sql template
  // literals from postgres-js via the connection on the drizzle wrapper.
  const conn = (db as unknown as { $client: (strings: TemplateStringsArray, ...vals: unknown[]) => Promise<Array<Record<string, unknown>>> }).$client;
  if (typeof conn !== "function") {
    throw new Error("createDb wrapper did not expose a postgres-js client at $client. Update this script if the wrapper shape changed.");
  }

  // Discovery query: how many rows would we update, and total recovered?
  const summaryRows = await conn`
    SELECT
      ce.company_id::text   AS company_id,
      ce.agent_id::text     AS agent_id,
      count(*)::int         AS row_count,
      sum(
        GREATEST(
          0,
          round(
            (
              coalesce(
                hr.result_json -> 'costUsd',
                hr.result_json -> 'cost_usd',
                hr.result_json -> 'total_cost_usd'
              )
            )::float8 * 100
          )::int
        )
      )::bigint              AS recovered_cents
    FROM cost_events ce
    JOIN heartbeat_runs hr ON hr.id = ce.heartbeat_run_id
    WHERE ce.cost_cents = 0
      AND coalesce(
            hr.result_json -> 'costUsd',
            hr.result_json -> 'cost_usd',
            hr.result_json -> 'total_cost_usd'
          ) IS NOT NULL
      ${companyFilter ? conn`AND ce.company_id = ${companyFilter}::uuid` : conn``}
    GROUP BY ce.company_id, ce.agent_id
  ` as Array<{ company_id: string; agent_id: string; row_count: number; recovered_cents: number | string }>;

  const totalRows = summaryRows.reduce((sum, r) => sum + Number(r.row_count), 0);
  const totalCentsRecovered = summaryRows.reduce((sum, r) => sum + Number(r.recovered_cents), 0);
  const affectedCompanies = new Set(summaryRows.map((r) => r.company_id));
  const affectedAgents = new Set(summaryRows.map((r) => r.agent_id));

  if (totalRows === 0) {
    console.log("No backfillable cost_event rows found.");
    return;
  }

  console.log(`Backfill candidates: ${totalRows} cost_events`);
  console.log(`  Recovered total: $${(totalCentsRecovered / 100).toFixed(2)} (${totalCentsRecovered} cents)`);
  console.log(`  Across ${affectedCompanies.size} compan${affectedCompanies.size === 1 ? "y" : "ies"} and ${affectedAgents.size} agent(s)`);

  if (dryRun) {
    console.log("Dry run: no rows updated.");
    return;
  }

  // One-shot UPDATE using the same join logic.
  await conn`
    UPDATE cost_events ce
    SET cost_cents = GREATEST(
      0,
      round(
        (
          coalesce(
            hr.result_json -> 'costUsd',
            hr.result_json -> 'cost_usd',
            hr.result_json -> 'total_cost_usd'
          )
        )::float8 * 100
      )::int
    )
    FROM heartbeat_runs hr
    WHERE hr.id = ce.heartbeat_run_id
      AND ce.cost_cents = 0
      AND coalesce(
            hr.result_json -> 'costUsd',
            hr.result_json -> 'cost_usd',
            hr.result_json -> 'total_cost_usd'
          ) IS NOT NULL
      ${companyFilter ? conn`AND ce.company_id = ${companyFilter}::uuid` : conn``}
  `;

  // Recompute denormalized monthly totals for the current UTC month so
  // the dashboard's downstream reads (companies.spent_monthly_cents,
  // agents.spent_monthly_cents) match the corrected ledger. The current
  // UTC month bound is computed in SQL so a long-running script doesn't
  // race with date_trunc differences.
  await conn`
    UPDATE companies c
    SET spent_monthly_cents = COALESCE(t.total, 0),
        updated_at = now()
    FROM (
      SELECT company_id, sum(cost_cents)::int AS total
      FROM cost_events
      WHERE occurred_at >= date_trunc('month', (now() at time zone 'UTC'))
        AND occurred_at <  date_trunc('month', (now() at time zone 'UTC')) + interval '1 month'
      GROUP BY company_id
    ) t
    WHERE c.id = t.company_id
      ${companyFilter ? conn`AND c.id = ${companyFilter}::uuid` : conn``}
  `;

  await conn`
    UPDATE agents a
    SET spent_monthly_cents = COALESCE(t.total, 0),
        updated_at = now()
    FROM (
      SELECT agent_id, sum(cost_cents)::int AS total
      FROM cost_events
      WHERE occurred_at >= date_trunc('month', (now() at time zone 'UTC'))
        AND occurred_at <  date_trunc('month', (now() at time zone 'UTC')) + interval '1 month'
      GROUP BY agent_id
    ) t
    WHERE a.id = t.agent_id
      ${companyFilter ? conn`AND a.company_id = ${companyFilter}::uuid` : conn``}
  `;

  console.log(`Backfill complete. Updated ${totalRows} cost_event rows; recomputed monthly totals for ${affectedCompanies.size} compan${affectedCompanies.size === 1 ? "y" : "ies"} and ${affectedAgents.size} agent(s).`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Cost-events backfill failed: ${message}`);
  process.exitCode = 1;
});
