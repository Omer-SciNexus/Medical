import { ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, Clock3, LayoutDashboard, Plus, Users } from "lucide-react";
import { MeridianMark } from "@/components/design/graphics";

/** Editorial product illustration. All names and appointments are fictional. */
export function WorkspaceIllustration() {
  return <figure className="product-illustration" aria-label="Illustration of a Meridian clinic schedule using synthetic appointments">
    <div className="product-orbit orbit-one" /><div className="product-orbit orbit-two" />
    <div className="product-window" aria-hidden="true">
      <div className="product-rail"><MeridianMark /><span className="rail-active"><LayoutDashboard /></span><CalendarDays /><Users /><ClipboardList /><span className="rail-avatar">AK</span></div>
      <div className="product-main">
        <div className="product-topline"><span>Oakwell Clinic <ChevronRight /> Overview</span><span className="product-avatar">AK</span></div>
        <div className="product-greeting"><div><span className="product-kicker">MONDAY, 21 SEPTEMBER</span><h2>A little more clarity.<br />A better day of care.</h2></div><span className="product-sun">✳</span></div>
        <div className="product-summary"><div><span>Appointments</span><strong>12 <small>today</small></strong></div><div><span>Checked in</span><strong>04 <small>patients</small></strong></div><div><span>Your schedule</span><strong>09:00 <small>– 17:00</small></strong></div></div>
        <div className="product-schedule-title"><span><CalendarDays /> Today’s appointments</span><span><ChevronLeft /><ChevronRight /></span></div>
        <div className="product-appointment"><time>09:00</time><span className="product-patient-avatar">AD</span><div><strong>Alex Davis</strong><span>Follow-up · 20 min</span></div><span className="product-status"><Check /> Checked in</span></div>
        <div className="product-appointment product-selected"><time>09:30</time><span className="product-patient-avatar">JL</span><div><strong>Jamie Lee</strong><span>Consultation · 30 min</span></div><span className="product-status"><Clock3 /> Scheduled</span></div>
        <div className="product-appointment"><time>10:00</time><span className="product-patient-avatar">RM</span><div><strong>Robin Morgan</strong><span>Annual review · 30 min</span></div><span className="product-status"><Clock3 /> Scheduled</span></div>
        <div className="product-free-slot"><Plus /> Space for what comes next.</div>
      </div>
    </div>
    <div className="product-note" aria-hidden="true"><span className="product-note-icon"><Check /></span><div><strong>Every detail, connected.</strong><span>From the first hello to the follow-up.</span></div><ArrowUpRight /></div>
    <figcaption><span className="mini-cross">+</span> A preview of a calmer clinic day <span className="mono">M / 01</span></figcaption>
  </figure>;
}
