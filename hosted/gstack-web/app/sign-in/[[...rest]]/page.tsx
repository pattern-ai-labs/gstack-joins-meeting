"use client";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { isDevAuth } from "@/lib/auth-mode";

export default function SignInPage() {
  return (
    <AuthShell>
      {isDevAuth()
        ? <DevNotice mode="sign-in" />
        : <SignIn appearance={{ variables: { colorPrimary: "#b9f450" } }} />}
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 anim-fade">
      <div className="max-w-md w-full">
        <Link href="/" className="flex items-center gap-2 mb-8 justify-center">
          <span className="w-9 h-9 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-fg)] flex items-center justify-center font-bold">G</span>
          <span className="text-[18px] font-semibold">gstack</span>
        </Link>
        {children}
      </div>
    </div>
  );
}

function DevNotice({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <div className="card text-center p-8">
      <div className="text-[32px] mb-3 opacity-40">⚡</div>
      <h2 className="text-[16px] font-semibold mb-2">Dev mode — no {mode} required</h2>
      <p className="text-[12.5px] text-[var(--color-fg-soft)] mb-5">
        The frontend isn't configured with a Clerk publishable key, so it's running with
        a synthetic dev user (auto-promoted to admin). To enable real auth, set
        <code className="mono mx-1">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> in <code className="mono">.env.local</code>.
      </p>
      <Link href="/" className="btn btn-primary inline-flex">Enter dashboard</Link>
    </div>
  );
}
