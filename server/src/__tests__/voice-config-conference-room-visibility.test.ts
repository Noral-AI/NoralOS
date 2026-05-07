import { describe, expect, it } from "vitest";
import {
  resolveConferenceRoomVisibility,
  type ConferenceRoomResolutionInput,
} from "../../../packages/plugins/voice-config/src/worker.ts";

function input(
  patch: Partial<ConferenceRoomResolutionInput>,
): ConferenceRoomResolutionInput {
  return {
    isSystemManaged: false,
    role: "engineer",
    hasDirectReports: false,
    conferenceRoomVisible: null,
    conferenceRoomRole: null,
    conferenceRoomDefaultTarget: false,
    someoneElseIsExplicitDefaultTarget: false,
    ...patch,
  };
}

describe("Conference Room visibility resolution — long-term precedence", () => {
  describe("systemManaged short-circuit", () => {
    it("hides a system-managed agent regardless of explicit overrides", () => {
      const result = resolveConferenceRoomVisibility(
        input({
          isSystemManaged: true,
          conferenceRoomVisible: true,
          conferenceRoomRole: "host",
          conferenceRoomDefaultTarget: true,
        }),
      );
      expect(result).toEqual({
        visible: false,
        role: "hidden",
        defaultTarget: false,
      });
    });

    it("hides a system-managed CEO even though CEOs are normally hosts", () => {
      const result = resolveConferenceRoomVisibility(
        input({ isSystemManaged: true, role: "ceo" }),
      );
      expect(result.visible).toBe(false);
      expect(result.role).toBe("hidden");
    });
  });

  describe("CEO short-circuit", () => {
    it("makes the CEO a visible host with default target by default", () => {
      const result = resolveConferenceRoomVisibility(input({ role: "ceo" }));
      expect(result).toEqual({ visible: true, role: "host", defaultTarget: true });
    });

    it("yields default-target to another agent who has the explicit flag", () => {
      const result = resolveConferenceRoomVisibility(
        input({
          role: "ceo",
          someoneElseIsExplicitDefaultTarget: true,
        }),
      );
      expect(result).toEqual({ visible: true, role: "host", defaultTarget: false });
    });

    it("respects an explicit demotion of the CEO to hidden", () => {
      const result = resolveConferenceRoomVisibility(
        input({
          role: "ceo",
          conferenceRoomVisible: false,
          conferenceRoomRole: "hidden",
        }),
      );
      expect(result.visible).toBe(false);
      expect(result.role).toBe("hidden");
    });

    it("a CEO admin-flagged as default target stays default even if another also flagged", () => {
      const result = resolveConferenceRoomVisibility(
        input({
          role: "ceo",
          conferenceRoomDefaultTarget: true,
          someoneElseIsExplicitDefaultTarget: true,
        }),
      );
      expect(result.defaultTarget).toBe(true);
    });
  });

  describe("explicit overrides", () => {
    it("explicit visible=true with role=director surfaces a non-CEO agent", () => {
      const result = resolveConferenceRoomVisibility(
        input({
          conferenceRoomVisible: true,
          conferenceRoomRole: "director",
        }),
      );
      expect(result).toEqual({
        visible: true,
        role: "director",
        defaultTarget: false,
      });
    });

    it("explicit visible=true with role=null defaults to director", () => {
      const result = resolveConferenceRoomVisibility(
        input({ conferenceRoomVisible: true }),
      );
      expect(result.role).toBe("director");
      expect(result.visible).toBe(true);
    });

    it("explicit visible=false hides the agent even if has direct reports", () => {
      const result = resolveConferenceRoomVisibility(
        input({
          hasDirectReports: true,
          conferenceRoomVisible: false,
        }),
      );
      expect(result.visible).toBe(false);
      expect(result.role).toBe("hidden");
    });

    it("explicit role=hidden hides the agent regardless of visible flag", () => {
      const result = resolveConferenceRoomVisibility(
        input({ conferenceRoomRole: "hidden" }),
      );
      expect(result).toEqual({
        visible: false,
        role: "hidden",
        defaultTarget: false,
      });
    });

    it("explicit role=director without visible flag is treated as visible", () => {
      const result = resolveConferenceRoomVisibility(
        input({ conferenceRoomRole: "director" }),
      );
      expect(result.visible).toBe(true);
      expect(result.role).toBe("director");
    });

    it("default-target flag is honoured when explicit visible=true", () => {
      const result = resolveConferenceRoomVisibility(
        input({
          conferenceRoomVisible: true,
          conferenceRoomRole: "director",
          conferenceRoomDefaultTarget: true,
        }),
      );
      expect(result.defaultTarget).toBe(true);
    });

    it("default-target flag is dropped when explicit visible=false", () => {
      const result = resolveConferenceRoomVisibility(
        input({
          conferenceRoomVisible: false,
          conferenceRoomDefaultTarget: true,
        }),
      );
      expect(result.defaultTarget).toBe(false);
    });
  });

  describe("migration heuristic — has direct reports", () => {
    it("a manager-equivalent agent with direct reports defaults to a visible director", () => {
      const result = resolveConferenceRoomVisibility(
        input({ hasDirectReports: true }),
      );
      expect(result).toEqual({
        visible: true,
        role: "director",
        defaultTarget: false,
      });
    });

    it("workers without direct reports are hidden by default", () => {
      const result = resolveConferenceRoomVisibility(input({}));
      expect(result).toEqual({
        visible: false,
        role: "hidden",
        defaultTarget: false,
      });
    });
  });

  describe("invariants", () => {
    it("never returns visible=true with role=hidden", () => {
      const cases: ConferenceRoomResolutionInput[] = [
        input({ isSystemManaged: true }),
        input({ role: "ceo" }),
        input({ conferenceRoomVisible: true, conferenceRoomRole: "host" }),
        input({ conferenceRoomVisible: true, conferenceRoomRole: "director" }),
        input({ conferenceRoomVisible: false }),
        input({ hasDirectReports: true }),
        input({}),
      ];
      for (const c of cases) {
        const result = resolveConferenceRoomVisibility(c);
        if (result.visible) expect(result.role).not.toBe("hidden");
      }
    });

    it("hidden role implies defaultTarget=false", () => {
      const cases: ConferenceRoomResolutionInput[] = [
        input({ isSystemManaged: true, conferenceRoomDefaultTarget: true }),
        input({ conferenceRoomRole: "hidden", conferenceRoomDefaultTarget: true }),
        input({}),
      ];
      for (const c of cases) {
        const result = resolveConferenceRoomVisibility(c);
        if (result.role === "hidden") expect(result.defaultTarget).toBe(false);
      }
    });
  });
});
