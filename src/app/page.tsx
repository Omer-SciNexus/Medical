import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, ClipboardList, Fingerprint, HeartHandshake, LockKeyhole, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { HealthNews } from "@/components/public/health-news";
import { Testimonials } from "@/components/public/testimonials";
import { WorkflowTour } from "@/components/public/workflow-tour";

export const metadata: Metadata = { title: "Meridian — More room for care", description: "A connected clinic workspace for appointments, clinical notes, and patient follow-up. Explore Meridian with a guided sample visit." };

const features = [
  { icon: CalendarDays, number: "01", title: "A clearer clinic day.", text: "Bring appointments, arrivals, and the waiting room into one connected flow.", detail: "Scheduling & reception", image: "outpatient-consultation.webp", alt: "A physician discussing an outpatient visit with a patient", className: "feature-schedule" },
  { icon: ClipboardList, number: "02", title: "Context for every visit.", text: "Keep patient context, observations, and clinical notes close to the work of care.", detail: "The clinical workspace", image: "clinical-documentation.webp", alt: "A clinician documenting a visit at a clinical workstation", className: "feature-clinical" },
  { icon: HeartHandshake, number: "03", title: "A simpler patient journey.", text: "Give patients a clear way to book, review appointments, and read their visit summaries.", detail: "The patient experience", image: "medical-exam-room.webp", alt: "A bright examination room with modern outpatient equipment", className: "feature-patient" },
];

export default function Home() {
  return <div className="public-site" id="top">
    <a className="skip-link" href="#main">Skip to content</a><SiteHeader />
    <main id="main">
      <section className="marketing-photo-hero">
        <div className="photo-hero-media"><Image src="/images/meridian/hero-vitals.webp" alt="A clinician checking a patient’s blood pressure beside a modern vital-signs monitor" fill priority sizes="100vw" /></div>
        <div className="public-container marketing-hero"><div className="marketing-hero-copy">
          <Link href="#experience" className="marketing-pill"><span className="pill-tag">Preview</span> Walk through a clinic visit <ArrowRight aria-hidden="true" /></Link>
          <h1>Less between you<br />and <span>better care.</span></h1>
          <p>Manage appointments, clinical notes, and patient follow-up in one connected clinic workspace.</p>
          <div className="marketing-hero-actions"><Link href="/sign-up" className="public-button">Create your workspace <ArrowUpRight aria-hidden="true" /></Link><Link href="#experience" className="public-button public-button-outline">Explore the preview <ArrowRight aria-hidden="true" /></Link></div>
          <div className="marketing-hero-note"><span><Check aria-hidden="true" /> For clinic owners & teams</span><span><Check aria-hidden="true" /> Explore with sample data</span></div>
        </div></div>
      </section>
      <section className="public-container marketing-section platform-overview" id="platform">
        <div className="marketing-section-heading"><div><span className="public-eyebrow">ONE WORKSPACE. EVERY STEP.</span><h2>Built around your clinic day.</h2></div><p>Practical tools for your team.<br />A clear path for your patients.</p></div>
        <div className="marketing-features">{features.map(({icon: Icon, ...feature}) => <article className={`marketing-feature photo-feature ${feature.className}`} key={feature.number}>
          <div className="feature-photo"><Image src={`/images/meridian/${feature.image}`} alt={feature.alt} fill sizes="(max-width: 700px) 100vw, 33vw" /></div>
          <div className="feature-copy"><div className="feature-icon-row"><span className="feature-icon"><Icon aria-hidden="true" /></span><span className="mono">{feature.number}</span></div><h3>{feature.title}</h3><p>{feature.text}</p><Link href="#experience" className="feature-detail"><span>{feature.detail}</span><ArrowUpRight aria-hidden="true" /></Link></div>
        </article>)}</div>
      </section>
      <WorkflowTour />
      <section className="public-container marketing-section marketing-security" id="security"><div><span className="public-eyebrow">TRUST & ACCESS</span><h2>Careful access. Clear accountability.</h2><p>Controls designed around the people and responsibilities in your clinic.</p></div><div className="security-items"><article><Fingerprint aria-hidden="true" /><h3>An extra layer of assurance</h3><p>Authenticator verification for clinic team accounts, with recovery codes for when you need them.</p></article><article><LockKeyhole aria-hidden="true" /><h3>Access with a purpose</h3><p>Role and care-relationship controls shape what each person can access.</p></article><article><ShieldCheck aria-hidden="true" /><h3>A record of important actions</h3><p>Audit records help your clinic review sensitive actions with context.</p></article></div></section>
      <Testimonials />
      <HealthNews />
      <section className="public-container marketing-faq" id="questions"><div><span className="public-eyebrow">A FEW HELPFUL DETAILS</span><h2>Before you begin.</h2></div><div className="marketing-questions">
        <details><summary>What can I explore today?<ChevronDown aria-hidden="true" /></summary><p>Follow the sample visit above or explore the design library. Both use fictional data. The development workspace includes booking, clinical notes, and patient summaries; availability depends on your clinic’s configuration.</p></details>
        <details><summary>Who is a workspace for?<ChevronDown aria-hidden="true" /></summary><p>A new workspace is for a clinic owner or administrator. Already part of a clinic? <Link href="/sign-in">Sign in to your existing account</Link> or ask your clinic for an invitation.</p></details>
        <details><summary>Can I try the interface before creating an account?<ChevronDown aria-hidden="true" /></summary><p>Yes. <Link href="/design">Open the design preview</Link> to explore the interface with synthetic sample data. It does not book appointments or change medical records.</p></details>
      </div></section>
    </main><SiteFooter />
  </div>;
}
