import Link from "next/link";
import { ArrowRight, ArrowUp, ArrowUpRight } from "lucide-react";
import { Brand } from "./brand";

const groups = [
  { title: "Discover", links: [{ href: "#platform", label: "The platform" }, { href: "#experience", label: "Patient experience" }, { href: "#security", label: "Trust & access" }, { href: "#news", label: "Health news" }, { href: "#testimonials", label: "Testimonials preview" }, { href: "#questions", label: "Common questions" }] },
  { title: "Get started", links: [{ href: "/design", label: "Explore the preview" }, { href: "/sign-up", label: "Create a workspace" }, { href: "/sign-in", label: "Sign in" }, { href: "/forgot-password", label: "Account recovery" }] },
];
// The account pages always render dynamically. A click that lands while Next.js is still prefetching one
// can fetch the page and never commit the navigation, so links to them skip prefetching.
const accountPages = new Set(["/sign-up", "/sign-in", "/forgot-password"]);

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-footer-panel">
      <div className="site-footer-main">
        <div className="site-footer-intro">
          <span className="site-footer-eyebrow"><span aria-hidden="true" /> CARE, WITH CLARITY</span>
          <h2>Better days.<br /><span>More human care.</span></h2>
          <p>A calmer place to bring your clinic together.<br />{" "}Made for the people behind every appointment.</p>
          <Link href="/sign-up" prefetch={false} className="site-footer-preview">Create your workspace <ArrowUpRight aria-hidden="true" /></Link>
        </div>
        <div className="site-footer-links">
          {groups.map((group, index) => <nav key={group.title} aria-labelledby={`footer-group-${index}`}><h3 id={`footer-group-${index}`}>{group.title}</h3>{group.links.map((link) => <Link href={link.href} key={link.href} prefetch={accountPages.has(link.href) ? false : undefined}>{link.label}<ArrowUpRight aria-hidden="true" /></Link>)}</nav>)}
          <a href="#platform" className="site-footer-discover"><span className="site-footer-discover-icon"><ArrowRight aria-hidden="true" /></span><span>One workspace. A connected clinic.<small>Meet Meridian</small></span></a>
        </div>
      </div>
      <div className="site-footer-signature"><Brand /><span>Thoughtfully connected.<br />From the first hello to the next visit.</span><a href="#top" className="site-back-top" aria-label="Back to top"><ArrowUp aria-hidden="true" /></a></div>
    </div>
    <div className="site-footer-bottom"><span>&copy; {new Date().getFullYear()} Meridian. All rights reserved.</span><span>Designed around your clinic.</span></div>
  </footer>;
}
