import "server-only";
import nodemailer from "nodemailer";
import { logOperational } from "./log";

type Message = { to: string; subject: string; text: string; idempotencyKey?: string };
const sender = () => process.env.MAIL_FROM ?? "Meridian <no-reply@meridian.invalid>";
const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

/**
 * Transport seam. With no provider configured the call is a no-op, which is the development
 * default: every flow that sends mail also returns its link to the authorized caller, so the
 * demo works without a provider and a delivery failure never blocks the operation that
 * triggered it. SMTP (a Gmail app password, say) wins over the HTTP API when both are set.
 * Account mail only — nothing here ever carries clinical detail.
 */
export async function sendMail(message: Message) {
  if (smtpConfigured()) return sendSmtp(message);
  const apiKey = process.env.MAIL_API_KEY;
  if (!apiKey) return { delivered: false as const, configured: false as const };
  try {
    const response = await fetch(process.env.MAIL_API_URL ?? "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}) },
      body: JSON.stringify({ from: sender(), to: message.to, subject: message.subject, text: message.text }),
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
async function sendSmtp(message: Message) {
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 8_000,
  });
  try {
    // SMTP has no idempotency header; a stable Message-ID lets the receiving client fold a
    // retried job's duplicate into the original.
    await transport.sendMail({ from: sender(), to: message.to, subject: message.subject, text: message.text,
      ...(message.idempotencyKey ? { messageId: `<${message.idempotencyKey}@meridian.mail>` } : {}) });
    return { delivered: true as const, configured: true as const };
  } catch {
    logOperational("job.failed", { code: "MAIL_SMTP_FAILED" });
    return { delivered: false as const, configured: true as const };
  } finally {
    transport.close();
  }
}
export function mailConfigured() { return smtpConfigured() || Boolean(process.env.MAIL_API_KEY); }

/** Background delivery must fail the job when the provider has not accepted the message. */
export class MailDeliveryError extends Error {
  constructor() { super("Mail delivery was not accepted. Check provider configuration and retry."); this.name = "MailDeliveryError"; }
}
export async function sendJobMail(message: Parameters<typeof sendMail>[0]) {
  const result = await sendMail(message);
  if (!result.delivered) throw new MailDeliveryError();
  return result;
}
