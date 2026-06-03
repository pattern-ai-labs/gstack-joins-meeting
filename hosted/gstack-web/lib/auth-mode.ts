/**
 * Server-safe — no "use client" pragma. Checked at both server-render
 * time (layout, middleware) and at client-render time (page bundles).
 */
export function isDevAuth(): boolean {
  const k = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  return !k.startsWith("pk_live_") && !k.startsWith("pk_test_");
}
