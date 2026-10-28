import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  sameOrigin: vi.fn(), requireActor: vi.fn(), startEncounter: vi.fn(), advanceAppointment: vi.fn(), getAppointmentForCare: vi.fn(), publish: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith("REDIRECT:")) throw error; },
}));
vi.mock("@/platform/realtime", () => ({ publishChange: mock.publish }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/session", () => ({ requireActor: mock.requireActor }));
vi.mock("@/modules/identity", async (importOriginal) => ({ ...(await importOriginal<object>()), assertSameOrigin: mock.sameOrigin }));
vi.mock("@/modules/scheduling", async (importOriginal) => ({ ...(await importOriginal<object>()), advanceAppointment: mock.advanceAppointment, getAppointmentForCare: mock.getAppointmentForCare }));
vi.mock("@/modules/clinical", async (importOriginal) => ({ ...(await importOriginal<object>()), startEncounter: mock.startEncounter }));
import { StaleAppointmentError } from "../../src/modules/scheduling/validators";
import { startVisitAction } from "../../src/app/clinical/actions";

const actor = { id: "clinician-1", clinicId: "clinic-1", role: "clinician" as const, patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() };
function form(data: Record<string, string>) { const value = new FormData(); for (const [key, entry] of Object.entries(data)) value.set(key, entry); return value; }

beforeEach(() => {
  vi.resetAllMocks();
  mock.sameOrigin.mockResolvedValue("http://127.0.0.1:4000");
  mock.requireActor.mockResolvedValue(actor);
  mock.startEncounter.mockResolvedValue({ id: "encounter-1", appointmentId: "appointment-1" });
});

describe("startVisitAction", () => {
  it("opens the encounter and redirects once the appointment advances", async () => {
    mock.advanceAppointment.mockResolvedValue({ id: "appointment-1", revision: 5 });
    await expect(startVisitAction({}, form({ appointmentId: "appointment-1", revision: "4" }))).rejects.toThrow("REDIRECT:/clinical/encounters/encounter-1");
    expect(mock.startEncounter).toHaveBeenCalledWith(actor, { appointmentId: "appointment-1", revision: 4 });
    expect(mock.advanceAppointment).not.toHaveBeenCalled();
  });
  it("still redirects when the appointment was already advanced by an earlier submission", async () => {
    // The domain transaction handles idempotent retries.
    mock.startEncounter.mockResolvedValue({ id: "encounter-1", appointmentId: "appointment-1" });
    await expect(startVisitAction({}, form({ appointmentId: "appointment-1", revision: "4" }))).rejects.toThrow("REDIRECT:/clinical/encounters/encounter-1");
  });
  it("surfaces a genuine transition failure instead of silently proceeding to bill an unstarted visit", async () => {
    mock.startEncounter.mockRejectedValue(new StaleAppointmentError());
    const result = await startVisitAction({}, form({ appointmentId: "appointment-1", revision: "4" }));
    expect(result.error).toContain("Reload to see its current state");
    expect(result.ok).not.toBe(true);
  });
});
