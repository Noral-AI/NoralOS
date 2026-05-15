/**
 * Voice Director agent template.
 *
 * Phase 1B: the canonical manager-tier agent that owns voice operations
 * for a company. Brooklyn (CEO) stays uplevel — Voice Director picks up
 * the actual `noralvoice:*` tool calls.
 *
 * The provisioner creates an agent row in `agents` from the template,
 * resolves `reportsTo` to the company's CEO if one exists (otherwise
 * `null`, surfaced as a soft warning to the caller), and attaches the
 * default `noralvoice:*` tools. Returns the new agent's id so the plugin
 * page can link straight to it.
 *
 * Multiplicity: a company may have N Voice Directors (Outbound Sales VD,
 * Inbound Support VD, Compliance Calls VD …) — the provisioner accepts
 * `overrides.name` so the second-and-onwards instance can carry a
 * differentiating name. The default name is "Voice Director".
 */

import { eq } from "drizzle-orm";

import { agents as agentsTable, type Db } from "@noralos/db";

import { agentService } from "../agents.js";

export const VOICE_DIRECTOR_TEMPLATE = {
  id: "voice-director",
  displayName: "Voice Director",
  description:
    "Owns voice operations for the company. Designs, runs, and monitors voice agents — the canonical caller of the noralvoice:* tool surface.",
  defaultName: "Voice Director",
  defaultRole: "manager",
  defaultReportsTo: "ceo", // resolved at provision time to the company's CEO agent (if any)
  defaultAdapterType: "<inherit-company-default>",
  defaultSystemPrompt: `You are the Voice Director for this company. You own all voice operations: designing voice agents, running outbound calls, monitoring campaigns, reviewing recordings, and reporting outcomes to the CEO.

You have access to the noralvoice:* tool set. Use list_workflows to inventory the company's voice agents, run_call to place outbound calls, and get_run to review outcomes.

You report to the CEO. When an outcome requires executive judgment (a customer escalation, a large deal moving stage), surface it to the CEO with a clear summary and recommended action.

Be concise. Be operational. Voice is high-stakes — confirm intent before placing any outbound call.`,
  defaultTools: [
    "noralvoice:list_workflows",
    "noralvoice:run_call",
    "noralvoice:get_run",
  ],
} as const;

export type VoiceDirectorOverrides = {
  name?: string;
  systemPrompt?: string;
  adapterType?: string;
  reportsTo?: string | null;
};

export interface VoiceDirectorProvisionOutcome {
  agentId: string;
  name: string;
  reportsTo: string | null;
  reportsToWarning?: string;
}

/**
 * Resolve the company's CEO agent id, or null if there isn't one.
 * The Voice Director template defaults `defaultReportsTo: "ceo"` —
 * this is the lookup that turns that role string into an id.
 */
async function findCeoAgentId(db: Db, companyId: string): Promise<string | null> {
  const ceoRow = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.companyId, companyId))
    .then((rows) => rows.find((r): r is { id: string } => Boolean(r.id)));
  // The query above doesn't filter by role yet — replace with a real
  // role=ceo predicate. Drizzle's `and()` typing is awkward to compose
  // inline so we filter in JS for clarity; agent counts per company are
  // small (≤ low double digits).
  if (!ceoRow) return null;
  const rows = await db
    .select({ id: agentsTable.id, role: agentsTable.role, status: agentsTable.status })
    .from(agentsTable)
    .where(eq(agentsTable.companyId, companyId));
  const ceo = rows.find((r) => r.role === "ceo" && r.status !== "terminated");
  return ceo?.id ?? null;
}

/**
 * Create a Voice Director agent in the given company.
 *
 * Returns the new agent's id + name + the resolved `reportsTo`. When the
 * company has no CEO agent yet, `reportsTo` is `null` and we attach a
 * `reportsToWarning` string so the plugin page can surface a soft hint
 * ("This Voice Director has no manager — create a CEO agent to set up
 * the reporting chain").
 */
export async function provisionVoiceDirector(
  db: Db,
  companyId: string,
  overrides: VoiceDirectorOverrides = {},
): Promise<VoiceDirectorProvisionOutcome> {
  const service = agentService(db);
  const ceoId = await findCeoAgentId(db, companyId);
  const reportsTo = overrides.reportsTo !== undefined ? overrides.reportsTo : ceoId;

  const created = await service.create(companyId, {
    name: overrides.name ?? VOICE_DIRECTOR_TEMPLATE.defaultName,
    role: VOICE_DIRECTOR_TEMPLATE.defaultRole,
    title: "Voice Director",
    reportsTo: reportsTo ?? null,
    capabilities: VOICE_DIRECTOR_TEMPLATE.defaultTools.join(","),
    adapterType:
      overrides.adapterType ?? VOICE_DIRECTOR_TEMPLATE.defaultAdapterType,
    adapterConfig: {},
    runtimeConfig: {
      systemPrompt: overrides.systemPrompt ?? VOICE_DIRECTOR_TEMPLATE.defaultSystemPrompt,
      tools: VOICE_DIRECTOR_TEMPLATE.defaultTools,
      template: VOICE_DIRECTOR_TEMPLATE.id,
    },
    defaultEnvironmentId: null,
    budgetMonthlyCents: 0,
    metadata: {
      provisionedFromTemplate: VOICE_DIRECTOR_TEMPLATE.id,
      provisionedAt: new Date().toISOString(),
    },
  });

  const outcome: VoiceDirectorProvisionOutcome = {
    agentId: created.id,
    name: created.name,
    reportsTo: created.reportsTo ?? null,
  };
  if (created.reportsTo == null) {
    outcome.reportsToWarning =
      "No CEO agent found in this company — Voice Director was created without a manager. " +
      "Create a CEO agent (or pass `reportsTo` explicitly) to set up the reporting chain.";
  }
  return outcome;
}
