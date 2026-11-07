import { describe, expect, it } from "vitest";
import { summariseRecordAccess, type RecordAccessEvent } from "../../src/modules/identity/record-access";

const minutesAgo = (minutes: number) => new Date(Date.parse("2026-11-06T12:00:00Z") - minutes * 60_000);
let seq = 1_000;
const event = (minutes: number, overrides: Partial<RecordAccessEvent> = {}): RecordAccessEvent =>
  ({ seq: (seq -= 1), actorId: "dr", action: "clinical.chart_read", purpose: "clinical.read", outcome: "allowed", reason: null, createdAt: minutesAgo(minutes), ...overrides });
const people = [{ id: "dr", displayName: "Dr. Example", role: "clinician" }, { id: "desk", displayName: "Front Desk", role: "staff" }];

describe("summarising a patient's access history", () => {
  it("folds one person's sitting into one entry, in the order it happened", () => {
    const [entry, ...rest] = summariseRecordAccess([
      event(1, { action: "clinical.note_signed", purpose: "clinical.write" }), event(5, { action: "clinical.note_saved", purpose: "clinical.write" }),
      event(6, { action: "clinical.note_saved", purpose: "clinical.write" }), event(10),
    ], people);
    expect(rest).toEqual([]);
    expect(entry.activities).toEqual(["Opened your chart", "Wrote your visit note", "Signed your visit note"]);
    expect(entry.reasons).toEqual(["Your care"]);
    expect(entry).toMatchObject({ person: "Dr. Example", role: "Clinician", firstAt: minutesAgo(10), lastAt: minutesAgo(1) });
  });
  it("starts a new entry after a long gap, or when someone else steps in", () => {
    expect(summariseRecordAccess([event(0), event(45)], people)).toHaveLength(2);
    expect(summariseRecordAccess([event(0), event(1, { actorId: "desk" }), event(2)], people).map((entry) => entry.person)).toEqual(["Dr. Example", "Front Desk", "Dr. Example"]);
  });
  it("never folds an emergency or a refusal into routine work", () => {
    const entries = summariseRecordAccess([event(0), event(1, { action: "access.break_glass", outcome: "emergency", reason: "Unconscious on arrival, needed allergies." }), event(2),
      event(3, { action: "access.denied", outcome: "denied" }), event(4)], people);
    expect(entries.map((entry) => entry.kind)).toEqual(["routine", "emergency", "routine", "refused", "routine"]);
    expect(entries[1].note).toBe("Unconscious on arrival, needed allergies.");
  });
  it("keeps the log's free text to itself, except for an emergency", () => {
    const [entry] = summariseRecordAccess([event(0, { action: "scheduling.follow_up_closed", purpose: "scheduling", reason: "Mentions another person" })], people);
    expect(entry.note).toBeNull();
    expect(JSON.stringify(entry)).not.toContain("another person");
  });
  it("still shows an action it has no words for, and someone who has left", () => {
    const [entry] = summariseRecordAccess([event(0, { actorId: "gone", action: "clinical.something_new", purpose: "something_new" })], people);
    expect(entry).toMatchObject({ person: "A former colleague", activities: ["Worked with your record"], reasons: ["Clinic work"] });
  });
});
