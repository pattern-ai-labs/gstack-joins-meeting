import "./globals.css";
import type { Metadata } from "next";
import { Provider as AuthProvider, SignInButton, SignedIn, SignedOut, UserButton } from "@/lib/auth";
import Link from "next/link";

export const metadata: Metadata = {
  title: "gstack — your engineering team, on the call",
  description: "Bring gstack specialists into your meeting as voice bots.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <html lang="en">
        <body>
          <header className="border-b border-[var(--color-border)]">
            <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 text-sm">
                <span className="w-6 h-6 rounded-md bg-[var(--color-accent)] text-black flex items-center justify-center font-bold">G</span>
                <span className="font-semibold">GStack</span>
                <span className="muted">×</span>
                <span className="font-semibold">AgentCall</span>
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <SignedIn>
                  <Link href="/" className="muted hover:text-[var(--color-fg)]">Dashboard</Link>
                  <Link href="/workers" className="muted hover:text-[var(--color-fg)]">Workers</Link>
                  <Link href="/admin" className="muted hover:text-[var(--color-fg)]">Admin</Link>
                  <UserButton />
                </SignedIn>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="primary">Sign in</button>
                  </SignInButton>
                </SignedOut>
              </nav>
            </div>
          </header>
          <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
        </body>
      </html>
    </AuthProvider>
  );
}
