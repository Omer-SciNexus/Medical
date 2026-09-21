import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { authConfigured } from "@/modules/identity";
export const metadata: Metadata = { title: "Create your workspace" };
export const dynamic = "force-dynamic";
export default function SignUpPage() { return <AuthForm mode="sign-up" configured={authConfigured()} />; }
