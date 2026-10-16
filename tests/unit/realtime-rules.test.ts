import { describe, expect, it } from "vitest";
import { CHANNELS, authorizeChannel, isChannel, parseNudge, readCookie } from "../../src/platform/realtime";

describe("who may watch what", () => {
  it("lets the front desk watch the board and a clinician watch the queue, and no crossing over", () => {
    expect(authorizeChannel({ role: "staff" }, "clinic:board")).toBe(true);
    expect(authorizeChannel({ role: "admin" }, "clinic:board")).toBe(true);
    expect(authorizeChannel({ role: "clinician" }, "clinic:board")).toBe(false);
    expect(authorizeChannel({ role: "clinician" }, "clinic:queue")).toBe(true);
    expect(authorizeChannel({ role: "staff" }, "clinic:queue")).toBe(false);
  });
  it("lets a patient watch nothing at all", () => {
    for (const channel of Object.keys(CHANNELS)) expect(authorizeChannel({ role: "patient" }, channel)).toBe(false);
  });
  it("refuses a channel that does not exist, however it is spelled", () => {
    for (const channel of ["clinic:everything", "", "clinic:board ", "CLINIC:BOARD", "__proto__", "toString"]) {
      expect(isChannel(channel)).toBe(false);
      expect(authorizeChannel({ role: "admin" }, channel)).toBe(false);
    }
  });
});

describe("what a nudge may contain", () => {
  it("accepts a well-formed nudge and nothing else", () => {
    const clinicId = "00000000-0000-4000-8000-000000000001";
    expect(parseNudge(JSON.stringify({ channel: "clinic:board", clinicId, at: 123 }))).toEqual({ channel: "clinic:board", clinicId, at: 123 });
    expect(parseNudge(JSON.stringify({ channel: "clinic:board", clinicId }))?.at).toBeTypeOf("number");
    expect(parseNudge(JSON.stringify({ channel: "clinic:nope", clinicId }))).toBeUndefined();
    expect(parseNudge(JSON.stringify({ channel: "clinic:board" }))).toBeUndefined();
    expect(parseNudge("not json")).toBeUndefined();
  });
});

describe("reading the session cookie off an upgrade", () => {
  it("finds the named cookie among others, and nothing when it is absent", () => {
    expect(readCookie("a=1; meridian_session=abc; b=2", "meridian_session")).toBe("abc");
    expect(readCookie("meridian_session=abc", "meridian_session")).toBe("abc");
    expect(readCookie("a=1; b=2", "meridian_session")).toBeUndefined();
    expect(readCookie(undefined, "meridian_session")).toBeUndefined();
    // A cookie whose value contains '=' survives intact.
    expect(readCookie("meridian_session=ab=cd", "meridian_session")).toBe("ab=cd");
    // A name that merely ends with the one we want is not a match.
    expect(readCookie("not_meridian_session=abc", "meridian_session")).toBeUndefined();
  });
});
