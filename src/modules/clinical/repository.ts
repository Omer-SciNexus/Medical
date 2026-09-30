import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/platform/db";
import { auditedPatientOperation, type Actor } from "@/modules/identity";
import { completeAppointmentInTransaction } from "@/modules/scheduling";
import { chargeEncounter, getEncounterCharge } from "@/modules/billing";
import { enqueueOutbox } from "@/platform/outbox";
import { allergies, encounters, noteVersions, observations, problems } from "./schema";
import { CONSULTATION_FEE_MINOR, SOAP_TEMPLATE, encounterIsCompletable } from "./policy";
import { EncounterStateError, NoteConflictError, type NoteStatus } from "./validators";

const noteFields = { id: noteVersions.id, version: noteVersions.version, revision: noteVersions.revision, content: noteVersions.content, template: noteVersions.template,
  status: noteVersions.status, amendmentReason: noteVersions.amendmentReason, previousVersionId: noteVersions.previousVersionId,
  signedAt: noteVersions.signedAt, signedBy: noteVersions.signedBy, updatedAt: noteVersions.updatedAt };
const encounterFields = { id: encounters.id, patientId: encounters.patientId, appointmentId: encounters.appointmentId, clinicianId: encounters.clinicianId,
  status: encounters.status, summary: encounters.summary, publishedAt: encounters.publishedAt, completedAt: encounters.completedAt };

export async function findEncounter(clinicId: string, encounterId: string, tx?: Transaction) {
  const [encounter] = await (tx ?? getDb()).select(encounterFields).from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.clinicId, clinicId), isNull(encounters.deletedAt))).limit(1);
  return encounter;
}
export async function findCurrentNote(clinicId: string, encounterId: string, tx?: Transaction) {
  const [note] = await (tx ?? getDb()).select(noteFields).from(noteVersions)
    .where(and(eq(noteVersions.clinicId, clinicId), eq(noteVersions.encounterId, encounterId), isNull(noteVersions.deletedAt)))
    .orderBy(desc(noteVersions.version)).limit(1);
  return note;
}
export async function listNoteHistory(clinicId: string, encounterId: string, tx?: Transaction) {
  return (tx ?? getDb()).select(noteFields).from(noteVersions)
    .where(and(eq(noteVersions.clinicId, clinicId), eq(noteVersions.encounterId, encounterId), isNull(noteVersions.deletedAt)))
    .orderBy(asc(noteVersions.version)).limit(50);
}
// encounter_appointment is unique, so a second clinician opening the same visit joins the
// existing encounter rather than creating a parallel one.
export async function openEncounter(actor: Actor, input: { appointmentId: string; patientId: string }) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, input.patientId, "clinical.write", "clinical.encounter_opened", async () => {
    await tx.insert(encounters).values({ clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id, patientId: input.patientId,
      appointmentId: input.appointmentId, clinicianId: actor.id }).onConflictDoNothing({ target: encounters.appointmentId });
    const [encounter] = await tx.select(encounterFields).from(encounters)
      .where(and(eq(encounters.appointmentId, input.appointmentId), eq(encounters.clinicId, actor.clinicId))).limit(1);
    if (!encounter) throw new EncounterStateError("This visit could not be opened.");
    await tx.insert(noteVersions).values({ clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id, patientId: input.patientId,
      encounterId: encounter.id, version: 1, content: SOAP_TEMPLATE }).onConflictDoNothing({ target: [noteVersions.encounterId, noteVersions.version] });
    return encounter;
  }));
}
export async function saveNoteVersion(actor: Actor, input: { encounterId: string; patientId: string; versionId: string; revision: number; content: string }) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, input.patientId, "clinical.write", "clinical.note_saved", async () => {
    const [saved] = await tx.update(noteVersions).set({ content: input.content, revision: input.revision + 1, updatedBy: actor.id })
      .where(and(eq(noteVersions.id, input.versionId), eq(noteVersions.clinicId, actor.clinicId), eq(noteVersions.encounterId, input.encounterId),
        eq(noteVersions.revision, input.revision), eq(noteVersions.status, "draft"), isNull(noteVersions.deletedAt)))
      .returning({ id: noteVersions.id, revision: noteVersions.revision, updatedAt: noteVersions.updatedAt });
    if (!saved) throw new NoteConflictError();
    return saved;
  }));
}
export async function signNoteVersion(actor: Actor, input: { encounterId: string; patientId: string; versionId: string; revision: number }) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, input.patientId, "clinical.write", "clinical.note_signed", async () => {
    const [signed] = await tx.update(noteVersions).set({ status: "signed", signedAt: new Date(), signedBy: actor.id, revision: input.revision + 1, updatedBy: actor.id })
      .where(and(eq(noteVersions.id, input.versionId), eq(noteVersions.clinicId, actor.clinicId), eq(noteVersions.encounterId, input.encounterId),
        eq(noteVersions.revision, input.revision), eq(noteVersions.status, "draft"), isNull(noteVersions.deletedAt)))
      .returning({ id: noteVersions.id, revision: noteVersions.revision, version: noteVersions.version });
    if (!signed) throw new NoteConflictError();
    return signed;
  }));
}
// Signing froze the previous text. An amendment is a new linked version; the prior row keeps
// its content and only gains the 'amended' marker, which its database trigger enforces.
export async function amendNoteVersion(actor: Actor, input: { encounterId: string; patientId: string; versionId: string; revision: number; content: string; reason: string }) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, input.patientId, "clinical.write", "clinical.note_amended", async () => {
    const [previous] = await tx.select({ id: noteVersions.id, version: noteVersions.version, status: noteVersions.status }).from(noteVersions)
      .where(and(eq(noteVersions.id, input.versionId), eq(noteVersions.clinicId, actor.clinicId), eq(noteVersions.encounterId, input.encounterId),
        eq(noteVersions.revision, input.revision), isNull(noteVersions.deletedAt))).for("update").limit(1);
    if (!previous || previous.status !== "signed") throw new NoteConflictError();
    const [created] = await tx.insert(noteVersions).values({ clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id, patientId: input.patientId,
      encounterId: input.encounterId, version: previous.version + 1, content: input.content, previousVersionId: previous.id, amendmentReason: input.reason })
      .returning({ id: noteVersions.id, version: noteVersions.version, revision: noteVersions.revision });
    // Only status and updated_by may change here; preserve_signed_note rejects anything more.
    await tx.update(noteVersions).set({ status: "amended", updatedBy: actor.id }).where(and(eq(noteVersions.id, previous.id), eq(noteVersions.clinicId, actor.clinicId)));
    return created;
  }));
}
export async function completeEncounter(actor: Actor, input: { encounterId: string; patientId: string; summary: string; currency: string }) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, input.patientId, "clinical.write", "clinical.encounter_completed", async () => {
    const [encounter] = await tx.select(encounterFields).from(encounters)
      .where(and(eq(encounters.id, input.encounterId), eq(encounters.clinicId, actor.clinicId), isNull(encounters.deletedAt))).for("update").limit(1);
    if (!encounter) throw new EncounterStateError("This visit could not be found.");
    // Repeat submissions return the committed result instead of charging twice.
    if (encounter.status === "completed") return { encounter, charge: await getEncounterCharge(tx, actor.clinicId, encounter.id), repeated: true };
    const note = await findCurrentNote(actor.clinicId, encounter.id, tx);
    if (!note || !encounterIsCompletable(encounter.status, note.status as NoteStatus)) throw new EncounterStateError("Sign the visit note before completing this visit.");
    const charge = await chargeEncounter(tx, actor, { patientId: input.patientId, encounterId: encounter.id, amountMinor: CONSULTATION_FEE_MINOR, currency: input.currency, description: "Consultation" });
    const [completed] = await tx.update(encounters).set({ status: "completed", completedAt: new Date(), summary: input.summary, publishedAt: new Date(), updatedBy: actor.id })
      .where(and(eq(encounters.id, encounter.id), eq(encounters.clinicId, actor.clinicId), eq(encounters.status, "in_progress"))).returning(encounterFields);
    if (!completed) throw new EncounterStateError("This visit was completed elsewhere. Reload to see its current state.");
    await completeAppointmentInTransaction(tx, actor, { appointmentId: encounter.appointmentId, patientId: input.patientId });
    await enqueueOutbox(tx, { clinicId: actor.clinicId, topic: "encounter.completed", resourceId: encounter.id });
    await enqueueOutbox(tx, { clinicId: actor.clinicId, topic: "visit_summary.published", resourceId: encounter.id });
    return { encounter: completed, charge, repeated: false };
  }));
}
export async function readChart(actor: Actor, patientId: string) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, patientId, "clinical.read", "clinical.chart_read", async () => {
    const [allergyRows, problemRows, observationRows] = await Promise.all([
      tx.select({ id: allergies.id, substance: allergies.substance, reaction: allergies.reaction, severity: allergies.severity }).from(allergies)
        .where(and(eq(allergies.clinicId, actor.clinicId), eq(allergies.patientId, patientId), isNull(allergies.deletedAt))).limit(50),
      tx.select({ id: problems.id, description: problems.description, status: problems.status }).from(problems)
        .where(and(eq(problems.clinicId, actor.clinicId), eq(problems.patientId, patientId), isNull(problems.deletedAt))).orderBy(asc(problems.description)).limit(50),
      tx.select({ id: observations.id, label: observations.label, value: observations.value, unit: observations.unit, flag: observations.flag,
        referenceLow: observations.referenceLow, referenceHigh: observations.referenceHigh, observedAt: observations.observedAt }).from(observations)
        .where(and(eq(observations.clinicId, actor.clinicId), eq(observations.patientId, patientId), isNull(observations.deletedAt)))
        .orderBy(desc(observations.observedAt)).limit(50),
    ]);
    return { allergies: allergyRows, problems: problemRows, observations: observationRows };
  }));
}
export async function readPublishedSummary(actor: Actor, encounterId: string, patientId: string) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, patientId, actor.role === "patient" ? "patient.view" : "clinical.read", "clinical.visit_summary_read", async () => {
    const [summary] = await tx.select({ id: encounters.id, summary: encounters.summary, publishedAt: encounters.publishedAt, completedAt: encounters.completedAt, status: encounters.status })
      .from(encounters).where(and(eq(encounters.id, encounterId), eq(encounters.clinicId, actor.clinicId), eq(encounters.patientId, patientId), isNull(encounters.deletedAt))).limit(1);
    if (!summary) return null;
    const charge = await getEncounterCharge(tx, actor.clinicId, encounterId);
    // An unpublished visit returns its state, never a draft note's text.
    return { ...summary, published: Boolean(summary.publishedAt && summary.summary), charge };
  }));
}
export async function findChargeSummary(clinicId: string, encounterId: string) {
  return getDb().transaction((tx) => getEncounterCharge(tx, clinicId, encounterId));
}
export async function listPatientEncounters(actor: Actor, patientId: string) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, patientId, actor.role === "patient" ? "patient.view" : "clinical.read", "clinical.visits_read", () =>
    tx.select({ id: encounters.id, status: encounters.status, publishedAt: encounters.publishedAt, completedAt: encounters.completedAt, createdAt: encounters.createdAt })
      .from(encounters).where(and(eq(encounters.clinicId, actor.clinicId), eq(encounters.patientId, patientId), isNull(encounters.deletedAt)))
      .orderBy(desc(encounters.createdAt)).limit(25)));
}
export async function countPatientObservations(clinicId: string, patientId: string) {
  const [row] = await getDb().select({ total: sql<number>`count(*)::int` }).from(observations)
    .where(and(eq(observations.clinicId, clinicId), eq(observations.patientId, patientId), isNull(observations.deletedAt)));
  return row?.total ?? 0;
}
