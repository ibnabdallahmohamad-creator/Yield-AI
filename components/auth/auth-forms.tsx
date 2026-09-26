"use client";

import { ArrowRight, Loader2, Sprout } from "lucide-react";
import Link from "next/link";
import { useActionState, useId, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { demoSignInAction, signInAction, signUpAction, type AuthFormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  error,
  hint,
  placeholder,
  autoFocus,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="h-11 bg-card text-base sm:h-10 sm:pointer-coarse:h-11"
        required
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SubmitButton({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <Button type="submit" size="lg" className="h-11 w-full text-base sm:h-10 sm:pointer-coarse:h-11" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

function FormMessage({ state }: { state: AuthFormState | undefined }) {
  if (!state?.error && !state?.notice) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={cn(
        "rounded-lg px-3 py-2 text-sm",
        state.error ? "bg-risk-high-soft text-risk-high-ink" : "bg-risk-low-soft text-risk-low-ink",
      )}
    >
      {state.error ?? state.notice}
    </p>
  );
}

function DemoButtonInner({ label, className }: { label: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="lg"
      className={cn("h-11 w-full border-primary/30 bg-accent/60 text-base hover:bg-accent sm:h-10 sm:pointer-coarse:h-11", className)}
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Sprout className="text-primary" />}
      {label}
    </Button>
  );
}

/** One click into the demo account (the sign-in page, and the landing page's hero). */
export function DemoSignIn({ next, label = "Try the demo account", className }: { next: string; label?: string; className?: string }) {
  return (
    <form action={demoSignInAction}>
      <input type="hidden" name="next" value={next} />
      <DemoButtonInner label={label} className={className} />
    </form>
  );
}

function Divider() {
  return (
    <div className="relative my-5 text-center text-xs text-muted-foreground">
      <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
      <span className="relative bg-background px-3">or</span>
    </div>
  );
}

const LOGIN_NOTICES: Record<string, AuthFormState> = {
  confirmed: { notice: "Your email is confirmed. Sign in to continue." },
  "link-expired": { error: "That confirmation link has expired or was already used. If you confirmed your email, just sign in." },
};

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

/** Supabase reports a reused or expired email link in the URL fragment, which only the browser sees. */
function useLinkNotice(notice: string | undefined): AuthFormState | undefined {
  const linkFailed = useSyncExternalStore(
    subscribeToHash,
    () => /(^|&)error(_code)?=/.test(window.location.hash.slice(1)),
    () => false,
  );
  if (linkFailed) return LOGIN_NOTICES["link-expired"];
  return notice ? LOGIN_NOTICES[notice] : undefined;
}

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = useActionState(signInAction, undefined);
  const linkNotice = useLinkNotice(notice);
  return (
    <div>
      <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to see your farms.</p>
      <div className="mt-6">
        <DemoSignIn next={next} />
      </div>
      <Divider />
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <FormMessage state={state ?? linkNotice} />
        <Field
          label="Email or username"
          name="email"
          type="text"
          autoComplete="username"
          placeholder="you@farm.qa"
          defaultValue={state?.values?.email}
          error={state?.fieldErrors?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={state?.fieldErrors?.password}
        />
        <SubmitButton pending={pending}>
          Sign in <ArrowRight />
        </SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Harvestar AI?{" "}
        <Link href={next !== "/dashboard" ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-primary underline-offset-4 hover:underline">
          Create a free account
        </Link>
      </p>
    </div>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUpAction, undefined);
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div>
      <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Free and open-source — no card, no trial.</p>
      <form action={action} className="mt-6 space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <FormMessage state={state} />
        <Field label="Name" name="name" autoComplete="name" placeholder="Fatima Al-Kuwari" defaultValue={state?.values?.name} error={state?.fieldErrors?.name} />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@farm.qa"
          defaultValue={state?.values?.email}
          error={state?.fieldErrors?.email}
        />
        <div className="space-y-1.5">
          <Field
            label="Password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            hint="At least 8 characters."
            error={state?.fieldErrors?.password}
          />
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none sm:min-h-8 sm:pointer-coarse:min-h-11">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            Show password
          </label>
        </div>
        <SubmitButton pending={pending}>
          Create account <ArrowRight />
        </SubmitButton>
      </form>
      <Divider />
      <DemoSignIn next={next} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={next !== "/dashboard" ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
