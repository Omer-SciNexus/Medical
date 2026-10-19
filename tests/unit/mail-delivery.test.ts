import { afterEach, describe, expect, it, vi } from "vitest";
import { sendJobMail, MailDeliveryError } from "../../src/platform/mailer";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("background mail acceptance", () => {
  const message = { to: "synthetic@example.test", subject: "Test", text: "Synthetic", idempotencyKey: "stable-job-key" };
  it("fails the job when the provider is unconfigured", async () => {
    vi.stubEnv("MAIL_API_KEY", "");
    await expect(sendJobMail(message)).rejects.toBeInstanceOf(MailDeliveryError);
  });
  it("fails on provider errors and preserves the idempotency key on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("MAIL_API_KEY", "test-only");
    const transport = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", transport);
    await expect(sendJobMail(message)).rejects.toBeInstanceOf(MailDeliveryError);
    await expect(sendJobMail(message)).resolves.toMatchObject({ delivered: true });
    for (const call of transport.mock.calls) expect(call[1].headers["Idempotency-Key"]).toBe("stable-job-key");
  });
});
