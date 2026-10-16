import type { Metadata } from "next";
import { PasswordReset } from "@/components/auth/password-reset";
import { authConfigured } from "@/modules/identity";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  // The token is validated when it is spent, not here: this page only carries it into the form.
  return <PasswordReset mode="complete" configured={authConfigured()} token={/^[a-f0-9]{64}$/.test(token ?? "") ? token : undefined} />;
}
