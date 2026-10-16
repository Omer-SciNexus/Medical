"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, DoorOpen, Loader2, LogIn, RefreshCw, UserX } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { advanceFromBoardAction } from "@/app/staff/actions";

type Entry = { id: string; status: string; revision: number; providerId: string; waitingMinutes: number | null; startsAt: string; next: readonly string[] };
const REFRESH_SECONDS = 30;
// How each permitted move is labelled. Whether it is permitted was decided on the server.
const MOVES = {
  checked_in: { label: "Check in", icon: LogIn, variant: "primary" as const },
  rooming: { label: "To a room", icon: DoorOpen, variant: "primary" as const },
  ready: { label: "Ready", icon: CheckCircle2, variant: "primary" as const },
  no_show: { label: "No show", icon: UserX, variant: "ghost" as const },
};
const tone = (status: string) => status === "ready" ? "accent" : status === "in_progress" ? "high" : status === "done" ? "neutral" : status === "cancelled" || status === "no_show" ? "critical" : "neutral";

export function Board({ entries, day, timeZone, providers }: { entries: Entry[]; day: string; timeZone: string; providers: { id: string; displayName: string }[] }) {
  const router = useRouter();
  const [state, advance, pending] = useActionState(advanceFromBoardAction, idleAction);
  // A refresh channel until live updates exist: the board re-reads itself on a timer.
  React.useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [router]);
  const nameOf = (providerId: string) => providers.find((provider) => provider.id === providerId)?.displayName ?? "Clinic";
  const waiting = entries.filter((entry) => entry.status === "checked_in" || entry.status === "rooming" || entry.status === "ready");

  return <>
    {state.error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{state.error}</p> : null}
    <div className="board-summary">
      <div><span className="board-count">{waiting.length}</span><span>waiting now</span></div>
      <div><span className="board-count">{entries.filter((entry) => entry.status === "in_progress").length}</span><span>in a room</span></div>
      <div><span className="board-count">{entries.filter((entry) => entry.status === "done").length}</span><span>seen today</span></div>
      <button type="button" className="shortcut-button" onClick={() => router.refresh()}><RefreshCw />Refresh</button>
    </div>
    {!entries.length ? <div className="specimen"><div className="state-panel" style={{ textAlign: "center", padding: "56px 24px" }}>
      <h3>Nothing booked on {day}</h3><p>When appointments are booked for this day they appear here as times, without names.</p>
    </div></div> : <ul className="board-list">{entries.map((entry) => <li key={entry.id} data-state={entry.status}>
      <div className="board-when">
        <strong>{new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(entry.startsAt))}</strong>
        <span>{nameOf(entry.providerId)}</span>
      </div>
      <div className="board-state">
        <Badge tone={tone(entry.status)}>{entry.status.replace("_", " ")}</Badge>
        {entry.waitingMinutes !== null && entry.status !== "done" ? <span className="board-waited">{entry.waitingMinutes} min</span> : null}
      </div>
      <div className="board-actions">
        {entry.next.map((status) => {
          const move = MOVES[status as keyof typeof MOVES];
          if (!move) return null;
          const Icon = move.icon;
          return <form key={status} action={advance}>
            <input type="hidden" name="appointmentId" value={entry.id} /><input type="hidden" name="revision" value={entry.revision} /><input type="hidden" name="status" value={status} />
            <Button type="submit" size="small" variant={move.variant} disabled={pending}>{pending ? <Loader2 /> : <Icon />}{move.label}</Button>
          </form>;
        })}
      </div>
    </li>)}</ul>}
    <div className="queue-footer"><span>Refreshes every {REFRESH_SECONDS} seconds. Each move is recorded against your account, and only a clinician can start or finish a visit.</span></div>
  </>;
}
