import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/auth-forms";
import { safeNextPath } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  return <SignupForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}
