"use client";
import Link from "next/link";
import { SignedIn, SignedOut, SignInButton } from "@/lib/auth";
import { useApiSWR } from "@/lib/api";
import type { User } from "@/lib/types";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedOut><NotSignedIn /></SignedOut>
      <SignedIn><Guard>{children}</Guard></SignedIn>
    </>
  );
}

function Guard({ children }: { children: React.ReactNode }) {
  const { data, error, isLoading } = useApiSWR<{ user: User }>("/api/me");
  if (isLoading) return <CenteredCard>Checking permissions…</CenteredCard>;
  if (error)     return <Notice title="Can't reach the broker" body={(error as Error).message} kind="err" />;
  if (!data)     return <Notice title="No session" body="The broker didn't return your user row." kind="warn" />;
  if (data.user.role !== "admin")
    return <Notice title="Admin only" body="You're signed in, but members can't access admin." kind="info" />;
  return <>{children}</>;
}

function NotSignedIn() {
  return (
    <Notice
      title="Sign in required"
      body="Admin pages are only available to signed-in users with the admin role."
      kind="info"
      action={
        <SignInButton mode="modal">
          <button className="btn btn-primary mt-4">Sign in</button>
        </SignInButton>
      }
    />
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return <div className="max-w-md mx-auto py-24 px-8 text-center text-[13px] text-[var(--color-muted)] anim-fade">{children}</div>;
}

function Notice({
  title, body, kind, action,
}: { title: string; body: string; kind: "info" | "warn" | "err"; action?: React.ReactNode }) {
  const glyph = kind === "err" ? "✕" : kind === "warn" ? "!" : "⛨";
  return (
    <div className="max-w-md mx-auto py-24 px-8 text-center anim-fade">
      <div className={`text-[36px] mb-3 ${kind === "err" ? "text-[var(--color-bad)]" : kind === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-muted)]"} opacity-60`}>{glyph}</div>
      <h1 className="text-[20px] font-semibold mb-2">{title}</h1>
      <p className="text-[13px] text-[var(--color-fg-soft)]">{body}</p>
      {action}
      <div className="mt-6 text-[12px]">
        <Link href="/" className="muted hover:text-[var(--color-fg)] underline underline-offset-2">← back to dashboard</Link>
      </div>
    </div>
  );
}
