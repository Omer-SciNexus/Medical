import { z } from "zod";

/** Money is entered in major units and stored in minor ones, so no rounding happens later. */
const majorUnits = z.coerce.number().min(0, "A price cannot be negative.").max(1_000_000)
  .refine((value) => Number.isFinite(value), { message: "Enter a price." });
export const serviceSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, "Use 2 to 20 characters: capitals, digits and hyphens.").max(20),
  name: z.string().trim().min(3, "Name this service.").max(120),
  amountMajor: majorUnits,
  isDefault: z.union([z.boolean(), z.literal("on"), z.literal("")]).transform((value) => value === true || value === "on"),
});
export const serviceIdSchema = z.object({ serviceId: z.uuid() });
export const serviceStateSchema = z.object({ serviceId: z.uuid(), active: z.union([z.boolean(), z.literal("true"), z.literal("false")]).transform((value) => value === true || value === "true") });
export const chargeLineSchema = z.object({
  encounterId: z.uuid(),
  serviceId: z.uuid("Choose a service."),
  quantity: z.coerce.number().int().min(1, "At least one.").max(99),
});
export const lineIdSchema = z.object({ encounterId: z.uuid(), lineId: z.uuid() });
export const paymentSchema = z.object({
  chargeId: z.uuid(),
  method: z.enum(["cash", "card", "transfer", "insurance"], { error: "Choose how it was paid." }),
});
export const voidSchema = z.object({
  chargeId: z.uuid(),
  reason: z.string().trim().min(5, "Say why this invoice is being voided.").max(300),
});

export class BillingError extends Error {
  constructor(message: string) { super(message); this.name = "BillingError"; }
}
