"use client";

import { ArrowRight, Loader2, Sprout } from "lucide-react";
import Link from "next/link";
import { useActionState, useId, useState } from "react";
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
        className="h-10 bg-card text-[15px]"
        required
      />
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SubmitButton({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <Button type="submit" size="lg" className="h-10 w-full text-[15px]" disabled={pending}>
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

function DemoButtonInner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="lg" className="h-10 w-full border-primary/30 bg-accent/60 text-[15px] hover:bg-accent" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Sprout className="text-primary" />}
      Try the demo account
    </Button>
  );
}

export function DemoSignIn({ next }: { next: string }) {
  return (
    <form action={demoSignInAction}>
      <input type="hidden" name="next" value={next} />
      <DemoButtonInner />
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

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to see your farms.</p>
      <div className="mt-6">
        <DemoSignIn next={next} />
      </div>
      <Divider />
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <FormMessage state={state} />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
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
        New to Yield AI?{" "}
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
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
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
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-muted-foreground select-none">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
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
