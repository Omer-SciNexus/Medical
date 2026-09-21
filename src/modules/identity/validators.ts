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
const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254));
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(256) });
export const registrationSchema = z.object({
  displayName: z.string().trim().min(2, "Enter your full name.").max(100),
  clinicName: z.string().trim().min(2, "Enter your clinic name.").max(120),
  email: emailSchema,
  password: z.string().min(15, "Use at least 15 characters for your password.").max(128, "Use no more than 128 characters."),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Your passwords don’t match." });
export const challengeSchema = z.object({ challenge: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^(\d{6}|[A-F0-9]{8}-[A-F0-9]{8})$/) });
export const emergencySchema = z.object({ patientId: z.uuid(), reason: z.string().trim().min(20).max(1000) });
