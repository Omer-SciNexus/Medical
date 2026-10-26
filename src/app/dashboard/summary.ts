import "server-only";
import { listPeople, type Actor } from "@/modules/identity";
import { getClinicianQueue, getWaitingRoomBoard, getScheduleAuthoring, listMyAppointments } from "@/modules/scheduling";
import { listMyVisits } from "@/modules/clinical";
import type { DashboardSummary } from "@/components/app/dashboard-overview";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const terminal = new Set(["cancelled", "done", "no_show"]);
const waiting = new Set(["checked_in", "rooming", "ready"]);
const statusLabels: Record<string, string> = { booked: "Booked", checked_in: "Arrived", rooming: "Rooming", ready: "Ready", in_progress: "In consultation", done: "Completed", cancelled: "Cancelled", no_show: "No-show" };

/** Read through the existing role-scoped, audited services; never widen access for the overview. */
export async function readDashboardSummary(actor: Actor, timeZone: string, now = new Date()): Promise<DashboardSummary> {
  const formatTime = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  if (actor.role === "admin") {
    const [team, schedule] = await Promise.all([listPeople(actor), getScheduleAuthoring(actor)]);
    const active = team.people.filter(person => person.active && person.role !== "patient");
    const pending = team.invitations.filter(item => !item.consumedAt && !item.revokedAt && item.expiresAt.getTime() > now.getTime()).length;
    const hasClinician = active.some(person => person.role === "clinician");
    return {
      metrics: [
        { label: "Active team accounts", value: active.length, hint: "Colleagues with clinic access", href: "/admin/people", icon: "people" },
        { label: "Pending invitations", value: pending, hint: "Valid invitations awaiting acceptance", href: "/admin/people", icon: "clock" },
        { label: "Weekly sessions", value: schedule.templates.length, hint: "Your recurring availability pattern", href: "/admin/schedule", icon: "calendar" },
      ],
      focus: !hasClinician ? { title: "Great care starts with your team.", description: "Invite a clinician to join your workspace, then set up their weekly availability.", href: "/admin/people", action: "Manage your team" } : schedule.templates.length === 0 ? { title: "Make room for your first appointments.", description: "Your team is taking shape. Add weekly sessions, then open appointment times for booking.", href: "/admin/schedule", action: "Set up your schedule" } : { title: "A clear view. A smoother clinic day.", description: pending ? `${pending} invitation${pending === 1 ? " is" : "s are"} awaiting a response. Review your team or adjust the schedule to keep your clinic moving.` : "Your weekly pattern is in place. Review sessions, adjust availability, and open appointment times when you are ready.", href: "/admin/schedule", action: "Manage schedule" },
      panel: { title: "Your weekly rhythm", description: `Recurring sessions · ${schedule.timeZone}`, href: "/admin/schedule", action: "Edit schedule", emptyTitle: "Your schedule starts here", emptyDescription: "Add a weekly session for a clinician, then open it into bookable appointment times." },
      distribution: { title: "Sessions by day", items: [1, 2, 3, 4, 5, 6, 0].map(day => ({ label: weekdays[day].slice(0, 3), value: schedule.templates.filter(item => item.weekday === day).length })) },
      rows: [...schedule.templates].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.startMinute - b.startMinute).slice(0, 5).map(item => ({
        id: item.id, title: team.people.find(person => person.id === item.providerId)?.displayName ?? "Clinician session", detail: `${clock(item.startMinute)}–${clock(item.endMinute)} · ${item.slotMinutes}-minute appointments`, time: weekdays[item.weekday].slice(0, 3), caption: "Weekly", status: "Recurring", tone: "neutral", href: "/admin/schedule",
      })),
    };
  }
  if (actor.role === "patient") {
    const [appointments, visits] = await Promise.all([listMyAppointments(actor), listMyVisits(actor)]);
    const upcoming = appointments.filter(item => item.startsAt.getTime() > now.getTime() && !terminal.has(item.status)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const published = visits.filter(item => item.publishedAt).sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime());
    const next = upcoming[0];
    return {
      metrics: [
        { label: "Upcoming visits", value: upcoming.length, hint: "From your appointment records", href: "/patient/appointments", icon: "calendar" },
        { label: "Published summaries", value: published.length, hint: "Available in your recent visits", href: published[0] ? `/patient/visits/${published[0].id}` : "/patient/appointments", icon: "document" },
      ],
      focus: next ? { title: "Your next visit, in view.", description: `Your appointment is ${new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "full", timeStyle: "short" }).format(next.startsAt)} (${timeZone}). Review the details before you arrive.`, href: "/patient/appointments", action: "View appointment" } : { title: "A little time for your health.", description: "You have no upcoming appointments. Find a clinician and choose a time that fits your day.", href: "/patient/book", action: "Book a visit" },
      panel: { title: "Coming up for you", description: `Upcoming appointments · ${timeZone}`, href: "/patient/appointments", action: "All appointments", emptyTitle: "Nothing on your calendar yet", emptyDescription: "When you book a visit, its time and status will appear here. Use Book a visit to find an available appointment." },
      distribution: null,
      rows: upcoming.slice(0, 4).map(item => ({ id: item.id, title: "Clinic appointment", detail: `${formatTime(item.startsAt)}–${formatTime(item.endsAt)}`, time: new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(item.startsAt), caption: new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(item.startsAt), status: statusLabels[item.status] ?? item.status, tone: "neutral", href: "/patient/appointments" })),
    };
  }
  const result = actor.role === "clinician" ? await getClinicianQueue(actor, {}) : await getWaitingRoomBoard(actor, {});
  const href = actor.role === "clinician" ? "/clinical/today" : "/staff/board";
  const remaining = result.entries.filter(item => !terminal.has(item.status)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const waitingCount = result.entries.filter(item => waiting.has(item.status)).length;
  const complete = result.entries.filter(item => item.status === "done").length;
  const queueTime = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: result.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return {
    metrics: [
      { label: "Appointments today", value: result.entries.length, hint: "All scheduled visit states", href, icon: "calendar" },
      { label: "Waiting now", value: waitingCount, hint: "Arrived, rooming, or ready", href, icon: "clock" },
      { label: "Completed today", value: complete, hint: "Visits marked complete", href, icon: "complete" },
    ],
    focus: { title: waitingCount ? `${waitingCount} ${waitingCount === 1 ? "person is" : "people are"} waiting.` : "Room for a more focused day.", description: waitingCount ? "Open your queue to review arrivals and help the next visit move forward." : remaining.length ? "Your appointments are organised below. Open the queue to follow each visit as it progresses." : "There are no remaining appointments in today's queue. You can review completed visits or choose another clinic day.", href, action: actor.role === "clinician" ? "Open today's clinic" : "Open waiting room" },
    panel: { title: "Today's remaining visits", description: `${result.day} · ${result.timeZone}`, href, action: "Full queue", emptyTitle: "No visits left in this queue", emptyDescription: "New appointments will appear here when you reload. Open the full queue to review this day or choose another date." },
    distribution: { title: "Today's visit progress", items: [{ label: "Booked", value: result.entries.filter(item => item.status === "booked").length }, { label: "Waiting", value: waitingCount }, { label: "In consultation", value: result.entries.filter(item => item.status === "in_progress").length }, { label: "Completed", value: complete }] },
    rows: remaining.slice(0, 5).map(item => ({ id: item.id, title: actor.role === "clinician" && "givenName" in item && "surname" in item ? `${item.givenName} ${item.surname}` : "Clinic appointment", detail: item.waitingMinutes === null ? "Not checked in" : `Checked in · ${item.waitingMinutes} min elapsed`, time: queueTime(item.startsAt), caption: `to ${queueTime(item.endsAt)}`, status: statusLabels[item.status] ?? item.status, tone: waiting.has(item.status) || item.status === "in_progress" ? "active" : "neutral", href })),
  };
}
