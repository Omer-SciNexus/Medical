import { describe, expect, it } from "vitest";
import { addClinicDays, clinicDayRange, todayInZone, weekdayOf, zonedInstant, zonedStartOfDay } from "../../src/lib/clinic-day";

describe("clinic day boundaries", () => {
  it("resolves local midnight in the clinic timezone, not UTC midnight", () => {
    // Europe/Istanbul is a fixed UTC+3 offset, so local midnight is 21:00 the previous day.
    expect(zonedStartOfDay("2026-09-21", "Europe/Istanbul").toISOString()).toBe("2026-09-20T21:00:00.000Z");
  });
  it("covers exactly one local day", () => {
    const { from, to } = clinicDayRange("2026-09-21", "Europe/Istanbul");
    expect(from.toISOString()).toBe("2026-09-20T21:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-21T21:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(86_400_000);
  });
  it("handles a day that starts before a daylight-saving change", () => {
    // Berlin is UTC+1 at midnight on 29 March 2026 and shifts to UTC+2 at 02:00 local.
    expect(zonedStartOfDay("2026-03-29", "Europe/Berlin").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    const { from, to } = clinicDayRange("2026-03-29", "Europe/Berlin");
    expect(to.getTime() - from.getTime()).toBe(23 * 3_600_000);
  });
  it("handles a day that ends with a daylight-saving change", () => {
    const { from, to } = clinicDayRange("2026-10-25", "Europe/Berlin");
    expect(from.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(25 * 3_600_000);
  });
  it("reports the clinic's own calendar day, not the host's", () => {
    expect(todayInZone("Europe/Istanbul", new Date("2026-09-20T22:30:00Z"))).toBe("2026-09-21");
    expect(todayInZone("America/Los_Angeles", new Date("2026-09-20T22:30:00Z"))).toBe("2026-09-20");
  });
  it("resolves a local time of day to its UTC instant", () => {
    expect(zonedInstant("2026-09-21", 9 * 60, "Europe/Istanbul").toISOString()).toBe("2026-09-21T06:00:00.000Z");
    expect(zonedInstant("2026-09-21", 1440, "Europe/Istanbul").toISOString()).toBe("2026-09-21T21:00:00.000Z");
  });
  it("keeps a local time of day stable across a daylight-saving change", () => {
    // 09:00 local on both sides of the spring change, which is 07:00Z before and 06:00Z after.
    expect(zonedInstant("2026-03-28", 9 * 60, "Europe/Berlin").toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(zonedInstant("2026-03-29", 9 * 60, "Europe/Berlin").toISOString()).toBe("2026-03-29T07:00:00.000Z");
    // 02:30 local does not exist on the day the clocks go forward; it resolves to 03:30 local.
    expect(zonedInstant("2026-03-29", 150, "Europe/Berlin").toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
  it("reads the weekday from the calendar date and steps whole days", () => {
    expect(weekdayOf("2026-09-21")).toBe(1);
    expect(weekdayOf("2026-09-20")).toBe(0);
    expect(addClinicDays("2026-09-21", 7)).toBe("2026-09-28");
    expect(addClinicDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addClinicDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("rejects a time of day outside one day", () => {
    expect(() => zonedInstant("2026-09-21", -1, "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedInstant("2026-09-21", 1441, "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedInstant("2026-09-21", 9.5, "Europe/Istanbul")).toThrow(RangeError);
  });
  it("rejects a malformed or impossible clinic day", () => {
    // Day-first input parses to three integers, so the guard must check shape, not just type.
    expect(() => zonedStartOfDay("21-09-2026", "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedStartOfDay("2026-9-21", "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedStartOfDay("2026-02-30", "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedStartOfDay("2026-13-01", "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedStartOfDay("", "Europe/Istanbul")).toThrow(RangeError);
  });
});
