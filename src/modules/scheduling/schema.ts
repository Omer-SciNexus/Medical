import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, uuid, date, timestamp, integer, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { recordColumns } from "@/platform/columns";

export const appointmentStatus = pgEnum("appointment_status", ["booked", "checked_in", "rooming", "ready", "in_progress", "done", "cancelled", "no_show"]);

export const patients = pgTable("patients", {
  ...recordColumns(),
  givenName: text("given_name").notNull(),
  surname: text("surname").notNull(),
  birthDate: date("birth_date").notNull(),
  sex: text("sex").notNull(),
  mrn: text("mrn").notNull(),
}, (t) => [uniqueIndex("patient_clinic_mrn").on(t.clinicId, t.mrn), uniqueIndex("patients_clinic_id_unique").on(t.clinicId, t.id), index("patient_name_lookup").on(t.clinicId, t.surname), check("patient_sex", sql`${t.sex} IN ('female', 'male', 'intersex', 'unknown')`)]);

export const availabilitySlots = pgTable("availability_slots", {
  ...recordColumns(),
  providerId: uuid("provider_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("slots_clinic_id_unique").on(t.clinicId, t.id), index("slot_availability_lookup").on(t.clinicId, t.providerId, t.startsAt), check("slot_positive_duration", sql`${t.endsAt} > ${t.startsAt}`)]);

export const appointments = pgTable("appointments", {
  ...recordColumns(),
  patientId: uuid("patient_id").notNull(),
  slotId: uuid("slot_id").notNull(),
  reason: text("reason").notNull(),
  preparation: text("preparation").default("").notNull(),
  status: appointmentStatus("status").default("booked").notNull(),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  revision: integer("revision").default(1).notNull(),
}, (t) => [uniqueIndex("appointments_clinic_id_unique").on(t.clinicId, t.id),
  uniqueIndex("active_slot_booking").on(t.slotId).where(sql`${t.deletedAt} IS NULL AND ${t.status} <> 'cancelled'`),
  index("patient_appointments").on(t.clinicId, t.patientId)]);
