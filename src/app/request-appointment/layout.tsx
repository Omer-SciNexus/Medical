import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

// A clinic shares this page with its own patients, so it carries the clinic's name and none of
// Meridian's own marketing. Before a clinic is chosen, the page asks for its code instead.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function RequestLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell request-shell"><a className="skip-link" href="#request-main">Skip to form</a>
    <div className="auth-main-panel">
      <main id="request-main" className="auth-main">{children}</main>
      <footer className="auth-footer"><ShieldCheck /><span>Your request goes only to the clinic you choose here.</span></footer>
    </div>
  </div>;
}
