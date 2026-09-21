import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "../../src/modules/identity/errors";
import { challengeSchema, loginSchema, registrationSchema } from "../../src/modules/identity/validators";

const mock = vi.hoisted(() => ({ cookies: new Map<string, string>(), set: vi.fn(), remove: vi.fn(), begin: vi.fn(), register: vi.fn(), finish: vi.fn(), revoke: vi.fn(), setSession: vi.fn(), configured: vi.fn(), sameOrigin: vi.fn(), cookieOptions: vi.fn(), log: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => mock.cookies.has(key) ? { value: mock.cookies.get(key) } : undefined, set: mock.set, delete: mock.remove }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("../../src/modules/identity", () => ({ AuthenticationError, challengeSchema, loginSchema, registrationSchema, SESSION_COOKIE: "meridian_session", beginSignIn: mock.begin, registerWorkspace: mock.register, finishSignIn: mock.finish, revokeSession: mock.revoke, setSessionCookie: mock.setSession, authConfigured: mock.configured, assertSameOrigin: mock.sameOrigin, authCookieOptions: mock.cookieOptions }));
vi.mock("../../src/platform/log", () => ({ logOperational: mock.log }));
import { signInAction, signUpAction, verifyAction, signOutAction } from "../../src/app/(auth)/actions";
const credentials = { step: "credentials" as const };
const password = "A memorable test passphrase";
function form(data: Record<string, string>) { const value = new FormData(); for (const [key, entry] of Object.entries(data)) value.set(key, entry); return value; }
beforeEach(() => { vi.resetAllMocks(); mock.cookies.clear(); mock.configured.mockReturnValue(true); mock.sameOrigin.mockResolvedValue("http://127.0.0.1:4000"); mock.cookieOptions.mockResolvedValue({ httpOnly: true, sameSite: "strict", secure: false, path: "/" }); });

describe("authentication action boundary", () => {
  it("validates empty credentials before calling account services", async () => {
    const result = await signInAction(credentials, form({ email: "bad", password: "" }));
    expect(result.errors?.email).toBeDefined(); expect(result.errors?.password).toBeDefined(); expect(mock.begin).not.toHaveBeenCalled();
  });
  it("normalizes email, strips client role and clinic claims, and protects the MFA token", async () => {
    mock.register.mockResolvedValue({ kind: "enroll_mfa", challenge: "a".repeat(64), provisioningUri: "otpauth://totp/Meridian:test?secret=TESTSECRET&issuer=Meridian" });
    const result = await signUpAction(credentials, form({ displayName: " Test Owner ", clinicName: " Test Clinic ", email: " USER@EXAMPLE.TEST ", password, confirmPassword: password, role: "clinician", clinicId: "existing-clinic" }));
    expect(mock.register).toHaveBeenCalledWith({ displayName: "Test Owner", clinicName: "Test Clinic", email: "user@example.test", password, confirmPassword: password }, "public-web");
    expect(result).toEqual({ step: "enroll_mfa", secret: "TESTSECRET" });
    expect(mock.set).toHaveBeenCalledWith("meridian_challenge", "a".repeat(64), expect.objectContaining({ httpOnly: true, sameSite: "strict", maxAge: 300 }));
    expect(mock.setSession).not.toHaveBeenCalled();
  });
  it("rejects a weak password and mismatched confirmation", async () => {
    const result = await signUpAction(credentials, form({ displayName: "Test Owner", clinicName: "Test Clinic", email: "user@example.test", password: "short", confirmPassword: "different" }));
    expect(result.errors?.password).toBeDefined(); expect(result.errors?.confirmPassword).toBeDefined(); expect(mock.register).not.toHaveBeenCalled();
  });
  it("rejects an unapproved request origin before any service work", async () => {
    mock.sameOrigin.mockRejectedValue(new AuthenticationError("Request rejected."));
    expect((await signInAction(credentials, form({ email: "user@example.test", password }))).error).toBe("Request rejected.");
    expect(mock.begin).not.toHaveBeenCalled();
  });
  it("does not leak connection details on a backend failure", async () => {
    mock.begin.mockRejectedValue(new Error("postgres://password@internal-host/private"));
    const result = await signInAction(credentials, form({ email: "user@example.test", password }));
    expect(result.error).toContain("Account services are not available"); expect(JSON.stringify(result)).not.toContain("postgres"); expect(mock.setSession).not.toHaveBeenCalled();
  });
  it("preserves generic credential failure messages", async () => {
    mock.begin.mockRejectedValue(new AuthenticationError("The sign-in details could not be verified."));
    expect((await signInAction(credentials, form({ email: "user@example.test", password }))).error).toBe("The sign-in details could not be verified.");
  });
  it("rotates an existing session and redirects only after setting the new cookie", async () => {
    mock.cookies.set("meridian_session", "old-token"); mock.begin.mockResolvedValue({ kind: "session", token: "new-token", expiresAt: Date.now() });
    await expect(signInAction(credentials, form({ email: "user@example.test", password }))).rejects.toThrow("REDIRECT:/dashboard");
    expect(mock.revoke).toHaveBeenCalledWith("old-token"); expect(mock.setSession).toHaveBeenCalledWith("new-token"); expect(mock.remove).toHaveBeenCalledWith("meridian_challenge");
  });
  it("ignores a supplied challenge and requires the HttpOnly challenge cookie", async () => {
    const result = await verifyAction({ step: "verify_mfa" }, form({ code: "123456", challenge: "client-forged" }));
    expect(result.step).toBe("credentials"); expect(mock.finish).not.toHaveBeenCalled();
  });
  it("returns recovery codes once without returning a session token", async () => {
    mock.cookies.set("meridian_challenge", "cookie-token"); mock.finish.mockResolvedValue({ kind: "session", token: "private-token", expiresAt: Date.now(), recoveryCodes: ["12345678-ABCDEF12"] });
    const result = await verifyAction({ step: "enroll_mfa" }, form({ code: " 123456 ", challenge: "client-forged" }));
    expect(mock.finish).toHaveBeenCalledWith({ challenge: "cookie-token", code: "123456" });
    expect(result).toEqual({ step: "recovery_codes", recoveryCodes: ["12345678-ABCDEF12"] }); expect(mock.setSession).toHaveBeenCalledWith("private-token");
  });
  it("revokes server state before deleting the cookie on sign-out", async () => {
    mock.cookies.set("meridian_session", "old-token");
    await expect(signOutAction()).rejects.toThrow("REDIRECT:/sign-in");
    expect(mock.revoke).toHaveBeenCalledWith("old-token"); expect(mock.remove).toHaveBeenCalledWith("meridian_session");
  });
  it("retains the cookie if revocation fails so sign-out can be retried", async () => {
    mock.cookies.set("meridian_session", "old-token"); mock.revoke.mockRejectedValue(new Error("Unavailable"));
    await expect(signOutAction()).rejects.toThrow("Unavailable"); expect(mock.remove).not.toHaveBeenCalled();
  });
});
