import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendJobMail, sendMail, mailConfigured, MailDeliveryError } from "../../src/platform/mailer";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.createTransport } }));

beforeEach(() => {
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail, close: smtp.close });
  for (const name of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) vi.stubEnv(name, "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); smtp.sendMail.mockReset(); smtp.close.mockReset(); });
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
describe("SMTP delivery", () => {
  const message = { to: "synthetic@example.test", subject: "Test", text: "Synthetic", idempotencyKey: "stable-job-key" };
  beforeEach(() => {
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    vi.stubEnv("SMTP_USER", "sender@example.test");
    vi.stubEnv("SMTP_PASS", "test-only");
    vi.stubEnv("MAIL_FROM", "Meridian <sender@example.test>");
  });
  it("is preferred over the HTTP provider and counts as configured", async () => {
    vi.stubEnv("MAIL_API_KEY", "test-only");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    smtp.sendMail.mockResolvedValueOnce({ messageId: "accepted" });
    expect(mailConfigured()).toBe(true);
    await expect(sendMail(message)).resolves.toEqual({ delivered: true, configured: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(smtp.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "Meridian <sender@example.test>", to: message.to, messageId: "<stable-job-key@meridian.mail>" }));
    expect(smtp.close).toHaveBeenCalled();
  });
  it("reports a rejected message as undelivered and fails the job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    smtp.sendMail.mockRejectedValueOnce(new Error("535 authentication failed"));
    await expect(sendJobMail(message)).rejects.toBeInstanceOf(MailDeliveryError);
    expect(smtp.close).toHaveBeenCalled();
  });
});
