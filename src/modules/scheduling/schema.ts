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

// A weekly pattern in clinic-local minutes from midnight. Slots are generated from these;
// overlap between two patterns for one provider is refused by no_template_overlap.
export const availabilityTemplates = pgTable("availability_templates", {
  ...recordColumns(),
  providerId: uuid("provider_id").notNull(),
  weekday: integer("weekday").notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  slotMinutes: integer("slot_minutes").notNull(),
}, (t) => [uniqueIndex("templates_clinic_id_unique").on(t.clinicId, t.id), index("template_provider_lookup").on(t.clinicId, t.providerId, t.weekday),
  check("template_weekday", sql`${t.weekday} BETWEEN 0 AND 6`),
  check("template_window", sql`${t.startMinute} >= 0 AND ${t.endMinute} > ${t.startMinute} AND ${t.endMinute} <= 1440`),
  check("template_divides_evenly", sql`${t.slotMinutes} BETWEEN 5 AND 240 AND (${t.endMinute} - ${t.startMinute}) % ${t.slotMinutes} = 0`)]);

export const scheduleBlackouts = pgTable("schedule_blackouts", {
  ...recordColumns(),
  /** Null covers the whole clinic, such as a public holiday. */
  providerId: uuid("provider_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
}, (t) => [uniqueIndex("blackouts_clinic_id_unique").on(t.clinicId, t.id), index("blackout_lookup").on(t.clinicId, t.startsAt),
  check("blackout_positive_duration", sql`${t.endsAt} > ${t.startsAt}`)]);

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

export const appointmentRequestStatus = pgEnum("appointment_request_status", ["pending", "resolved", "declined"]);

// Written only once the requester has confirmed their address, and by nobody signed in, so the
// usual created_by/updated_by columns do not apply. resolved_by names the staff member instead.
export const appointmentRequests = pgTable("appointment_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  status: appointmentRequestStatus("status").default("pending").notNull(),
  givenName: text("given_name").notNull(),
  surname: text("surname").notNull(),
  birthDate: date("birth_date").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  reason: text("reason").notNull(),
  preferredTimes: text("preferred_times"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by"),
  resolution: text("resolution"),
  linkedPatientId: uuid("linked_patient_id"),
}, (t) => [index("appointment_request_queue").on(t.clinicId, t.status, t.createdAt),
  check("appointment_request_settled", sql`(${t.status} = 'pending') = (${t.resolvedAt} IS NULL AND ${t.resolvedBy} IS NULL)`)]);

export const followUpStatus = pgEnum("follow_up_status", ["pending", "booked", "closed"]);

// A clinician asking to see a patient again. Booking with that clinician satisfies it, and
// cancelling or missing that booking reopens it, so nobody drops out of care unnoticed.
export const followUps = pgTable("follow_ups", {
  ...recordColumns(),
  patientId: uuid("patient_id").notNull(),
  providerId: uuid("provider_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  dueOn: date("due_on").notNull(),
  /** Written for the patient. It may be clinical, so it stays out of mail and the front-desk list. */
  note: text("note"),
  status: followUpStatus("status").default("pending").notNull(),
  appointmentId: uuid("appointment_id"),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  closedReason: text("closed_reason"),
}, (t) => [uniqueIndex("follow_up_encounter").on(t.encounterId), index("follow_up_worklist").on(t.clinicId, t.status, t.dueOn), index("follow_up_patient").on(t.clinicId, t.patientId, t.status),
  index("follow_up_appointment").on(t.appointmentId),
  check("follow_up_booking", sql`(${t.status} = 'booked') = (${t.appointmentId} IS NOT NULL)`),
  check("follow_up_closed_reason", sql`(${t.status} = 'closed') = (${t.closedReason} IS NOT NULL)`)]);

export const waitlistStatus = pgEnum("waitlist_status", ["waiting", "booked", "left"]);

// With an appointment, the patient wants that visit moved earlier. Without one, they want a first
// time with this clinician. A patient waits once per clinician.
export const waitlistEntries = pgTable("waitlist_entries", {
  ...recordColumns(),
  patientId: uuid("patient_id").notNull(),
  providerId: uuid("provider_id").notNull(),
  appointmentId: uuid("appointment_id"),
  reason: text("reason").notNull(),
  status: waitlistStatus("status").default("waiting").notNull(),
}, (t) => [uniqueIndex("waitlist_entries_clinic_id_unique").on(t.clinicId, t.id),
  uniqueIndex("waitlist_one_active").on(t.clinicId, t.patientId, t.providerId).where(sql`${t.status} = 'waiting' AND ${t.deletedAt} IS NULL`),
  index("waitlist_queue").on(t.clinicId, t.providerId, t.status, t.createdAt), index("waitlist_appointment").on(t.appointmentId)]);
