import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { recordColumns } from "@/platform/columns";

/**
 * What a clinic charges for, and what it charges. One default per clinic is what a visit falls
 * back to when nothing else was added, which is what retires the hardcoded consultation fee.
 */
export const services = pgTable("services", {
  ...recordColumns(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
}, (t) => [uniqueIndex("services_clinic_id_unique").on(t.clinicId, t.id),
  uniqueIndex("service_clinic_code").on(t.clinicId, t.code).where(sql`${t.deletedAt} IS NULL`),
  uniqueIndex("service_clinic_default").on(t.clinicId).where(sql`${t.isDefault} AND ${t.deletedAt} IS NULL`),
  check("service_nonnegative", sql`${t.amountMinor} >= 0`), check("service_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`)]);

/** The invoice for one visit. Still exactly one per encounter; the money lives in its lines. */
export const charges = pgTable("charges", {
  ...recordColumns(), patientId: uuid("patient_id").notNull(), encounterId: uuid("encounter_id").notNull(),
  amountMinor: integer("amount_minor").notNull(), currency: text("currency").notNull(),
  description: text("description").notNull(), status: text("status").default("pending").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }), paidMethod: text("paid_method"), voidReason: text("void_reason"),
}, (t) => [uniqueIndex("charge_encounter_unique").on(t.encounterId), uniqueIndex("charges_clinic_id_unique").on(t.clinicId, t.id),
  check("charge_nonnegative", sql`${t.amountMinor} >= 0`),
  check("charge_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`), check("charge_status", sql`${t.status} IN ('pending', 'paid', 'void')`),
  // A settled invoice has to say how it was settled, and a void one has to say why.
  check("charge_paid_detail", sql`${t.status} <> 'paid' OR (${t.paidAt} IS NOT NULL AND ${t.paidMethod} IN ('cash', 'card', 'transfer', 'insurance'))`),
  check("charge_void_detail", sql`${t.status} <> 'void' OR (${t.voidReason} IS NOT NULL AND length(${t.voidReason}) >= 5)`)]);

/** One line per thing charged for. amount_minor is quantity times the unit, by constraint. */
export const chargeLines = pgTable("charge_lines", {
  ...recordColumns(),
  chargeId: uuid("charge_id").notNull(),
  serviceId: uuid("service_id"),
  description: text("description").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  unitAmountMinor: integer("unit_amount_minor").notNull(),
  amountMinor: integer("amount_minor").notNull(),
}, (t) => [index("charge_line_charge").on(t.clinicId, t.chargeId),
  check("line_positive_quantity", sql`${t.quantity} > 0`), check("line_nonnegative", sql`${t.unitAmountMinor} >= 0`),
  check("line_amount_is_quantity_times_unit", sql`${t.amountMinor} = ${t.quantity} * ${t.unitAmountMinor}`)]);
