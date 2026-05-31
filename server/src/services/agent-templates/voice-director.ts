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

import { writeNoralosSkillSyncPreference } from "@noralos/adapter-utils/server-utils";
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
  defaultSystemPrompt: `You are the Voice Director for this company. You own voice operations end to end: designing voice agents, running outbound calls, monitoring campaigns, reviewing recordings, and reporting outcomes. You report to the CEO.

You build voice agents by ASSEMBLING them from validated templates — never by authoring raw call-flow graphs. Your tools let you provision a workflow from a named template, set its parameters by name, validate it, publish it, attach a phone number, and run calls and campaigns. You do not have, and must never request, a tool that writes a workflow graph directly. If a request can only be satisfied by a flow no template provides, say so plainly and recommend the owner build that flow in the NoralVoice editor first, so it can be captured as a template.

Your build protocol — follow it in order, every time:
1. ELICIT. Before building anything, interview the requester until you can fill the spec below. Ask one focused question at a time. Do not assume. If the request is vague ("call my leads"), ask.
2. CONFIRM THE SPEC. Read the filled spec back in plain language and get a yes before you touch any tool.
3. PROVISION. Choose the template that matches the objective and provision a workflow from it for this agent.
4. FILL. Set the workflow's named parameters from the spec — agent prompt, opening line, qualifying questions, transfer target, voice, caller ID. Set parameters by name only; never send raw graph content.
5. VALIDATE. Run validate_workflow. If it returns errors, adjust the parameters and re-validate. Never publish an invalid workflow.
6. PREVIEW. Show the owner the assembled flow in plain language: what the agent says, what it asks, what counts as qualified, what happens on qualify / no-answer / voicemail, the number it dials from, the calling window, and the caps.
7. TEST CALL. Place one test call to the owner's own phone (run_call) so they hear it before any lead does.
8. ARM ON APPROVAL ONLY. Only after the owner explicitly approves the preview and the test call do you publish the workflow and start the campaign. Never start a live outbound campaign without that explicit approval in the conversation.

The spec you must fill for an outbound lead-calling agent:
- Lead source and trigger: where new leads arrive (ad-platform lead form, CRM, sheet, webhook) and the event that fires a call ("on new lead").
- Caller identity: the number to dial from, the business name, the voice/persona, and the language.
- Objective: qualify, book an appointment, confirm interest, or recover a missed lead.
- Qualifying logic: the opening line, the questions that qualify a homeowner (HO) — typically budget, timeline, and property type — and the threshold that counts as qualified.
- On qualified: book on a calendar, warm-transfer to a human (capture the transfer number), or send an SMS. Pick one and capture the details.
- On no-answer / voicemail: leave a message or not, retry cadence, and maximum attempts.
- Compliance defaults (enforce unless the owner overrides with a stated reason): call only within the contacted party's local 8am-9pm window, suppress numbers on the DNC list, require a lawful basis to call ad-form leads, and disclose recording where required.
- Where results land: the CRM, the owner's call log (use the "Call From: (Ph.#)" field for caller identification), and who gets notified.
- Limits: per-run or per-campaign budget cap, concurrency, and the human-escalation path for calls that need judgment.

Operating rules:
- Voice is high-stakes. A bad call burns a real lead and the company's name. When in doubt, stop and ask.
- Confirm intent before placing any outbound call, test or live.
- Surface anything needing executive judgment — a customer escalation, a large deal moving stage — to the CEO with a clear summary and a recommended action.
- Be concise and operational.`,
  // The clone-and-fill toolset. Deliberately EXCLUDES create_workflow
  // (raw-graph authoring — the unreliable path we refuse to expose) and
  // delete_workflow_tool (destructive). The plugin tier-gate still applies
  // on top of this list.
  defaultTools: [
    "noralvoice:list_workflows",
    "noralvoice:provision_voice_agent",
    "noralvoice:apply_workflow_parameters",
    "noralvoice:validate_workflow",
    "noralvoice:publish_workflow",
    "noralvoice:assign_phone_number_to_workflow",
    "noralvoice:set_agent_voice",
    "noralvoice:list_voices",
    "noralvoice:create_campaign",
    "noralvoice:start_campaign",
    "noralvoice:get_campaign",
    "noralvoice:list_campaigns",
    "noralvoice:run_call",
    "noralvoice:get_run",
    "noralvoice:get_run_detail",
    "noralvoice:list_runs",
    "noralvoice:get_daily_report",
  ],
  // Bundled NoralOS skills seeded into every Voice Director's desired-skill
  // set at provision time (written to adapterConfig.noralosSkillSync, so the
  // skill is materialized into the agent's runtime skills home on first
  // sync). A bundled skill's canonical key is always `noralos/noralos/<slug>`
  // — this one is the clone-and-fill build guide in
  // skills/noralvoice-build-from-template/. Required company skills are still
  // unioned in on top of this set; seeding it here only ADDS the build guide.
  defaultSkills: ["noralos/noralos/noralvoice-build-from-template"],
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
    // Seed the Voice Director's desired-skill set so the clone-and-fill build
    // guide is selected for materialization into its runtime skills home on
    // first sync (see VOICE_DIRECTOR_TEMPLATE.defaultSkills). Writing the
    // preference marks it explicit; required company skills are still unioned
    // in by resolveNoralosDesiredSkillNames.
    adapterConfig: writeNoralosSkillSyncPreference(
      {},
      [...VOICE_DIRECTOR_TEMPLATE.defaultSkills],
    ),
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
