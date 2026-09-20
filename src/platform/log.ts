// Allowlist, rather than trying to anticipate every possible PHI field.
type OperationalEvent = "database.unavailable" | "redis.unavailable" | "job.failed" | "request.failed";
export function logOperational(event: OperationalEvent, context: { requestId?: string; code?: string } = {}) {
  const uuid = /^[0-9a-f-]{36}$/i;
  const code = /^[A-Z_0-9]{1,40}$/;
  console.error(JSON.stringify({ event, timestamp: new Date().toISOString(),
    requestId: context.requestId && uuid.test(context.requestId) ? context.requestId : undefined,
    code: context.code && code.test(context.code) ? context.code : "REDACTED",
  }));
}
