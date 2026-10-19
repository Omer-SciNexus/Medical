import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, Home, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings } from "@/modules/identity";
import { getClinicianQueue } from "@/modules/scheduling";
import { patientAge } from "@/modules/clinical";
import { clinicTimezone, todayInZone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { Queue } from "./queue";

export const metadata: Metadata = { title: "Today's clinic", robots: { index: false, follow: false } };
const shiftDay = (day: string, offset: number) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const actor = await requireActor(["clinician"]);
  const { day: requested } = await searchParams;
  const timeZone = (await getClinicSettings(actor).catch(() => null))?.timezone ?? clinicTimezone();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? "") ? requested! : todayInZone(timeZone);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Clinic</span><ChevronRight /><span>Today</span></>;
  let clinicName = "Your clinic";
  try {
    const [clinic, queue] = await Promise.all([getClinicSettings(actor), getClinicianQueue(actor, { day })]);
    clinicName = clinic?.name ?? clinicName;
    return <AppShell actor={actor} clinicName={clinicName} current="/clinical/today" breadcrumb={breadcrumb}>
      <div className="section-header">
        <div className="section-heading"><div><span className="eyebrow icon-label"><ClipboardList /> Clinic day</span>
          <h2 style={{ marginTop: 6 }}>{day === todayInZone(timeZone) ? "Today" : day}</h2>
          <p className="section-description">Appointments on your own sessions. Opening any chart is authorized per patient and recorded.</p></div></div>
        <div className="topbar-actions">
          <Link className="shortcut-button" href={`/clinical/today?day=${shiftDay(day, -1)}`} aria-label="Previous day"><ChevronLeft /></Link>
          <Link className="shortcut-button" href="/clinical/today">Today</Link>
          <Link className="shortcut-button" href={`/clinical/today?day=${shiftDay(day, 1)}`} aria-label="Next day"><ChevronRight /></Link>
        </div>
      </div>
      {/* Fields are picked explicitly: the browser receives an age, never a date of birth. */}
      <Queue day={queue.day} timeZone={queue.timeZone} entries={queue.entries.map((entry) => ({
        id: entry.id, patientId: entry.patientId, reason: entry.reason, status: entry.status, revision: entry.revision,
        waitingMinutes: entry.waitingMinutes, startsAt: entry.startsAt.toISOString(),
        givenName: entry.givenName, surname: entry.surname, sex: entry.sex, mrn: entry.mrn, age: patientAge(entry.birthDate),
      }))} />
    </AppShell>;
  } catch {
    return <AppShell actor={actor} clinicName={clinicName} current="/clinical/today" breadcrumb={breadcrumb}>
      <div className="specimen"><div className="state-panel error-example">
        <p className="empty-state-icon"><TriangleAlert /></p><h3>The clinic schedule is unavailable</h3>
        <p>Nothing was changed. Confirm the database and cache are running, then reload this page.</p>
      </div></div>
    </AppShell>;
  }
}
