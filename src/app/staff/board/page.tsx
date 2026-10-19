import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Home, MonitorCheck, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings, listCareProviders } from "@/modules/identity";
import { canTransition, getWaitingRoomBoard, roleMayTransition, type AppointmentStatus } from "@/modules/scheduling";
import { todayInZone, clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { Board } from "./board";

export const metadata: Metadata = { title: "Waiting room", robots: { index: false, follow: false } };
const BOARD_MOVES = ["checked_in", "rooming", "ready", "no_show"] as const satisfies readonly AppointmentStatus[];

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const actor = await requireActor(["staff", "admin"]);
  const { day: requested } = await searchParams;
  const timeZone = (await getClinicSettings(actor).catch(() => null))?.timezone ?? clinicTimezone();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? "") ? requested! : todayInZone(timeZone);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Front desk</span><ChevronRight /><span>Waiting room</span></>;
  const shell = (children: React.ReactNode, clinicName: string) =>
    <AppShell actor={actor} clinicName={clinicName} current="/staff/board" breadcrumb={breadcrumb}>{children}</AppShell>;

  const [clinic, providers, board] = await Promise.all([
    getClinicSettings(actor).catch(() => null), listCareProviders(actor).catch(() => []), getWaitingRoomBoard(actor, { day }).catch(() => null),
  ]);
  if (!board) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>The waiting room could not be read</h3>
    <p>Nothing was changed. Confirm the database is running, then reload this page.</p>
    <Link className="button button-secondary" href="/staff/patients">Go to patients</Link>
  </div></div>, clinic?.name ?? "Your clinic");

  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><MonitorCheck /> Front desk</span>
        <h2 style={{ marginTop: 6 }}>Waiting room</h2>
        {/* This screen faces a room, so it carries times and states and nothing else. */}
        <p className="section-description">Times and states only: no names and no reasons appear here, because this screen can be seen from the waiting area.</p></div></div>
    </div>
    {actor.role === "admin" ? <p className="section-description">Administrator view: appointment updates are made by front-desk staff or clinicians.</p> : null}
    <Board
      day={board.day}
      timeZone={board.timeZone}
      providers={providers}
      entries={board.entries.map((entry) => ({ id: entry.id, status: entry.status, revision: entry.revision, providerId: entry.providerId,
        waitingMinutes: entry.waitingMinutes, startsAt: entry.startsAt.toISOString(),
        // Which moves this role may make is decided here, not in the browser.
        next: BOARD_MOVES.filter((status) => roleMayTransition(actor.role, status) && canTransition(entry.status as AppointmentStatus, status)) }))}
    />
  </>, clinic?.name ?? "Your clinic");
}
