const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";

// Drizzle wraps driver errors in DrizzleQueryError and puts the original on `cause`, so a
// Postgres error code sits below one or more links rather than on the thrown error itself.
// Reading it off the top-level error silently never matches, which turns a lost race on a
// unique index into a generic fault instead of a recoverable, explainable conflict.
export function isUniqueViolation(error: unknown, depth = 5): boolean {
  return hasSqlState(error, UNIQUE_VIOLATION, depth);
}
/** An EXCLUDE constraint refusing an overlap, such as two slots for one provider. */
export function isExclusionViolation(error: unknown, depth = 5): boolean {
  return hasSqlState(error, EXCLUSION_VIOLATION, depth);
}
function hasSqlState(error: unknown, state: string, depth: number): boolean {
  if (depth <= 0 || typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === state) return true;
  return hasSqlState((error as { cause?: unknown }).cause, state, depth - 1);
}
