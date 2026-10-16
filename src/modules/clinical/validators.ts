import { z } from "zod";

export const noteStatusSchema = z.enum(["draft", "signed", "amended"]);
export type NoteStatus = z.infer<typeof noteStatusSchema>;

export const openEncounterSchema = z.object({ appointmentId: z.uuid() });
const content = z.string().min(1, "A note needs content before it can be saved.").max(20_000, "This note has reached its maximum length.");
// Revision travels with every write so a stale editor cannot silently overwrite a newer save.
export const noteDraftSchema = z.object({ encounterId: z.uuid(), versionId: z.uuid(), revision: z.coerce.number().int().positive(), content });
export const signNoteSchema = z.object({ encounterId: z.uuid(), versionId: z.uuid(), revision: z.coerce.number().int().positive() });
export const amendNoteSchema = z.object({
  encounterId: z.uuid(), versionId: z.uuid(), revision: z.coerce.number().int().positive(), content,
  reason: z.string().trim().min(10, "Record why this note is being amended.").max(1000),
});
export const completeEncounterSchema = z.object({
  encounterId: z.uuid(),
  summary: z.string().trim().min(20, "Write a visit summary the patient will read.").max(5_000, "Use no more than 5000 characters."),
});
export const draftRequestSchema = z.object({ encounterId: z.uuid(), observations: z.string().trim().max(2_000).default("") });
// Values arrive as strings from a form; the catalogue's bounds are checked in the service,
// which is where the reference range for each measurement lives.
export const vitalsSchema = z.object({
  encounterId: z.uuid(),
  readings: z.record(z.string().regex(/^[a-z_]{2,40}$/), z.string().trim()).default({}),
});
export const problemSchema = z.object({ encounterId: z.uuid(), description: z.string().trim().min(3, "Describe the problem.").max(200) });
export const problemStatusSchema = z.object({ encounterId: z.uuid(), problemId: z.uuid(), status: z.enum(["active", "resolved"]) });
export const allergySchema = z.object({
  encounterId: z.uuid(),
  substance: z.string().trim().min(2, "Name the substance.").max(120),
  reaction: z.string().trim().min(2, "Describe the reaction.").max(200),
  severity: z.enum(["mild", "moderate", "severe"], { error: "Choose a severity." }),
});

export class NoteConflictError extends Error {
  constructor() { super("This note was saved elsewhere after you opened it. Reload to continue from the current version."); this.name = "NoteConflictError"; }
}
export class EncounterStateError extends Error {
  constructor(message: string) { super(message); this.name = "EncounterStateError"; }
}
