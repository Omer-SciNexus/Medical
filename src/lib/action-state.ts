/** Machine-readable outcome, so the UI never has to match on an error message. */
export type ActionCode = "conflict" | "slot_taken" | "state" | "denied" | "invalid" | "unavailable";
export type ActionState = {
  ok?: boolean;
  code?: ActionCode;
  error?: string;
  errors?: Record<string, string[] | undefined>;
  /** Echoed back so a rejected submission can restore what the user had chosen. */
  values?: Record<string, string>;
  revision?: number;
  savedAt?: number;
  draft?: string;
  /** A single-use link returned to the authorized caller, shown once and never stored. */
  link?: string;
  delivered?: boolean;
};
export const idleAction: ActionState = {};
