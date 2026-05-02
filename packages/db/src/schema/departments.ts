import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyNameIdx: uniqueIndex("departments_company_name_idx").on(
      table.companyId,
      table.name,
    ),
    companySortIdx: index("departments_company_sort_idx").on(
      table.companyId,
      table.sortOrder,
    ),
  }),
);
