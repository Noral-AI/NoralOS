import type { Department } from "@noralos/shared";
import { api } from "./client";

export interface CreateDepartmentInput {
  name: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
}

export type UpdateDepartmentInput = Partial<CreateDepartmentInput>;

export const departmentsApi = {
  list: (companyId: string) =>
    api.get<Department[]>(`/companies/${companyId}/departments`),
  create: (companyId: string, input: CreateDepartmentInput) =>
    api.post<Department>(`/companies/${companyId}/departments`, input),
  update: (companyId: string, departmentId: string, input: UpdateDepartmentInput) =>
    api.patch<Department>(
      `/companies/${companyId}/departments/${departmentId}`,
      input,
    ),
  remove: (companyId: string, departmentId: string) =>
    api.delete<{ ok: true; agentsUnassigned: number }>(
      `/companies/${companyId}/departments/${departmentId}`,
    ),
};
