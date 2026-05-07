import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveParticipantRunPaths } from "../home-paths.ts";

const quentinUserId = "62PslzCUFMDxYhnO4lNv5oLCbCGQA9ns";
const qianaUserId = "OB0hh1oc5CZTNXnnvt7COiX9jicTr90j";
const agentId = "9259d8d9-0d93-4b19-8900-25df8ad7ea2d";
const companyId = "a002affa-7d52-4ea9-b978-677b450e74a6";

describe("resolveParticipantRunPaths", () => {
  // The function reads NORALOS_HOME / NORALOS_INSTANCE_ID via the host
  // env. Pin them so absolute paths in expectations are stable.
  let originalHome: string | undefined;
  let originalInstance: string | undefined;
  beforeEach(() => {
    originalHome = process.env.NORALOS_HOME;
    originalInstance = process.env.NORALOS_INSTANCE_ID;
    process.env.NORALOS_HOME = "/noralos";
    process.env.NORALOS_INSTANCE_ID = "default";
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.NORALOS_HOME;
    else process.env.NORALOS_HOME = originalHome;
    if (originalInstance === undefined) delete process.env.NORALOS_INSTANCE_ID;
    else process.env.NORALOS_INSTANCE_ID = originalInstance;
  });

  it("returns per-user cwd + per-user agent-home paths for an authenticated participant", () => {
    const paths = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: `participants/users/${quentinUserId}`,
    });
    expect(paths).not.toBeNull();
    expect(paths!.cwd).toBe(
      path.resolve(
        `/noralos/instances/default/workspaces/${agentId}/participants/users/${quentinUserId}`,
      ),
    );
    expect(paths!.agentHome).toBe(
      path.resolve(
        `/noralos/instances/default/companies/${companyId}/agents/${agentId}/participants/users/${quentinUserId}`,
      ),
    );
    expect(paths!.agentHomeLifeDir.endsWith("/life")).toBe(true);
    expect(paths!.agentHomeMemoryDir.endsWith("/memory")).toBe(true);
  });

  it("yields different cwds and different agent-homes for different users", () => {
    const a = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: `participants/users/${quentinUserId}`,
    });
    const b = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: `participants/users/${qianaUserId}`,
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.cwd).not.toBe(b!.cwd);
    expect(a!.agentHome).not.toBe(b!.agentHome);
    expect(a!.agentHomeLifeDir).not.toBe(b!.agentHomeLifeDir);
  });

  it("returns the same paths for the same user across calls (idempotent)", () => {
    const a = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: `participants/users/${quentinUserId}`,
    });
    const b = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: `participants/users/${quentinUserId}`,
    });
    expect(a).toEqual(b);
  });

  it("supports the anonymous fallback (per-conferenceSession)", () => {
    const conferenceSessionId = "conf-abc-123";
    const paths = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: `participants/anon/${conferenceSessionId}`,
    });
    expect(paths).not.toBeNull();
    expect(paths!.agentHome).toContain(`participants/anon/${conferenceSessionId}`);
  });

  it("rejects subpaths with `..` or absolute leading slashes", () => {
    const escapeAttempt = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: "participants/users/../../etc/passwd",
    });
    const absoluteAttempt = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: "/etc/passwd",
    });
    expect(escapeAttempt).toBeNull();
    expect(absoluteAttempt).toBeNull();
  });

  it("rejects subpath segments with unsafe characters", () => {
    const dot = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: "participants/users/u.with.dots",
    });
    const space = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: "participants/users/u with space",
    });
    const pipe = resolveParticipantRunPaths({
      companyId,
      agentId,
      participantSubPath: "participants/users/u|pipe",
    });
    expect(dot).toBeNull();
    expect(space).toBeNull();
    expect(pipe).toBeNull();
  });

  it("rejects an empty subpath", () => {
    expect(
      resolveParticipantRunPaths({
        companyId,
        agentId,
        participantSubPath: "",
      }),
    ).toBeNull();
  });

  it("rejects an unsafe agentId so a malicious caller cannot escape via the company root", () => {
    expect(() =>
      resolveParticipantRunPaths({
        companyId,
        agentId: "../etc",
        participantSubPath: "participants/users/u1",
      }),
    ).toThrow();
  });

  it("rejects an unsafe companyId for the same reason", () => {
    expect(() =>
      resolveParticipantRunPaths({
        companyId: "../escape",
        agentId,
        participantSubPath: "participants/users/u1",
      }),
    ).toThrow();
  });
});
