import type { Metadata } from "next";
import { ChevronRight, Home, Inbox, Radio, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings } from "@/modules/identity";
import { listOutboxRows, outboxBacklog } from "@/platform/outbox";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { Outbox } from "./outbox";

export const metadata: Metadata = { title: "Event delivery", robots: { index: false, follow: false } };
const scopes = ["pending", "dead", "dispatched"] as const;

export default async function OutboxPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const actor = await requireActor(["admin"]);
  const { scope: requested } = await searchParams;
  const scope = scopes.find((candidate) => candidate === requested) ?? "pending";
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Administration</span><ChevronRight /><span>Event delivery</span></>;
  const [clinic, backlog, rows] = await Promise.all([
    getClinicSettings(actor).catch(() => null), outboxBacklog(actor.clinicId).catch(() => null), listOutboxRows(actor.clinicId, scope).catch(() => null),
  ]);
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/admin/outbox" breadcrumb={breadcrumb}>{children}</AppShell>;

  if (!rows || !backlog) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>Event delivery could not be read</h3>
    <p>Nothing was changed. Confirm the database is running, then reload this page.</p>
  </div></div>);

  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><Radio /> Administration</span>
        <h2 style={{ marginTop: 6 }}>Event delivery</h2>
        <p className="section-description">Work the clinic queued for the worker: reminders, published summaries and visit close-outs. A row that keeps failing backs off and ends up here for someone to decide about.</p></div></div>
    </div>
    {!backlog.pending && !backlog.dead && scope === "pending" ? <div className="integrity-banner" role="status">
      <Inbox /><div><strong>Nothing waiting</strong><p>Every event the clinic has raised has been handed to the queue. Rows appear here the moment something is enqueued and clear as the worker takes them.</p></div>
    </div> : null}
    <Outbox
      scope={scope}
      backlog={backlog}
      timeZone={clinic?.timezone ?? clinicTimezone()}
      rows={rows.map((row) => ({ id: row.id, topic: row.topic, resourceId: row.resourceId, attempts: row.attempts, lastError: row.lastError,
        createdAt: row.createdAt.toISOString(), dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, failedAt: row.failedAt?.toISOString() ?? null }))}
    />
  </>);
}
