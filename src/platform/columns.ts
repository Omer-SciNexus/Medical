import { timestamp, uuid } from "drizzle-orm/pg-core";

export const recordColumns = () => ({
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
