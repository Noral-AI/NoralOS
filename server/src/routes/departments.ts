import { Router, type Request } from "express";
import type { Db } from "@noralos/db";
import { agents as agentsTable, departments as departmentsTable } from "@noralos/db";
import { and, asc, eq } from "drizzle-orm";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
} from "@noralos/shared";
import { validate } from "../middleware/validate.js";
import { agentService as makeAgentService, logActivity } from "../services/index.js";
import { conflict, forbidden, notFound } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

function canCreateDepartments(agent: {
  role: string;
  permissions: Record<string, unknown> | null | undefined;
}): boolean {
  if (!agent.permissions || typeof agent.permissions !== "object") return false;
  return Boolean(
    (agent.permissions as Record<string, unknown>).canCreateDepartments,
  );
}

export function departmentRoutes(db: Db) {
  const router = Router();
  const agentSvc = makeAgentService(db);

  async function assertCanManageDepartments(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
        return;
      }
      // assertCompanyAccess already enforces non-viewer membership for unsafe
      // methods, so any non-viewer member can manage departments.
      return;
    }
    if (!req.actor.agentId) {
      throw forbidden("Agent authentication required");
    }
    const actorAgent = await agentSvc.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      throw forbidden("Agent key cannot access another company");
    }
    if (!canCreateDepartments(actorAgent)) {
      throw forbidden("Missing permission: can create departments");
    }
  }

  router.get("/companies/:companyId/departments", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.companyId, companyId))
      .orderBy(asc(departmentsTable.sortOrder), asc(departmentsTable.name));
    res.json(rows);
  });

  router.post(
    "/companies/:companyId/departments",
    validate(createDepartmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertCanManageDepartments(req, companyId);

      const { name, description, icon, sortOrder } = req.body as {
        name: string;
        description?: string | null;
        icon?: string | null;
        sortOrder?: number;
      };

      const existing = await db
        .select({ id: departmentsTable.id })
        .from(departmentsTable)
        .where(
          and(
            eq(departmentsTable.companyId, companyId),
            eq(departmentsTable.name, name),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        throw conflict(`A department named "${name}" already exists`);
      }

      const [created] = await db
        .insert(departmentsTable)
        .values({
          companyId,
          name,
          description: description ?? null,
          icon: icon ?? null,
          sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        })
        .returning();

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "department.created",
        entityType: "department",
        entityId: created.id,
        details: { name: created.name },
      });

      res.status(201).json(created);
    },
  );

  router.patch(
    "/companies/:companyId/departments/:departmentId",
    validate(updateDepartmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const departmentId = req.params.departmentId as string;
      await assertCanManageDepartments(req, companyId);

      const [existing] = await db
        .select()
        .from(departmentsTable)
        .where(
          and(
            eq(departmentsTable.id, departmentId),
            eq(departmentsTable.companyId, companyId),
          ),
        )
        .limit(1);
      if (!existing) throw notFound("Department not found");

      const patch = req.body as {
        name?: string;
        description?: string | null;
        icon?: string | null;
        sortOrder?: number;
      };

      if (typeof patch.name === "string" && patch.name !== existing.name) {
        const conflictRow = await db
          .select({ id: departmentsTable.id })
          .from(departmentsTable)
          .where(
            and(
              eq(departmentsTable.companyId, companyId),
              eq(departmentsTable.name, patch.name),
            ),
          )
          .limit(1);
        if (conflictRow.length > 0) {
          throw conflict(`A department named "${patch.name}" already exists`);
        }
      }

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof patch.name === "string") update.name = patch.name;
      if (patch.description !== undefined) update.description = patch.description;
      if (patch.icon !== undefined) update.icon = patch.icon;
      if (typeof patch.sortOrder === "number") update.sortOrder = patch.sortOrder;

      const [updated] = await db
        .update(departmentsTable)
        .set(update)
        .where(eq(departmentsTable.id, departmentId))
        .returning();

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "department.updated",
        entityType: "department",
        entityId: updated.id,
        details: { name: updated.name },
      });

      res.json(updated);
    },
  );

  router.delete(
    "/companies/:companyId/departments/:departmentId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const departmentId = req.params.departmentId as string;
      await assertCanManageDepartments(req, companyId);

      const [existing] = await db
        .select()
        .from(departmentsTable)
        .where(
          and(
            eq(departmentsTable.id, departmentId),
            eq(departmentsTable.companyId, companyId),
          ),
        )
        .limit(1);
      if (!existing) throw notFound("Department not found");

      // FK ON DELETE SET NULL clears agents.department_id automatically;
      // the row count returned helps surface what happened in activity.
      const reassigned = await db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.companyId, companyId),
            eq(agentsTable.departmentId, departmentId),
          ),
        );

      await db
        .delete(departmentsTable)
        .where(eq(departmentsTable.id, departmentId));

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "department.deleted",
        entityType: "department",
        entityId: existing.id,
        details: { name: existing.name, agentsUnassigned: reassigned.length },
      });

      res.json({ ok: true, agentsUnassigned: reassigned.length });
    },
  );

  return router;
}
