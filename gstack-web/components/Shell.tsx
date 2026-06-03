"use client";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut } from "@/lib/auth";
import { Sidebar } from "./Sidebar";

/**
 * Layout shell that decides whether to show the app sidebar or hand
 * the page a full-bleed canvas (for the marketing landing). The /
 * route shows a full-bleed landing to signed-out visitors and the
 * sidebar-app to signed-in users. /landing is always full-bleed (so
 * the URL stays a sharable preview). Every other route uses the
 * sidebar layout, gated by route-level auth.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/landing";
  if (isLanding) return <>{children}</>;
  return (
    <>
      <SignedOut>
        {pathname === "/" ? children : <WithSidebar>{children}</WithSidebar>}
      </SignedOut>
      <SignedIn>
        <WithSidebar>{children}</WithSidebar>
      </SignedIn>
    </>
  );
}

function WithSidebar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
