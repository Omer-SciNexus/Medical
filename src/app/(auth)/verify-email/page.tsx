import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MailCheck, MailWarning } from "lucide-react";
import { confirmEmailVerification } from "@/modules/identity";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const confirmed = await confirmEmailVerification(token).catch(() => false);
  return <div className="auth-content">
    <div className="auth-title-icon">{confirmed ? <MailCheck /> : <MailWarning />}</div>
    <span className="public-eyebrow">EMAIL ADDRESS</span>
    <h1>{confirmed ? "Thank you — that's confirmed." : "This link cannot be used."}</h1>
    <p className="auth-description">{confirmed
      ? "Your address is confirmed. You can now invite colleagues, which sends mail in your clinic's name."
      : "It may have expired, been used already, or the address may be confirmed. Confirmation links work once and last 24 hours; a new one can be sent from your account's security page."}</p>
    <p className="auth-switch"><Link href={confirmed ? "/dashboard" : "/account/security"}>{confirmed ? "Open your workspace" : "Go to security settings"} <ArrowRight /></Link></p>
  </div>;
}
