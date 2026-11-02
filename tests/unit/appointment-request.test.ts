import { describe, expect, it } from "vitest";
import { appointmentRequestSchema, formatRequestCode, requestCodeSchema, requestTokenSchema } from "../../src/modules/scheduling/validators";

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
  it("reads a clinic code however it was typed, but only from the code alphabet", () => {
    expect(requestCodeSchema.parse(" k7m4-qx9p ")).toBe("K7M4QX9P");
    expect(requestCodeSchema.parse("K7M4 QX9P")).toBe("K7M4QX9P");
    // 0, O, 1, I and L are left out of codes so they cannot be misread.
    for (const code of ["K7M4QX9", "K7M4QX9PP", "K7M4QX90", "K7M4QX9O", "K7M4QX9I", "K7M4QX9L", ""]) expect(requestCodeSchema.safeParse(code).success).toBe(false);
  });
  it("prints a code in two groups of four", () => {
    expect(formatRequestCode("K7M4QX9P")).toBe("K7M4-QX9P");
  });
});
