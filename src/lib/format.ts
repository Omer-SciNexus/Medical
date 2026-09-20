export function clinicalName(givenName: string, surname: string, locale = "tr-TR") {
  return `${surname.toLocaleUpperCase(locale)}, ${givenName}`;
}
export function patientName(givenName: string, surname: string) { return `${givenName} ${surname}`; }

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}
export function clinicalDate(value: Date | string, now = new Date(), timeZone = "Europe/Istanbul") {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) throw new RangeError("A valid clinical event date is required.");
  const diff = Math.round((dateParts(now, timeZone) - dateParts(date, timeZone)) / 86_400_000);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  let label: string;
  if (diff === 0) label = "Today";
  else if (diff === 1) label = "Yesterday";
  else if (diff === -1) label = "Tomorrow";
  else if (Math.abs(diff) < 7) label = diff > 0 ? `${diff} days ago` : `In ${-diff} days`;
  else label = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(date);
  return `${label}, ${time}`;
}
