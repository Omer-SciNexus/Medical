import { describe, expect, it } from "vitest";
import { appointmentRequestSchema, requestTokenSchema } from "../../src/modules/scheduling/validators";

const valid = { clinicId: "00000000-0000-4000-8000-000000000001", givenName: " Ayse ", surname: "Yilmaz", birthDate: "1990-05-14", contactEmail: " Ayse@Example.TEST ", contactPhone: "", reason: "Recurring headaches", preferredTimes: "" };

describe("an appointment request", () => {
  it("trims names, lowercases the address and drops empty optional fields", () => {
    const parsed = appointmentRequestSchema.parse(valid);
    expect(parsed).toMatchObject({ givenName: "Ayse", contactEmail: "ayse@example.test", reason: "Recurring headaches" });
    expect(parsed.contactPhone).toBeUndefined();
    expect(parsed.preferredTimes).toBeUndefined();
  });
  it("refuses a missing clinic, a bad address, a malformed birth date and a reason outside 3 to 200 characters", () => {
    for (const change of [{ clinicId: "not-a-clinic" }, { contactEmail: "nobody" }, { birthDate: "14/05/1990" }, { reason: "ok" }, { reason: "x".repeat(201) }]) {
      expect(appointmentRequestSchema.safeParse({ ...valid, ...change }).success).toBe(false);
    }
  });
  it("caps the free-text fields", () => {
    expect(appointmentRequestSchema.safeParse({ ...valid, preferredTimes: "x".repeat(301) }).success).toBe(false);
    expect(appointmentRequestSchema.safeParse({ ...valid, contactPhone: "1".repeat(33) }).success).toBe(false);
  });
  it("accepts only a 64-character hex confirmation token", () => {
    expect(requestTokenSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(requestTokenSchema.safeParse("a".repeat(63)).success).toBe(false);
    expect(requestTokenSchema.safeParse("Z".repeat(64)).success).toBe(false);
  });
});
