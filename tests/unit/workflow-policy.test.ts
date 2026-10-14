import { describe, expect, it } from "vitest";
import { canTransition, roleMayTransition, waitingMinutes } from "../../src/modules/scheduling/policy";
import { isUniqueViolation } from "../../src/platform/errors";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { encounterIsCompletable, noteIsEditable, noteIsSignable, observationFlag, patientAge } from "../../src/modules/clinical/policy";
import { outboxKey } from "../../src/platform/outbox";

describe("appointment transitions", () => {
  it("follows the waiting-room order", () => {
    expect(canTransition("booked", "checked_in")).toBe(true);
    expect(canTransition("checked_in", "rooming")).toBe(true);
    expect(canTransition("rooming", "ready")).toBe(true);
    expect(canTransition("ready", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "done")).toBe(true);
  });
  it("refuses to skip ahead or reopen a closed appointment", () => {
    expect(canTransition("booked", "in_progress")).toBe(false);
    expect(canTransition("booked", "done")).toBe(false);
    expect(canTransition("done", "in_progress")).toBe(false);
    expect(canTransition("cancelled", "checked_in")).toBe(false);
    expect(canTransition("no_show", "checked_in")).toBe(false);
  });
  it("lets staff run the waiting room but not the visit", () => {
    expect(roleMayTransition("staff", "checked_in")).toBe(true);
    expect(roleMayTransition("staff", "ready")).toBe(true);
    expect(roleMayTransition("staff", "in_progress")).toBe(false);
    expect(roleMayTransition("staff", "done")).toBe(false);
    expect(roleMayTransition("clinician", "in_progress")).toBe(true);
    expect(roleMayTransition("patient", "cancelled")).toBe(true);
    expect(roleMayTransition("patient", "checked_in")).toBe(false);
    expect(roleMayTransition("admin", "checked_in")).toBe(false);
  });
  it("reports waiting time only once a patient has checked in", () => {
    expect(waitingMinutes(null)).toBeNull();
    expect(waitingMinutes(new Date("2026-09-21T08:00:00Z"), new Date("2026-09-21T08:25:30Z"))).toBe(25);
    // A clock skew must never render as a negative wait.
    expect(waitingMinutes(new Date("2026-09-21T08:30:00Z"), new Date("2026-09-21T08:00:00Z"))).toBe(0);
  });
});

describe("detecting a lost race on a claimed slot", () => {
  // A slot claim relies on a unique index, so recognising its violation is what turns a lost
  // race into "that time was just taken" instead of a generic failure.
  const pgError = () => Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  it("finds the Postgres code through Drizzle's wrapper", () => {
    expect(isUniqueViolation(new DrizzleQueryError("insert into appointments", [], pgError()))).toBe(true);
  });
  it("finds it on a bare driver error and through nested causes", () => {
    expect(isUniqueViolation(pgError())).toBe(true);
    expect(isUniqueViolation(new Error("outer", { cause: new Error("inner", { cause: pgError() }) }))).toBe(true);
  });
  it("ignores other failures so they are not misreported as a taken slot", () => {
    expect(isUniqueViolation(Object.assign(new Error("not null"), { code: "23502" }))).toBe(false);
    expect(isUniqueViolation(new DrizzleQueryError("insert", [], Object.assign(new Error("fk"), { code: "23503" })))).toBe(false);
    expect(isUniqueViolation(new Error("connection terminated"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
  it("terminates on a self-referencing cause instead of recursing forever", () => {
    const looping = new Error("looping") as Error & { cause?: unknown };
    looping.cause = looping;
    expect(isUniqueViolation(looping)).toBe(false);
  });
});

describe("note and encounter state", () => {
  it("only allows editing a draft", () => {
    expect(noteIsEditable("draft")).toBe(true);
    expect(noteIsEditable("signed")).toBe(false);
    expect(noteIsEditable("amended")).toBe(false);
  });
  it("requires substantive content before signing", () => {
    expect(noteIsSignable("draft", "too short")).toBe(false);
    expect(noteIsSignable("draft", "Subjective: patient reports a persistent headache.")).toBe(true);
    expect(noteIsSignable("signed", "Subjective: patient reports a persistent headache.")).toBe(false);
  });
  it("refuses to complete a visit whose note is unsigned", () => {
    expect(encounterIsCompletable("in_progress", "draft")).toBe(false);
    expect(encounterIsCompletable("in_progress", "signed")).toBe(true);
    expect(encounterIsCompletable("completed", "signed")).toBe(false);
    // 'amended' only ever marks a superseded version. The current version after an
    // amendment is a draft, so it must be signed again before the visit can complete.
    expect(encounterIsCompletable("in_progress", "amended")).toBe(false);
  });
  it("flags observations against their reference range", () => {
    expect(observationFlag(118, 90, 139)).toBe("normal");
    expect(observationFlag(142, 90, 139)).toBe("high");
    expect(observationFlag(84, 90, 139)).toBe("low");
    expect(observationFlag(500, null, null)).toBe("normal");
  });
  it("derives age without rolling over before the birthday", () => {
    expect(patientAge("1984-06-15", new Date("2026-10-14T00:00:00Z"))).toBe(42);
    expect(patientAge("1984-10-14", new Date("2026-10-14T00:00:00Z"))).toBe(42);
    expect(patientAge("1984-10-15", new Date("2026-10-14T00:00:00Z"))).toBe(41);
    expect(patientAge("1984-12-31", new Date("2026-01-01T00:00:00Z"))).toBe(41);
  });
});

describe("outbox idempotency keys", () => {
  it("derives the same key for the same event and different keys across events", () => {
    const first = outboxKey("encounter.completed", "00000000-0000-4000-8000-000000000500");
    expect(first).toBe(outboxKey("encounter.completed", "00000000-0000-4000-8000-000000000500"));
    expect(first).not.toBe(outboxKey("visit_summary.published", "00000000-0000-4000-8000-000000000500"));
    expect(first).not.toBe(outboxKey("encounter.completed", "00000000-0000-4000-8000-000000000501"));
  });
  it("produces a valid UUID so the unique index accepts it", () => {
    expect(outboxKey("encounter.completed", "00000000-0000-4000-8000-000000000500"))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
