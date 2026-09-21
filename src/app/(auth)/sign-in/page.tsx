import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { authConfigured } from "@/modules/identity";
export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";
export default function SignInPage() { return <AuthForm mode="sign-in" configured={authConfigured()} />; }
