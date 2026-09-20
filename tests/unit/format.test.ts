import { describe, expect, it } from "vitest";
import { clinicalDate, clinicalName, patientName } from "../../src/lib/format";
describe("clinical identity and dates", () => {
  it("respects Turkish uppercase naming", () => { expect(clinicalName("Emre", "Demir")).toBe("DEMİR, Emre"); expect(patientName("Aylin", "Yılmaz")).toBe("Aylin Yılmaz"); });
  it("uses clinic calendar days instead of rolling 24-hour intervals", () => {
    expect(clinicalDate("2026-09-19T20:30:00Z", new Date("2026-09-19T21:30:00Z"))).toBe("Yesterday, 23:30");
  });
  it("uses an absolute date at the seven-day boundary and always includes 24-hour time", () => {
    expect(clinicalDate("2026-09-13T06:00:00Z", new Date("2026-09-20T06:00:00Z"))).toBe("13 Sept 2026, 09:00");
    expect(clinicalDate("2026-09-14T06:00:00Z", new Date("2026-09-20T06:00:00Z"))).toBe("6 days ago, 09:00");
  });
  it("handles DST and future appointments", () => {
    expect(clinicalDate("2026-03-29T00:30:00Z", new Date("2026-03-30T00:30:00Z"), "Europe/Berlin")).toBe("Yesterday, 01:30");
    expect(clinicalDate("2026-09-21T06:00:00Z", new Date("2026-09-20T06:00:00Z"))).toBe("Tomorrow, 09:00");
  });
  it("rejects invalid dates instead of rendering misleading timestamps", () => { expect(() => clinicalDate("not-a-date")).toThrow(); });
});
