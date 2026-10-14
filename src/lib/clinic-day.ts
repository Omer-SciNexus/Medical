const DAY_MS = 86_400_000;

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}
function offsetMs(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
/** The UTC instant of local midnight for a `YYYY-MM-DD` clinic day. */
export function zonedStartOfDay(day: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new RangeError("A clinic day must be formatted YYYY-MM-DD.");
  const [year, month, date] = match.slice(1).map(Number);
  const naive = Date.UTC(year, month - 1, date);
  // Rejects dates that look well-formed but are not real, such as 2026-02-30, which
  // Date.UTC would otherwise silently roll forward into the next month.
  const naiveDate = new Date(naive);
  if (naiveDate.getUTCFullYear() !== year || naiveDate.getUTCMonth() + 1 !== month || naiveDate.getUTCDate() !== date) throw new RangeError("A clinic day must be a real calendar date.");
  // One correction pass, then a second to settle days whose offset changes at midnight.
  const first = naive - offsetMs(new Date(naive), timeZone);
  return new Date(naive - offsetMs(new Date(first), timeZone));
}
export function clinicDayRange(day: string, timeZone: string) {
  const from = zonedStartOfDay(day, timeZone);
  const next = zonedParts(new Date(from.getTime() + DAY_MS + DAY_MS / 2), timeZone);
  return { from, to: zonedStartOfDay(`${next.year}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`, timeZone) };
}
export function todayInZone(timeZone: string, now = new Date()) {
  const { year, month, day } = zonedParts(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function clinicTimezone() { return process.env.CLINIC_TIMEZONE || "Europe/Istanbul"; }
