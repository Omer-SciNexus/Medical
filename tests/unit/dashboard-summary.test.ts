import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../../src/modules/identity";

const services = vi.hoisted(() => ({ listPeople: vi.fn(), getScheduleAuthoring: vi.fn(), listMyAppointments: vi.fn(), listMyVisits: vi.fn(), getClinicianQueue: vi.fn(), getWaitingRoomBoard: vi.fn() }));
vi.mock("@/modules/identity", () => ({ listPeople: services.listPeople }));
vi.mock("@/modules/scheduling", () => services);
vi.mock("@/modules/clinical", () => ({ listMyVisits: services.listMyVisits }));
import { readDashboardSummary } from "../../src/app/dashboard/summary";

const now = new Date("2026-10-26T06:00:00Z");
const actor = (role: Actor["role"]): Actor => ({ id: "account-1", clinicId: "clinic-1", role, patientId: role === "patient" ? "patient-1" : null, mfaVerified: true, authenticatedAt: now.getTime(), mfaVerifiedAt: now.getTime() });
const appointment = (id: string, status: string, startsAt = "2026-10-26T07:00:00Z") => ({ id, status, startsAt: new Date(startsAt), endsAt: new Date(new Date(startsAt).getTime() + 1_200_000), waitingMinutes: null });
beforeEach(() => vi.resetAllMocks());

describe("dashboard overview data", () => {
  it("counts only active team members and valid pending invitations, and orders weekly sessions from Monday", async () => {
    services.listPeople.mockResolvedValue({ people: [{ id: "dr-1", displayName: "Example Clinician", role: "clinician", active: true }, { role: "admin", active: true }, { role: "patient", active: true }, { role: "staff", active: false }], invitations: [
      { expiresAt: new Date("2026-10-27"), consumedAt: null, revokedAt: null },
      { expiresAt: new Date("2026-10-25"), consumedAt: null, revokedAt: null },
      { expiresAt: new Date("2026-10-27"), consumedAt: now, revokedAt: null },
      { expiresAt: new Date("2026-10-27"), consumedAt: null, revokedAt: now },
    ] });
    services.getScheduleAuthoring.mockResolvedValue({ timeZone: "Europe/Istanbul", templates: [
      { id: "sun", providerId: "dr-1", weekday: 0, startMinute: 540, endMinute: 720, slotMinutes: 20 },
      { id: "mon", providerId: "dr-1", weekday: 1, startMinute: 780, endMinute: 900, slotMinutes: 30 },
    ] });
    const summary = await readDashboardSummary(actor("admin"), "Europe/Istanbul", now);
    expect(summary.metrics.map(item => item.value)).toEqual([2, 1, 2]);
    expect(summary.rows.map(item => item.id)).toEqual(["mon", "sun"]);
    expect(summary.rows[0]).toMatchObject({ title: "Example Clinician", detail: "13:00–15:00 · 30-minute appointments" });
    expect(summary.distribution!.items.map(item => item.value)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(services.getClinicianQueue).not.toHaveBeenCalled();
    expect(services.getWaitingRoomBoard).not.toHaveBeenCalled();
  });
  it("guides a new administrator to invite a clinician before setting up sessions", async () => {
    services.listPeople.mockResolvedValue({ people: [{ role: "admin", active: true }], invitations: [] });
    services.getScheduleAuthoring.mockResolvedValue({ timeZone: "Europe/Istanbul", templates: [] });
    const summary = await readDashboardSummary(actor("admin"), "Europe/Istanbul", now);
    expect(summary.focus.href).toBe("/admin/people");
    expect(summary.rows).toEqual([]);
    expect(summary.metrics.map(item => item.value)).toEqual([1, 0, 0]);
  });
  it("shows only future active patient appointments and links only to published summaries", async () => {
    services.listMyAppointments.mockResolvedValue([appointment("later", "booked", "2026-10-27T09:00:00Z"), appointment("past", "booked", "2026-10-25T09:00:00Z"), appointment("cancelled", "cancelled"), appointment("complete", "done"), appointment("next", "booked"), appointment("missed", "no_show")]);
    services.listMyVisits.mockResolvedValue([{ id: "draft", publishedAt: null }, { id: "published", publishedAt: new Date("2026-10-25") }]);
    const patient = actor("patient");
    const summary = await readDashboardSummary(patient, "Europe/Istanbul", now);
    expect(summary.metrics.map(item => item.value)).toEqual([2, 1]);
    expect(summary.rows.map(item => item.id)).toEqual(["next", "later"]);
    expect(summary.rows[0].detail).toBe("10:00–10:20");
    expect(summary.focus.description).toContain("10:00");
    expect(summary.metrics[1].href).toBe("/patient/visits/published");
    expect(services.listMyAppointments).toHaveBeenCalledWith(patient);
    expect(services.getClinicianQueue).not.toHaveBeenCalled();
  });
  it("offers booking and an honest zero state when a patient has no visits", async () => {
    services.listMyAppointments.mockResolvedValue([]);
    services.listMyVisits.mockResolvedValue([]);
    const summary = await readDashboardSummary(actor("patient"), "Europe/Istanbul", now);
    expect(summary.focus.href).toBe("/patient/book");
    expect(summary.metrics.map(item => item.value)).toEqual([0, 0]);
    expect(summary.rows).toEqual([]);
    expect(summary.metrics[1].href).toBe("/patient/appointments");
  });
  it("keeps the front desk anonymous, excludes terminal visits from the agenda, and counts progress accurately", async () => {
    services.getWaitingRoomBoard.mockResolvedValue({ day: "2026-10-26", timeZone: "Europe/Istanbul", entries: [appointment("booked", "booked"), { ...appointment("ready", "ready"), givenName: "Must not", surname: "appear", waitingMinutes: 12 }, appointment("active", "in_progress"), appointment("complete", "done"), appointment("cancelled", "cancelled"), appointment("missed", "no_show")] });
    const summary = await readDashboardSummary(actor("staff"), "Europe/Istanbul", now);
    expect(summary.metrics.map(item => item.value)).toEqual([6, 1, 1]);
    expect(summary.rows.map(item => item.id)).toEqual(["booked", "ready", "active"]);
    expect(summary.rows.every(item => item.title === "Clinic appointment")).toBe(true);
    expect(summary.distribution!.items.map(item => item.value)).toEqual([1, 1, 1, 1]);
    expect(summary.focus.title).toBe("1 person is waiting.");
    expect(services.getClinicianQueue).not.toHaveBeenCalled();
  });
  it("uses the clinician's scoped queue and its timezone for appointment times", async () => {
    services.getClinicianQueue.mockResolvedValue({ day: "2026-10-26", timeZone: "Europe/Istanbul", entries: [{ ...appointment("visit", "ready"), givenName: "Example", surname: "Patient", waitingMinutes: 5 }] });
    const clinician = actor("clinician");
    const summary = await readDashboardSummary(clinician, "UTC", now);
    expect(summary.rows[0]).toMatchObject({ title: "Example Patient", time: "10:00", href: "/clinical/today", status: "Ready", tone: "active" });
    expect(services.getClinicianQueue).toHaveBeenCalledWith(clinician, {});
    expect(services.getWaitingRoomBoard).not.toHaveBeenCalled();
  });
  it("propagates unavailable data so the page can show a failure state rather than false zero counts", async () => {
    services.getClinicianQueue.mockRejectedValue(new Error("Unavailable"));
    await expect(readDashboardSummary(actor("clinician"), "Europe/Istanbul", now)).rejects.toThrow("Unavailable");
  });
});
