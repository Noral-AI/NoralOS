import { describe, expect, it, vi } from "vitest";

import { manifest } from "./manifest.js";
import {
  REVERSE_TOOL_CREATE_TASK_FOR_AGENT,
  REVERSE_TOOL_GET_AGENT_STATUS,
  REVERSE_TOOL_LOOKUP_CUSTOMER,
} from "./constants.js";
import { dispatchReverseTool, type ReverseToolHandlerContext } from "./reverse-tools.js";

function silentLogger(): ReverseToolHandlerContext["logger"] {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("manifest.reverseTools declarations", () => {
  it("declares the three v1 reverse-tools", () => {
    const declared = (manifest.reverseTools ?? []).map((t) => t.toolName).sort();
    expect(declared).toEqual(
      [
        REVERSE_TOOL_CREATE_TASK_FOR_AGENT,
        REVERSE_TOOL_GET_AGENT_STATUS,
        REVERSE_TOOL_LOOKUP_CUSTOMER,
      ].sort(),
    );
  });

  it("declares a reverse-tool webhook endpoint", () => {
    const endpoints = (manifest.webhooks ?? []).map((w) => w.endpointKey);
    expect(endpoints).toContain("reverse-tool");
  });

  it("uses lower snake_case for every reverse-tool name", () => {
    for (const t of manifest.reverseTools ?? []) {
      expect(t.toolName).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe("dispatchReverseTool", () => {
  const baseCtx = (overrides: Partial<ReverseToolHandlerContext> = {}): ReverseToolHandlerContext => ({
    companyId: "00000000-0000-0000-0000-000000000001",
    logger: silentLogger(),
    ...overrides,
  });

  it("returns UNKNOWN_REVERSE_TOOL for an unrecognized name", async () => {
    const result = await dispatchReverseTool(baseCtx(), "totally-not-a-tool", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNKNOWN_REVERSE_TOOL");
    }
  });

  describe("get_agent_status", () => {
    it("rejects missing agent_id", async () => {
      const result = await dispatchReverseTool(baseCtx(), REVERSE_TOOL_GET_AGENT_STATUS, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_ARGS");
    });

    it("reports HOST_DB_UNAVAILABLE when ctx.host.queryHostDb is missing", async () => {
      const result = await dispatchReverseTool(baseCtx(), REVERSE_TOOL_GET_AGENT_STATUS, {
        agent_id: "11111111-1111-1111-1111-111111111111",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("HOST_DB_UNAVAILABLE");
    });

    it("returns AGENT_NOT_FOUND when the host DB has no row for this agent in the company", async () => {
      const hostDb = vi.fn().mockResolvedValue([]);
      const result = await dispatchReverseTool(
        baseCtx({ hostDb }),
        REVERSE_TOOL_GET_AGENT_STATUS,
        { agent_id: "11111111-1111-1111-1111-111111111111" },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("AGENT_NOT_FOUND");
    });

    it("derives status=active when last_seen_at is recent", async () => {
      const recent = new Date(Date.now() - 60_000).toISOString();
      const hostDb = vi.fn().mockResolvedValue([
        { id: "agent-1", status: "online", last_seen_at: recent },
      ]);
      const result = await dispatchReverseTool(
        baseCtx({ hostDb }),
        REVERSE_TOOL_GET_AGENT_STATUS,
        { agent_id: "agent-1" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.result as { status: string; can_be_paged: boolean };
        expect(data.status).toBe("active");
        expect(data.can_be_paged).toBe(true);
      }
    });

    it("derives status=offline + can_be_paged=false when the agent is marked offline", async () => {
      const hostDb = vi.fn().mockResolvedValue([
        { id: "agent-1", status: "offline", last_seen_at: null },
      ]);
      const result = await dispatchReverseTool(
        baseCtx({ hostDb }),
        REVERSE_TOOL_GET_AGENT_STATUS,
        { agent_id: "agent-1" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.result as { status: string; can_be_paged: boolean };
        expect(data.status).toBe("offline");
        expect(data.can_be_paged).toBe(false);
      }
    });

    it("surfaces HOST_DB_QUERY_FAILED if queryHostDb throws", async () => {
      const hostDb = vi.fn().mockRejectedValue(new Error("connection lost"));
      const result = await dispatchReverseTool(
        baseCtx({ hostDb }),
        REVERSE_TOOL_GET_AGENT_STATUS,
        { agent_id: "agent-1" },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("HOST_DB_QUERY_FAILED");
    });
  });

  it("create_task_for_agent returns NOT_IMPLEMENTED with a clear message", async () => {
    const result = await dispatchReverseTool(
      baseCtx(),
      REVERSE_TOOL_CREATE_TASK_FOR_AGENT,
      { agent_id: "a", title: "t", body: "b" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_IMPLEMENTED");
      expect(result.error).toContain("create_task_for_agent");
    }
  });

  it("lookup_customer returns NOT_CONFIGURED with a clear message", async () => {
    const result = await dispatchReverseTool(
      baseCtx(),
      REVERSE_TOOL_LOOKUP_CUSTOMER,
      { identifier: "foo@example.com" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_CONFIGURED");
    }
  });
});
