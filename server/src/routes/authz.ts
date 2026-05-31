import type { Request } from "express";
import { forbidden, unauthorized } from "../errors.js";

export function assertAuthenticated(req: Request) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
}

export function assertBoard(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
}

export function hasBoardOrgAccess(req: Request) {
  if (req.actor.type !== "board") {
    return false;
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return true;
  }
  return Array.isArray(req.actor.companyIds) && req.actor.companyIds.length > 0;
}

export function assertBoardOrgAccess(req: Request) {
  assertBoard(req);
  if (hasBoardOrgAccess(req)) {
    return;
  }
  throw forbidden("Company membership or instance admin access required");
}

/**
 * Like {@link assertBoardOrgAccess}, but also admits agent actors. An agent
 * run-JWT (`req.actor.type === "agent"`) is already scoped to a single company;
 * routes that accept agents enforce that scope downstream (e.g.
 * `assertCompanyAccess` + run-context validation). Used by the agent-facing
 * plugin-tool routes so an agent can discover and invoke its own plugin tools.
 */
export function assertBoardOrgOrAgent(req: Request) {
  if (req.actor.type === "agent") {
    return;
  }
  assertBoardOrgAccess(req);
}

export function assertInstanceAdmin(req: Request) {
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

/**
 * True when the actor may browse every issue in the company without
 * narrowing filters (regardless of personal involvement). Owner/admin
 * (plus instance_admin and local_implicit) qualify; operator/viewer do not.
 * Agents authenticated for the same company are treated as full-visibility:
 * the agent platform itself needs to enumerate company work.
 *
 * Inbox routing is a separate concern — see `touchedByUserCondition` in
 * the issues service. This gate only governs the broad "All Company Issues"
 * browse layer.
 */
export function actorCanViewAllCompanyIssues(req: Request, companyId: string): boolean {
  if (req.actor.type === "agent") return req.actor.companyId === companyId;
  if (req.actor.type !== "board") return false;
  if (req.actor.source === "local_implicit") return true;
  if (req.actor.isInstanceAdmin) return true;
  const memberships = req.actor.memberships ?? [];
  const membership = memberships.find((item) => item.companyId === companyId);
  if (!membership || membership.status !== "active") return false;
  return membership.membershipRole === "owner" || membership.membershipRole === "admin";
}

export function assertCompanyAccess(req: Request, companyId: string) {
  assertAuthenticated(req);
  if (req.actor.type === "agent" && req.actor.companyId !== companyId) {
    throw forbidden("Agent key cannot access another company");
  }
  if (req.actor.type === "board" && req.actor.source !== "local_implicit") {
    const allowedCompanies = req.actor.companyIds ?? [];
    if (!allowedCompanies.includes(companyId)) {
      throw forbidden("User does not have access to this company");
    }
    const method = typeof req.method === "string" ? req.method.toUpperCase() : "GET";
    const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(method);
    if (!isSafeMethod && !req.actor.isInstanceAdmin && Array.isArray(req.actor.memberships)) {
      const membership = req.actor.memberships.find((item) => item.companyId === companyId);
      if (!membership || membership.status !== "active") {
        throw forbidden("User does not have active company access");
      }
      if (membership.membershipRole === "viewer") {
        throw forbidden("Viewer access is read-only");
      }
    }
  }
}

export function getActorInfo(req: Request) {
  assertAuthenticated(req);
  if (req.actor.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: req.actor.agentId ?? "unknown-agent",
      agentId: req.actor.agentId ?? null,
      runId: req.actor.runId ?? null,
    };
  }

  return {
    actorType: "user" as const,
    actorId: req.actor.userId ?? "board",
    agentId: null,
    runId: req.actor.runId ?? null,
  };
}
