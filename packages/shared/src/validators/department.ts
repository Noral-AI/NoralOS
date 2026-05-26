import { z } from "zod";
import { AGENT_ICON_NAMES } from "../constants.js";

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).optional().nullable(),
  icon: z.enum(AGENT_ICON_NAMES).optional().nullable(),
  sortOrder: z.number().int().optional(),
});

export type CreateDepartment = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial();

export type UpdateDepartment = z.infer<typeof updateDepartmentSchema>;
