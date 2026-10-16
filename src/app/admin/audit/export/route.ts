import { exportAuditLog } from "@/modules/identity";
import { requireActor } from "@/app/session";

/** Identifiers only: the export reads through the auditor credential, as the screen does. */
const COLUMNS = ["seq", "createdAt", "action", "purpose", "outcome", "actorId", "patientId", "resourceId", "reason", "hash"] as const;
const cell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export async function GET(request: Request) {
  const actor = await requireActor(["admin"]);
  const query = Object.fromEntries([...new URL(request.url).searchParams].filter(([, value]) => value.trim() !== ""));
  const rows = await exportAuditLog(actor, { ...query, limit: 5_000 });
  const body = [COLUMNS.join(","), ...rows.map((row) => COLUMNS.map((column) => cell(row[column as keyof typeof row])).join(","))].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="meridian-access-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
