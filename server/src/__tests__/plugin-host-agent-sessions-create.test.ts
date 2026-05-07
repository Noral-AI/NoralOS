import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, agentTaskSessions } from "@noralos/db";
import { eq } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { buildHostServices } from "../services/plugin-host-services.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: async () => {},
        subscribe: () => {},
      };
    },
  } as any;
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping plugin host agent sessions tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("plugin host agents.sessions.create", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("noralos-plugin-host-sessions-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agentTaskSessions);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "NoralOS",
      issuePrefix: "TST",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Brooklyn",
      role: "engineer",
      status: "idle",
      adapterType: "claude-local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId };
  }

  it("creates one task session row when called twice with the same explicit taskKey", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const services = buildHostServices(
      db,
      "plugin-record-id",
      "noralos.conference-room-bridge",
      createEventBusStub(),
    );
    const taskKey =
      "plugin:noralos.conference-room-bridge:session:user:user-quentin";

    const first = await services.agentSessions.create({
      agentId,
      companyId,
      taskKey,
    });
    const second = await services.agentSessions.create({
      agentId,
      companyId,
      taskKey,
    });

    // Both calls return the SAME session id — the second call resolves to the
    // existing row instead of erroring on the unique constraint or creating
    // a duplicate. This is what gives Quentin a single Claude conversation
    // across browser tabs while never sharing it with Qiana.
    expect(second.sessionId).toBe(first.sessionId);

    const rows = await db
      .select()
      .from(agentTaskSessions)
      .where(eq(agentTaskSessions.taskKey, taskKey));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.sessionId);
  });

  it("creates separate task session rows for distinct user task keys", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const services = buildHostServices(
      db,
      "plugin-record-id",
      "noralos.conference-room-bridge",
      createEventBusStub(),
    );

    const quentin = await services.agentSessions.create({
      agentId,
      companyId,
      taskKey: "plugin:noralos.conference-room-bridge:session:user:quentin-id",
    });
    const qiana = await services.agentSessions.create({
      agentId,
      companyId,
      taskKey: "plugin:noralos.conference-room-bridge:session:user:qiana-id",
    });

    expect(quentin.sessionId).not.toBe(qiana.sessionId);
    const all = await db.select().from(agentTaskSessions);
    expect(all).toHaveLength(2);
  });

  it("rejects an explicit taskKey outside the plugin's reserved namespace", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const services = buildHostServices(
      db,
      "plugin-record-id",
      "noralos.conference-room-bridge",
      createEventBusStub(),
    );

    await expect(
      services.agentSessions.create({
        agentId,
        companyId,
        // Spoof another plugin's namespace.
        taskKey: "plugin:some.other.plugin:session:abc",
      }),
    ).rejects.toThrow(/taskKey must start with/);

    await expect(
      services.agentSessions.create({
        agentId,
        companyId,
        // System task keys (issue ids etc.) — never allowed from a plugin.
        taskKey: "issue-12345",
      }),
    ).rejects.toThrow(/taskKey must start with/);

    const rows = await db.select().from(agentTaskSessions);
    expect(rows).toHaveLength(0);
  });

  it("auto-generates a per-call taskKey inside the plugin namespace when none is supplied", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const services = buildHostServices(
      db,
      "plugin-record-id",
      "noralos.conference-room-bridge",
      createEventBusStub(),
    );

    const a = await services.agentSessions.create({ agentId, companyId });
    const b = await services.agentSessions.create({ agentId, companyId });

    expect(a.sessionId).not.toBe(b.sessionId);
    const rows = await db
      .select()
      .from(agentTaskSessions)
      .orderBy(agentTaskSessions.createdAt);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(
        row.taskKey.startsWith(
          "plugin:noralos.conference-room-bridge:session:",
        ),
      ).toBe(true);
    }
  });
});
