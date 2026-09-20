import { z } from "zod";

export const roleSchema = z.enum(["patient", "clinician", "staff", "admin"]);
export const purposeSchema = z.enum(["patient.view", "scheduling", "clinical.read", "clinical.write", "prescribe"]);
export const actorSchema = z.object({
  id: z.uuid(), clinicId: z.uuid(), role: roleSchema, patientId: z.uuid().nullable(),
  mfaVerified: z.boolean(), authenticatedAt: z.number().int().positive(),
  mfaVerifiedAt: z.number().int().positive().nullable(),
});
export type Actor = z.infer<typeof actorSchema>;
export type AccessPurpose = z.infer<typeof purposeSchema>;
export const loginSchema = z.object({ email: z.email().max(254).transform((v) => v.trim().toLowerCase()), password: z.string().min(1).max(256) });
export const challengeSchema = z.object({ challenge: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^(\d{6}|[A-F0-9]{8}-[A-F0-9]{8})$/) });
export const emergencySchema = z.object({ patientId: z.uuid(), reason: z.string().trim().min(20).max(1000) });
