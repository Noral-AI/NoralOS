import { beforeEach, describe, expect, it, vi } from "vitest";

import { readNoralosSkillSyncPreference } from "@noralos/adapter-utils/server-utils";

const VOICE_BUILD_SKILL_KEY = "noralos/noralos/noralvoice-build-from-template";

// Mock only the agent service so we can capture the `create` payload. The
// real skill-sync helper (writeNoralosSkillSyncPreference) is left intact so
// the test verifies the actual adapterConfig composition, not a stub.
const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("../services/agents.js", () => ({
  agentService: () => ({ create: mockCreate }),
}));

const { VOICE_DIRECTOR_TEMPLATE, provisionVoiceDirector } = await import(
  "../services/agent-templates/voice-director.js"
);

// Minimal db stub. findCeoAgentId issues `db.select().from().where()` and
// resolves the first query to [] — an empty result short-circuits to "no CEO"
// (returns null) before the second query runs, so this is all that's needed.
function makeDbStub() {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as Parameters<typeof provisionVoiceDirector>[0];
}

describe("Voice Director default skill seeding", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockImplementation(
      async (_companyId: string, data: Record<string, unknown>) => ({
        id: "vd-1",
        name: data.name,
        reportsTo: data.reportsTo ?? null,
      }),
    );
  });

  it("declares the clone-and-fill build guide as a default skill", () => {
    expect(VOICE_DIRECTOR_TEMPLATE.defaultSkills).toContain(VOICE_BUILD_SKILL_KEY);
  });

  it("seeds the default skills into the provisioned agent's adapterConfig", async () => {
    await provisionVoiceDirector(makeDbStub(), "company-1");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0]![1] as { adapterConfig: Record<string, unknown> };
    const desired = readNoralosSkillSyncPreference(data.adapterConfig).desiredSkills;
    expect(desired).toContain(VOICE_BUILD_SKILL_KEY);
  });
});
