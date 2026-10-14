const UNIQUE_VIOLATION = "23505";

// Drizzle wraps driver errors in DrizzleQueryError and puts the original on `cause`, so a
// Postgres error code sits below one or more links rather than on the thrown error itself.
// Reading it off the top-level error silently never matches, which turns a lost race on a
// unique index into a generic fault instead of a recoverable, explainable conflict.
export function isUniqueViolation(error: unknown, depth = 5): boolean {
  if (depth <= 0 || typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  return isUniqueViolation((error as { cause?: unknown }).cause, depth - 1);
}
