import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ origin: "https://clinic.example", set: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => mock.origin }), cookies: async () => ({ set: mock.set }) }));
import { assertSameOrigin, setSessionCookie } from "../../src/modules/identity/http";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("authentication origin and cookie policy", () => {
  it("rejects a matching hostname from an unapproved port or scheme", async () => {
    vi.stubEnv("APP_ORIGIN", "https://clinic.example"); vi.stubEnv("APP_ADDITIONAL_ORIGINS", ""); mock.origin = "http://clinic.example";
    await expect(assertSameOrigin()).rejects.toThrow(); mock.origin = "https://clinic.example:4000"; await expect(assertSameOrigin()).rejects.toThrow();
  });
  it("uses Secure and HttpOnly cookies on the configured HTTPS site", async () => {
    vi.stubEnv("APP_ORIGIN", "https://clinic.example"); mock.origin = "https://clinic.example";
    await setSessionCookie("token"); expect(mock.set).toHaveBeenCalledWith("meridian_session", "token", expect.objectContaining({ secure: true, httpOnly: true, sameSite: "strict" }));
  });
  it("supports only known loopback origins without deployment configuration", async () => {
    vi.stubEnv("APP_ORIGIN", ""); mock.origin = "http://127.0.0.1:4001"; await setSessionCookie("token");
    expect(mock.set).toHaveBeenCalledWith("meridian_session", "token", expect.objectContaining({ secure: false, httpOnly: true }));
    mock.origin = "https://unconfigured.example"; await expect(assertSameOrigin()).rejects.toThrow();
  });
  it("rejects plain HTTP deployment origins even when explicitly configured", async () => {
    vi.stubEnv("APP_ORIGIN", "http://clinic.example"); mock.origin = "http://clinic.example"; await expect(assertSameOrigin()).rejects.toThrow();
  });
});
