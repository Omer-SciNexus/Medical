import "server-only";
import { logOperational } from "./log";

/**
 * Transport seam. With no provider configured the call is a no-op, which is the development
 * default: every flow that sends mail also returns its link to the authorized caller, so the
 * demo works without a provider and a delivery failure never blocks the operation that
 * triggered it. Account mail only — nothing here ever carries clinical detail.
 */
export async function sendMail(message: { to: string; subject: string; text: string; idempotencyKey?: string }) {
  const apiKey = process.env.MAIL_API_KEY;
  if (!apiKey) return { delivered: false as const, configured: false as const };
  try {
    const response = await fetch(process.env.MAIL_API_URL ?? "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}) },
      body: JSON.stringify({ from: process.env.MAIL_FROM ?? "Meridian <no-reply@meridian.invalid>", to: message.to, subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) logOperational("job.failed", { code: `MAIL_HTTP_${response.status}` });
    return { delivered: response.ok, configured: true as const };
  } catch {
    // Never log the recipient or the body: the subject line is the only safe detail, and even
    // that is dropped in favour of a fixed code.
    logOperational("job.failed", { code: "MAIL_SEND_FAILED" });
    return { delivered: false as const, configured: true as const };
  }
}
export function mailConfigured() { return Boolean(process.env.MAIL_API_KEY); }

/** Background delivery must fail the job when the provider has not accepted the message. */
export class MailDeliveryError extends Error {
  constructor() { super("Mail delivery was not accepted. Check provider configuration and retry."); this.name = "MailDeliveryError"; }
}
export async function sendJobMail(message: Parameters<typeof sendMail>[0]) {
  const result = await sendMail(message);
  if (!result.delivered) throw new MailDeliveryError();
  return result;
}
