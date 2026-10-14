import { describe, expect, it } from "vitest";
import { clinicDayRange, todayInZone, zonedStartOfDay } from "../../src/lib/clinic-day";

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
  it("rejects a malformed or impossible clinic day", () => {
    // Day-first input parses to three integers, so the guard must check shape, not just type.
    expect(() => zonedStartOfDay("21-09-2026", "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedStartOfDay("2026-9-21", "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedStartOfDay("2026-02-30", "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedStartOfDay("2026-13-01", "Europe/Istanbul")).toThrow(RangeError);
    expect(() => zonedStartOfDay("", "Europe/Istanbul")).toThrow(RangeError);
  });
});
