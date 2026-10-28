import type { Metadata } from "next";
// Bundled font files rather than next/font/google: a build must not depend on Google Fonts
// answering, which it intermittently fails to do in CI.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import "./public.css";

export const metadata: Metadata = { title: { default: "Meridian — More room for care", template: "%s · Meridian" }, description: "A considered workspace for the people who care. Bring your clinic day into focus with Meridian.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
