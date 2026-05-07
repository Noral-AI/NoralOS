/**
 * Authorization matrix for the Settings → Integrations admin surface.
 *
 * The credentials and assignments are company-scoped (FK to
 * `companies.id`) so the gate is `assertCompanyAdminAccess(req, companyId)`,
 * not `assertInstanceAdmin`.
 *
 * Expected:
 *   owner ✅
 *   admin ✅
 *   operator ❌
 *   viewer ❌
 *   member ❌
 *   agent ❌
 *   unauthenticated ❌
 *
 * Bypasses (matching the rest of the codebase):
 *   instance admins ✅
 *   local-trusted single-machine mode ✅
 */
import { describe, expect, it } from "vitest";
import { assertCompanyAdminAccess } from "../routes/authz.js";

const COMPANY_ID = "company-1";

function makeReq(input: {
  method?: string;
  actor: Express.Request["actor"];
}) {
  return {
    method: input.method ?? "POST",
    actor: input.actor,
  } as Express.Request;
}

function boardActor(role: string | null, opts?: { companyIds?: string[]; isInstanceAdmin?: boolean; status?: string }) {
  return {
    type: "board" as const,
    userId: "user-1",
    source: "session" as const,
    companyIds: opts?.companyIds ?? [COMPANY_ID],
    isInstanceAdmin: opts?.isInstanceAdmin ?? false,
    memberships: [
      {
        companyId: COMPANY_ID,
        membershipRole: role,
        status: opts?.status ?? "active",
      },
    ],
  };
}

describe("assertCompanyAdminAccess matrix", () => {
  it("allows owner", () => {
    const req = makeReq({ actor: boardActor("owner") });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).not.toThrow();
  });

  it("allows admin", () => {
    const req = makeReq({ actor: boardActor("admin") });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).not.toThrow();
  });

  it("rejects operator", () => {
    const req = makeReq({ actor: boardActor("operator") });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).toThrow(
      "Owner or admin role required",
    );
  });

  it("rejects viewer", () => {
    const req = makeReq({ actor: boardActor("viewer") });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).toThrow(
      "Owner or admin role required",
    );
  });

  it("rejects member", () => {
    const req = makeReq({ actor: boardActor("member") });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).toThrow(
      "Owner or admin role required",
    );
  });

  it("rejects agents", () => {
    const req = makeReq({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: COMPANY_ID,
        runId: null,
      } as Express.Request["actor"],
    });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).toThrow(
      "Agent tokens cannot access this surface",
    );
  });

  it("rejects unauthenticated", () => {
    const req = makeReq({
      actor: { type: "none" } as Express.Request["actor"],
    });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).toThrow();
  });

  it("rejects board users without an active membership", () => {
    const req = makeReq({
      actor: {
        ...boardActor("admin"),
        memberships: [{ companyId: COMPANY_ID, membershipRole: "admin", status: "suspended" }],
      },
    });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).toThrow(
      "Active company membership required",
    );
  });

  it("rejects board users who don't have visibility on the company", () => {
    const req = makeReq({
      actor: boardActor("owner", { companyIds: ["other-company"] }),
    });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).toThrow(
      "User does not have access to this company",
    );
  });

  it("allows instance admins on any company they can see, regardless of role", () => {
    const req = makeReq({
      actor: boardActor("operator", { isInstanceAdmin: true }),
    });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).not.toThrow();
  });

  it("allows local-trusted single-machine mode without a role check", () => {
    const req = makeReq({
      actor: {
        type: "board",
        userId: null,
        source: "local_implicit",
        companyIds: [],
        memberships: [],
        isInstanceAdmin: false,
      } as Express.Request["actor"],
    });
    expect(() => assertCompanyAdminAccess(req, COMPANY_ID)).not.toThrow();
  });
});
