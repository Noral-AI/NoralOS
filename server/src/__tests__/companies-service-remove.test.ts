/**
 * `companyService.remove()` cascade test.
 *
 * Why this test exists: the cascade in `services/companies.ts` is a
 * hand-maintained list of `tx.delete()` calls against every table whose
 * `companyId` FK to `companies.id` does NOT declare `onDelete: "cascade"`
 * AND whose parent cascade chain doesn't terminate at a table we
 * already delete. When a new table with a `companyId` FK lands in the
 * schema, that list has to grow — and the failure mode is silent at
 * commit time and noisy at the admin UI ("Internal server error" on
 * delete). This test seeds rows in every newly-handled table (PR
 * `fix/admin-delete-company`) and asserts they are gone afterwards, so
 * a future contributor who removes one of those `tx.delete()` calls is
 * blocked by red CI rather than a surprised operator.
 *
 * Scope:
 *   - Seven tables exercised explicitly: budgetPolicies, budgetIncidents,
 *     inboxDismissals, feedbackVotes, issueInboxArchives,
 *     issueThreadInteractions, workspaceRuntimeServices.
 *   - Plus the foundational tables they depend on: companies, agents,
 *     issues (with a parent project + heartbeat run so FK chains aren't
 *     synthetic).
 *   - The existing cascade tables (issues / projects / agents / runs /
 *     etc.) are already covered by `cleanup-removal-service.test.ts`
 *     and the route guard test; we deliberately don't re-test those.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  budgetIncidents,
  budgetPolicies,
  companies,
  costEvents,
  createDb,
  feedbackVotes,
  goals,
  heartbeatRuns,
  inboxDismissals,
  issueInboxArchives,
  issueThreadInteractions,
  issues,
  projects,
  routines,
  workspaceOperations,
  workspaceRuntimeServices,
} from "@noralos/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyService } from "../services/companies.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  // eslint-disable-next-line no-console
  console.warn(
    `Skipping company remove cascade test on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("companyService.remove() — cascade", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-remove-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    // Belt-and-braces: cascade should have cleaned everything, but a
    // failing test could leak rows that block the next iteration.
    await db.delete(workspaceRuntimeServices);
    await db.delete(workspaceOperations);
    await db.delete(routines);
    await db.delete(issueThreadInteractions);
    await db.delete(issueInboxArchives);
    await db.delete(feedbackVotes);
    await db.delete(inboxDismissals);
    await db.delete(budgetIncidents);
    await db.delete(budgetPolicies);
    await db.delete(costEvents);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyWithCascadeBlockingRows() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const policyId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Cascade Fixture Co",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Cascade Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Cascade fixture issue",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      createdByUserId: "user-1",
    });

    // budget_policies has only a companyId FK; budget_incidents references
    // it (no cascade) and also references approvals (no cascade) — both
    // must be cleaned before companies.
    await db.insert(budgetPolicies).values({
      id: policyId,
      companyId,
      scopeType: "agent",
      scopeId: agentId,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 10_000,
    });

    await db.insert(budgetIncidents).values({
      id: randomUUID(),
      companyId,
      policyId,
      scopeType: "agent",
      scopeId: agentId,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      windowStart: new Date("2026-05-01T00:00:00Z"),
      windowEnd: new Date("2026-06-01T00:00:00Z"),
      thresholdType: "hard_stop",
      amountLimit: 10_000,
      amountObserved: 15_000,
    });

    await db.insert(inboxDismissals).values({
      id: randomUUID(),
      companyId,
      userId: "user-1",
      itemKey: "fixture-item",
    });

    await db.insert(feedbackVotes).values({
      id: randomUUID(),
      companyId,
      issueId,
      targetType: "issue",
      targetId: issueId,
      authorUserId: "user-1",
      vote: "up",
    });

    await db.insert(issueInboxArchives).values({
      id: randomUUID(),
      companyId,
      issueId,
      userId: "user-1",
    });

    await db.insert(issueThreadInteractions).values({
      id: randomUUID(),
      companyId,
      issueId,
      kind: "question",
      payload: { kind: "question", body: "fixture" } as unknown as Record<string, unknown>,
    });

    await db.insert(workspaceRuntimeServices).values({
      id: randomUUID(),
      companyId,
      scopeType: "agent",
      serviceName: "fixture-service",
      status: "stopped",
      lifecycle: "ephemeral",
      provider: "local",
    });

    // workspace_operations has its `executionWorkspaceId` and
    // `heartbeatRunId` FKs declared with `onDelete: "set null"`, so it
    // does not auto-clean from the projects or heartbeatRuns cascade
    // chains. Seeding a row here proves the explicit delete in
    // `services/companies.ts` is correct.
    await db.insert(workspaceOperations).values({
      id: randomUUID(),
      companyId,
      phase: "checkout",
    });

    // routines.assigneeAgentId references agents.id WITHOUT
    // `onDelete`, so any routine that points at an agent in this
    // company will block the agents delete unless routines is
    // explicitly dropped first. The seed-with-assignee here proves
    // the explicit `tx.delete(routines)` is in place — without it,
    // the agents delete in the service raises a Postgres FK
    // constraint error and the test fails.
    await db.insert(routines).values({
      id: randomUUID(),
      companyId,
      title: "Fixture routine",
      assigneeAgentId: agentId,
    });

    // costEvents.heartbeatRunId references heartbeatRuns.id WITHOUT
    // `onDelete`. The agents.noral.ai TBRS delete kept failing on
    // this exact constraint until the cascade was reordered to drop
    // costEvents before heartbeatRuns. Seeding a heartbeat run plus
    // a cost event pointing at it reproduces the real-world block
    // and locks the new ordering in place.
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "completed",
    });
    await db.insert(costEvents).values({
      id: randomUUID(),
      companyId,
      agentId,
      provider: "fixture",
      model: "fixture",
      costCents: 0,
      occurredAt: new Date(),
      heartbeatRunId: runId,
    });

    // projects.goalId references goals.id WITHOUT `onDelete`. Before
    // the reorder, `goals` was deleted before `projects`, so any
    // project still pointing at a company goal blocked the goals
    // delete with a constraint error. Seeding a goal-linked project
    // ensures the cascade keeps `projects` first.
    const goalId = randomUUID();
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Fixture goal",
    });
    await db.insert(projects).values({
      id: randomUUID(),
      companyId,
      name: "Fixture project",
      goalId,
    });

    return { companyId, agentId, issueId, policyId };
  }

  it("deletes the company and every child row across the cascade-blocking tables", async () => {
    const { companyId, issueId, policyId } = await seedCompanyWithCascadeBlockingRows();

    const removed = await companyService(db).remove(companyId);

    expect(removed?.id).toBe(companyId);

    // Companies row itself
    await expect(
      db.select().from(companies).where(eq(companies.id, companyId)),
    ).resolves.toHaveLength(0);

    // The seven newly-handled tables
    await expect(
      db.select().from(budgetIncidents).where(eq(budgetIncidents.companyId, companyId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(budgetPolicies).where(eq(budgetPolicies.id, policyId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(inboxDismissals).where(eq(inboxDismissals.companyId, companyId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(feedbackVotes).where(eq(feedbackVotes.companyId, companyId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(issueInboxArchives).where(eq(issueInboxArchives.companyId, companyId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.companyId, companyId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(workspaceRuntimeServices).where(eq(workspaceRuntimeServices.companyId, companyId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(workspaceOperations).where(eq(workspaceOperations.companyId, companyId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(routines).where(eq(routines.companyId, companyId)),
    ).resolves.toHaveLength(0);

    // Sanity: the parents the cascade depends on are gone too.
    await expect(
      db.select().from(issues).where(eq(issues.id, issueId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(agents).where(eq(agents.companyId, companyId)),
    ).resolves.toHaveLength(0);
  });

  it("returns null when removing a company that does not exist", async () => {
    const ghostId = randomUUID();
    const result = await companyService(db).remove(ghostId);
    expect(result).toBeNull();
  });
});
