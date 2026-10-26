import type { Metadata } from "next";
import Link from "next/link";
import { MailWarning } from "lucide-react";
import { AuthForm } from "@/components/auth/auth-form";
import { authConfigured, describeInvitation } from "@/modules/identity";

export const metadata: Metadata = { title: "Accept your invitation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  // An invalid, expired, revoked or already-used link is indistinguishable from here on
  // purpose: the page never says which, and never reveals who was invited.
  const invitation = token ? await describeInvitation(token).catch(() => null) : null;
  if (!invitation || !token) return <div className="auth-content">
    <div className="auth-title-icon"><MailWarning /></div>
    <span className="public-eyebrow">INVITATION</span>
    <h1>This link cannot be used.</h1>
    <p className="auth-description">It may have expired, been used already, or been revoked. Ask whoever invited you to send a new one — each link is single-use.</p>
    <p className="auth-switch"><Link href="/sign-in" prefetch={false}>Go to sign-in</Link></p>
  </div>;
  return <AuthForm mode="accept-invite" configured={authConfigured()} invitation={{ ...invitation, token }} />;
}
