import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, digest } from "../../src/modules/identity/crypto";
import { hasFreshTotp, roleAllowsPurpose } from "../../src/modules/identity/policy";
import type { Actor, AccessPurpose } from "../../src/modules/identity/validators";

beforeAll(() => { process.env.AUTH_PEPPER = "unit-test-pepper-only-32-characters-long"; process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); });
const actor: Actor = { id: "00000000-0000-4000-8000-000000000001", clinicId: "00000000-0000-4000-8000-000000000002", role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: 1000, mfaVerifiedAt: 1000 };
const purposes: AccessPurpose[] = ["patient.view", "scheduling", "clinical.read", "clinical.write", "prescribe"];
describe("role and purpose gate", () => {
  for (const role of ["patient", "clinician", "staff", "admin"] as const) {
    const allowed: string[] = { patient: ["patient.view", "scheduling"], clinician: ["scheduling", "clinical.read", "clinical.write", "prescribe"], staff: ["scheduling"], admin: [] }[role];
    for (const purpose of purposes) it(`${role} ${allowed.includes(purpose) ? "may request" : "cannot request"} ${purpose}`, () => { expect(roleAllowsPurpose({ ...actor, role }, purpose)).toBe(allowed.includes(purpose)); });
  }
  it.each(["clinician", "staff", "admin"] as const)("denies non-MFA %s for every purpose", (role) => { for (const purpose of purposes) expect(roleAllowsPurpose({ ...actor, role, mfaVerified: false }, purpose)).toBe(false); });
  it("requires fresh TOTP, including rejecting future timestamps and recovery-only sessions", () => {
    expect(hasFreshTotp(actor, 2000)).toBe(true);
    expect(hasFreshTotp(actor, 302000)).toBe(false);
    expect(hasFreshTotp(actor, 500)).toBe(false);
    expect(hasFreshTotp({ ...actor, mfaVerifiedAt: null }, 2000)).toBe(false);
  });
});
describe("credential protection", () => {
  it("salts password hashes and rejects incorrect passwords and malformed hashes", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(await verifyPassword("correct horse battery staple", first)).toBe(true);
    expect(await verifyPassword("incorrect", first)).toBe(false);
    expect(await verifyPassword("incorrect", "invalid")).toBe(false);
  });
  it("encrypts secrets with random IVs and rejects tampering", () => {
    const value = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(value);
    expect(encrypted).not.toContain(value);
    expect(encryptSecret(value)).not.toBe(encrypted);
    expect(decryptSecret(encrypted)).toBe(value);
    const [iv, tag, data] = encrypted.split(".");
    const tampered = Buffer.from(data, "base64url"); tampered[0] ^= 1;
    expect(() => decryptSecret(`${iv}.${tag}.${tampered.toString("base64url")}`)).toThrow();
  });
  it("requires configured secret material", () => {
    const previous = process.env.AUTH_PEPPER;
    process.env.AUTH_PEPPER = "short";
    expect(() => digest("session-token")).toThrow();
    process.env.AUTH_PEPPER = previous;
  });
});
