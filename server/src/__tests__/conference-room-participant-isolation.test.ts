import { describe, expect, it } from "vitest";
import {
  deriveParticipantContext,
  type IsolationActor,
} from "../../../packages/plugins/conference-room-bridge/src/participant-isolation.ts";

const conferenceSessionId = "conf-aaaa-bbbb";
const otherConferenceSessionId = "conf-cccc-dddd";
const quentinUserId = "62PslzCUFMDxYhnO4lNv5oLCbCGQA9ns";
const qianaUserId = "OB0hh1oc5CZTNXnnvt7COiX9jicTr90j";

describe("Conference Room participant isolation", () => {
  it("authenticated user gets a per-user task key", () => {
    const ctx = deriveParticipantContext(
      { actorType: "user", userId: quentinUserId } satisfies IsolationActor,
      {},
      conferenceSessionId,
    );
    expect(ctx.participantId).toBe(quentinUserId);
    expect(ctx.isolationKeyType).toBe("user");
    expect(ctx.taskKey).toBe(
      `plugin:noralos.conference-room-bridge:session:user:${quentinUserId}`,
    );
  });

  it("same user across different conference session ids gets the same task key", () => {
    const a = deriveParticipantContext(
      { actorType: "user", userId: quentinUserId },
      {},
      conferenceSessionId,
    );
    const b = deriveParticipantContext(
      { actorType: "user", userId: quentinUserId },
      {},
      otherConferenceSessionId,
    );
    expect(a.taskKey).toBe(b.taskKey);
    expect(a.participantId).toBe(b.participantId);
  });

  it("different users never share a task key for the same conference session id", () => {
    const a = deriveParticipantContext(
      { actorType: "user", userId: quentinUserId },
      {},
      conferenceSessionId,
    );
    const b = deriveParticipantContext(
      { actorType: "user", userId: qianaUserId },
      {},
      conferenceSessionId,
    );
    expect(a.taskKey).not.toBe(b.taskKey);
    expect(a.participantId).not.toBe(b.participantId);
  });

  it("anonymous (no actor) falls back to per-conference-session anon key", () => {
    const ctx = deriveParticipantContext(undefined, {}, conferenceSessionId);
    expect(ctx.participantId).toBeNull();
    expect(ctx.isolationKeyType).toBe("anon");
    expect(ctx.taskKey).toBe(
      `plugin:noralos.conference-room-bridge:session:anon:${conferenceSessionId}`,
    );
  });

  it("agent actor (no userId) falls back to anon per-session key — no global agent reuse", () => {
    const ctx = deriveParticipantContext(
      { actorType: "agent", userId: null },
      {},
      conferenceSessionId,
    );
    expect(ctx.participantId).toBeNull();
    expect(ctx.isolationKeyType).toBe("anon");
    expect(ctx.taskKey).toBe(
      `plugin:noralos.conference-room-bridge:session:anon:${conferenceSessionId}`,
    );
  });

  it("user actor with empty userId is treated as anonymous", () => {
    const ctx = deriveParticipantContext(
      { actorType: "user", userId: "" },
      {},
      conferenceSessionId,
    );
    expect(ctx.participantId).toBeNull();
    expect(ctx.isolationKeyType).toBe("anon");
    expect(ctx.taskKey).toContain(":session:anon:");
  });

  it("two anonymous sessions (different conference ids) get distinct task keys", () => {
    const a = deriveParticipantContext(undefined, {}, conferenceSessionId);
    const b = deriveParticipantContext(undefined, {}, otherConferenceSessionId);
    expect(a.taskKey).not.toBe(b.taskKey);
  });

  it("body.participantId is honoured when no authenticated user actor", () => {
    const ctx = deriveParticipantContext(
      undefined,
      { participantId: "guest-123" },
      conferenceSessionId,
    );
    expect(ctx.participantId).toBe("guest-123");
    // Still anonymous task-key-wise — body participantId attribution is
    // recorded but does not promote the run to a user-keyed Claude session.
    expect(ctx.isolationKeyType).toBe("anon");
  });

  it("authenticated user actor overrides any caller-supplied body participantId", () => {
    const ctx = deriveParticipantContext(
      { actorType: "user", userId: quentinUserId },
      { participantId: "spoofed-other-user" },
      conferenceSessionId,
    );
    expect(ctx.participantId).toBe(quentinUserId);
    expect(ctx.taskKey).toBe(
      `plugin:noralos.conference-room-bridge:session:user:${quentinUserId}`,
    );
  });

  it("task keys live inside the plugin's reserved session namespace", () => {
    const userCtx = deriveParticipantContext(
      { actorType: "user", userId: quentinUserId },
      {},
      conferenceSessionId,
    );
    const anonCtx = deriveParticipantContext(undefined, {}, conferenceSessionId);
    const requiredPrefix = "plugin:noralos.conference-room-bridge:session:";
    expect(userCtx.taskKey.startsWith(requiredPrefix)).toBe(true);
    expect(anonCtx.taskKey.startsWith(requiredPrefix)).toBe(true);
  });
});
