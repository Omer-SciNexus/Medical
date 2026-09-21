import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/public/brand";
import { CareGraphic } from "@/components/design/graphics";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell"><a className="skip-link" href="#auth-main">Skip to form</a><aside className="auth-story" aria-label="About Meridian"><Brand inverse /><div className="auth-story-content"><span className="public-eyebrow">A WORKSPACE WITH CARE AT ITS CORE</span><h2>The work of care.<br /><span>A little more connected.</span></h2><p>A clearer day for your team.<br />A calmer experience for your patients.</p><CareGraphic /><div className="auth-story-principles"><span><Check /> Built around people</span><span><Check /> Considered in every detail</span></div></div><div className="auth-story-footer"><span>Considered software. Connected care.</span><span className="mono">M / 01</span></div></aside><div className="auth-main-panel"><header className="auth-topline"><Link href="/" className="auth-back"><ArrowLeft /> Back to home</Link><Link href="/design">Explore the preview <span aria-hidden="true">↗</span></Link></header><div className="auth-mobile-brand"><Brand /></div><main id="auth-main" className="auth-main">{children}</main><footer className="auth-footer"><ShieldCheck /><span>Your workspace. Your people. Connected with care.</span></footer></div></div>;
}
