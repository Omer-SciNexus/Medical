import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, uniqueIndex, check } from "drizzle-orm/pg-core";
import { recordColumns } from "@/platform/columns";

export const charges = pgTable("charges", {
  ...recordColumns(), patientId: uuid("patient_id").notNull(), encounterId: uuid("encounter_id").notNull(),
  amountMinor: integer("amount_minor").notNull(), currency: text("currency").notNull(),
  description: text("description").notNull(), status: text("status").default("pending").notNull(),
}, (t) => [uniqueIndex("charge_encounter_unique").on(t.encounterId), check("charge_nonnegative", sql`${t.amountMinor} >= 0`),
  check("charge_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`), check("charge_status", sql`${t.status} IN ('pending', 'paid', 'void')`)]);
