import { describe, expect, it } from "vitest";
import { actorCanViewAllCompanyIssues } from "../routes/authz.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const otherCompanyId = "00000000-0000-4000-8000-000000000002";
const userId = "user-aaaa";

function makeRequest(actor: any) {
  return { actor } as any;
}

describe("actorCanViewAllCompanyIssues", () => {
  it("returns true for instance admins regardless of membership", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "board",
          userId,
          source: "session",
          isInstanceAdmin: true,
          memberships: [],
        }),
        companyId,
      ),
    ).toBe(true);
  });

  it("returns true for local_implicit board sessions (single-user dev mode)", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "board",
          userId: "local-board",
          source: "local_implicit",
          isInstanceAdmin: true,
        }),
        companyId,
      ),
    ).toBe(true);
  });

  it("returns true for owner role on the target company", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "board",
          userId,
          source: "session",
          isInstanceAdmin: false,
          memberships: [{ companyId, membershipRole: "owner", status: "active" }],
        }),
        companyId,
      ),
    ).toBe(true);
  });

  it("returns true for admin role on the target company", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "board",
          userId,
          source: "session",
          isInstanceAdmin: false,
          memberships: [{ companyId, membershipRole: "admin", status: "active" }],
        }),
        companyId,
      ),
    ).toBe(true);
  });

  it("returns false for operator role", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "board",
          userId,
          source: "session",
          isInstanceAdmin: false,
          memberships: [{ companyId, membershipRole: "operator", status: "active" }],
        }),
        companyId,
      ),
    ).toBe(false);
  });

  it("returns false for viewer role", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "board",
          userId,
          source: "session",
          isInstanceAdmin: false,
          memberships: [{ companyId, membershipRole: "viewer", status: "active" }],
        }),
        companyId,
      ),
    ).toBe(false);
  });

  it("returns false when membership is on a different company even if owner there", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "board",
          userId,
          source: "session",
          isInstanceAdmin: false,
          memberships: [{ companyId: otherCompanyId, membershipRole: "owner", status: "active" }],
        }),
        companyId,
      ),
    ).toBe(false);
  });

  it("returns false when membership is suspended", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "board",
          userId,
          source: "session",
          isInstanceAdmin: false,
          memberships: [{ companyId, membershipRole: "owner", status: "suspended" }],
        }),
        companyId,
      ),
    ).toBe(false);
  });

  it("returns false for unauthenticated actors", () => {
    expect(
      actorCanViewAllCompanyIssues(makeRequest({ type: "none", source: "none" }), companyId),
    ).toBe(false);
  });

  it("returns true for an agent authenticated for the same company", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "agent",
          agentId: "agent-1",
          companyId,
          source: "agent_key",
        }),
        companyId,
      ),
    ).toBe(true);
  });

  it("returns false for an agent scoped to a different company", () => {
    expect(
      actorCanViewAllCompanyIssues(
        makeRequest({
          type: "agent",
          agentId: "agent-1",
          companyId: otherCompanyId,
          source: "agent_key",
        }),
        companyId,
      ),
    ).toBe(false);
  });
});
