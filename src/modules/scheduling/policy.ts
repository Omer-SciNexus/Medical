import type { AppointmentStatus } from "./validators";

// Pure transition table. The repository still re-checks the stored revision.
const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ["checked_in", "cancelled", "no_show"],
  checked_in: ["rooming", "cancelled", "no_show"],
  rooming: ["ready", "cancelled"],
  ready: ["in_progress", "cancelled"],
  in_progress: ["done"],
  done: [], cancelled: [], no_show: [],
};
export function canTransition(from: AppointmentStatus, to: AppointmentStatus) { return transitions[from].includes(to); }
export function waitingMinutes(checkedInAt: Date | null, now = new Date()) {
  if (!checkedInAt) return null;
  return Math.max(0, Math.floor((now.getTime() - checkedInAt.getTime()) / 60_000));
}
// Staff move patients through the waiting room; only a clinician may start or finish the visit.
export function roleMayTransition(role: string, to: AppointmentStatus) {
  if (role === "clinician") return true;
  if (role === "staff") return ["checked_in", "rooming", "ready", "no_show", "cancelled"].includes(to);
  if (role === "patient") return to === "cancelled";
  return false;
}
