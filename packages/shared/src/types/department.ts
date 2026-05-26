export interface Department {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
