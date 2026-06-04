"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth";
import { useApiSWR } from "@/lib/api";
import type { User } from "@/lib/types";

// Member nav — visible to everyone signed in. Just the action surface.
const MEMBER_NAV = [
  { href: "/",            label: "Dashboard",   icon: HomeIcon },
  { href: "/specialists", label: "Specialists", icon: GridIcon },
];

// Admin nav — hidden from members. Internal management surface for the
// operator running the demo pool. "Brains" is workers; Calls is the
// audit log; Admin is users + metrics.
const ADMIN_NAV = [
  { href: "/calls",   label: "Calls",   icon: CallIcon },
  { href: "/workers", label: "Brains",  icon: ChipIcon },
  { href: "/admin",   label: "Admin",   icon: ShieldIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: meResp } = useApiSWR<{ user: User }>("/api/me");
  const isAdmin = meResp?.user?.role === "admin";

  return (
    <aside className="w-56 shrink-0 h-screen sticky top-0 border-r border-[var(--color-border)] flex flex-col">
      <div className="px-5 pt-5 pb-6">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="w-7 h-7 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-fg)] flex items-center justify-center font-bold text-sm shadow-[0_0_0_3px_var(--color-accent-soft)]">G</span>
          <span className="text-[15px] font-semibold tracking-tight">gstack</span>
          <span className="text-[10px] mono text-[var(--color-muted)] mt-1">v2</span>
        </Link>
      </div>

      <nav className="px-3 flex-1 space-y-0.5">
        <SignedIn>
          {MEMBER_NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href} href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition ${
                  active
                    ? "bg-[var(--color-panel)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-soft)] hover:bg-[var(--color-panel)] hover:text-[var(--color-fg)]"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
                {active && <span className="ml-auto w-1 h-4 rounded-full bg-[var(--color-accent)]" />}
              </Link>
            );
          })}
          {isAdmin && (
            <>
              <div className="label-cap px-3 pt-5 pb-1.5">Admin</div>
              {ADMIN_NAV.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href} href={href}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition ${
                      active
                        ? "bg-[var(--color-panel)] text-[var(--color-fg)]"
                        : "text-[var(--color-fg-soft)] hover:bg-[var(--color-panel)] hover:text-[var(--color-fg)]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </>
          )}
        </SignedIn>
        <SignedOut>
          <div className="px-3 py-2 text-[13px] text-[var(--color-muted)]">Sign in to access the dashboard</div>
        </SignedOut>
      </nav>

      <SignedIn>
        <UserPill />
      </SignedIn>
    </aside>
  );
}

function UserPill() {
  const { data: meResp } = useApiSWR<{ user: User }>("/api/me");
  const u = meResp?.user;
  if (!u) return null;
  const used = u.minutes_used, quota = u.quota_minutes;
  const over = quota > 0 && used > quota;
  const pct = Math.min(100, Math.round((used / Math.max(1, quota)) * 100));
  return (
    <div className="m-3 p-3 surface text-[12px] space-y-2">
      <div className="flex items-center gap-2">
        <UserButton />
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium">{u.display_name || u.email || "you"}</div>
          <div className="text-[10px] text-[var(--color-muted)] truncate">{u.email}</div>
        </div>
        {u.role === "admin" && <span className="badge badge-accent">admin</span>}
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)] mb-1">
          <span>{over ? <span className="text-[var(--color-bad)]">over quota</span> : "usage"}</span>
          <span className="mono">{used} / {quota} min</span>
        </div>
        <div className="h-1 rounded-full bg-[var(--color-border)] overflow-hidden">
          <div
            className={`h-full transition-all ${over ? "bg-[var(--color-bad)]" : "bg-[var(--color-accent)]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── icons ─────────────────────────────────────────────────────────── */

function HomeIcon(p: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11.5L12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>;
}
function GridIcon(p: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3"  width="7" height="7" rx="1.5"/><rect x="14" y="3"  width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
}
function CallIcon(p: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 6a3 3 0 0 1 3-3h1.5l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2V15a3 3 0 0 1-3 3A15 15 0 0 1 3 6z"/></svg>;
}
function ChipIcon(p: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></svg>;
}
function ShieldIcon(p: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/></svg>;
}
