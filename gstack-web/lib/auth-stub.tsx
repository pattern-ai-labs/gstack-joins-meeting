"use client";
/**
 * Dev-mode stubs for Clerk components. See lib/auth.tsx for the switch logic.
 * isDevAuth() lives in lib/auth-mode.ts (server-safe) so the conditional
 * import in lib/auth.tsx can run on both server and client.
 */
import React from "react";

export function StubProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function StubSignedIn({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
export function StubSignedOut(_: { children: React.ReactNode }) { return null; }

export function StubSignInButton({ children }: { mode?: string; children: React.ReactNode }) {
  return <>{children}</>;
}

export function StubUserButton() {
  return <span className="muted text-xs">dev-user</span>;
}

export function useStubAuth() {
  return { getToken: async () => null };
}
