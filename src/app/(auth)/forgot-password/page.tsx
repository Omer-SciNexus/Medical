import type { Metadata } from "next";
import { PasswordReset } from "@/components/auth/password-reset";
import { authConfigured } from "@/modules/identity";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function ForgotPasswordPage() { return <PasswordReset mode="request" configured={authConfigured()} />; }
