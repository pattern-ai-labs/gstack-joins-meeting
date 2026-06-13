"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth";
import { useApiSWR } from "@/lib/api";
import type { User } from "@/lib/types";

// Member nav — visible to everyone signed in. Just the action surface.
// BYOB lives here so members who hit the "pool busy" modal can find
// the bring-your-own-brain flow without admin context.
const MEMBER_NAV = [
  { href: "/",            label: "Dashboard",        icon: HomeIcon  },
  { href: "/specialists", label: "Specialists",      icon: GridIcon  },
  { href: "/byob",        label: "Bring your brain", icon: BrainIcon },
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
    <aside className="hidden md:flex w-56 shrink-0 h-screen sticky top-0 border-r border-[var(--color-border)] flex-col">
      <div className="px-5 pt-5 pb-6">
        {/* gstack × agentcall lockup — matches the landing topbar/footer.
            G tile + wordmark at 14px fits the 224px sidebar. */}
        <Link href="/" className="flex items-center gap-1.5 group">
          <span className="w-7 h-7 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-fg)] flex items-center justify-center font-bold text-sm shadow-[0_0_0_3px_var(--color-accent-soft)] mr-0.5">G</span>
          <span className="text-[14px] font-semibold tracking-tight text-[var(--color-accent)]">gstack</span>
          <span className="text-[11px] font-bold" style={{ color: "#ff6b2b" }}>✕</span>
          <span className="text-[14px] font-semibold tracking-tight" style={{ color: "#f4eedd" }}>agentcall</span>
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

      <BrokerStatus />
    </aside>
  );
}

/* Tiny dot + label at the very bottom of the sidebar. Polls the broker's
 * /healthz every 10s and shows live/down. Free debugging signal for
 * visitors when the demo isn't responding — and a tiny "the demo is on"
 * confirmation when it is. */
function BrokerStatus() {
  const { data, error, isLoading } = useApiSWR<{ ok: boolean }>(
    "/healthz",
    { refreshInterval: 10000, allowSignedOut: true },
  );
  const up = !error && data?.ok === true;
  const checking = isLoading && !data && !error;

  return (
    <div className="px-5 pb-3 pt-1 flex items-center gap-2 text-[10.5px] mono text-[var(--color-muted)]">
      <span className={`dot ${checking ? "dot-mute" : up ? "dot-ok pulse" : "dot-bad"}`} />
      <span className="uppercase tracking-wider">
        {checking ? "checking…" : up ? "demo live" : "demo offline"}
      </span>
    </div>
  );
}

function UserPill() {
  const { data: meResp } = useApiSWR<{ user: User }>("/api/me");
  const u = meResp?.user;
  if (!u) return null;
  // Prefer real display name (from Clerk); fall back to the local part of
  // the email, then "you". Avoids showing internal user-id ("user_dev_local")
  // or raw email when a friendlier label exists.
  const displayName =
    u.display_name?.trim() ||
    (u.email?.includes("@") ? u.email.split("@")[0] : null) ||
    "you";
  return (
    <>
      <a
        href="https://github.com/pattern-ai-labs/gstack-joins-meeting"
        target="_blank" rel="noopener noreferrer"
        className="mx-3 mb-2 surface px-3 py-2.5 text-[12px] flex items-center gap-2 hover:bg-[var(--color-panel-2)] transition group"
        title="The whole project is open source — clone + run with your own coding agent session"
      >
        <span className="text-[14px]">⌥</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium">Run gstack locally</div>
          <div className="text-[10px] text-[var(--color-muted)]">
            inspired by <span className="text-[var(--color-accent)]">@garrytan</span> · MIT
          </div>
        </div>
        <span className="text-[12px] text-[var(--color-muted)] group-hover:text-[var(--color-fg)]">→</span>
      </a>
      <div className="m-3 p-3 surface text-[12px]">
        <div className="flex items-center gap-2">
          <UserButton />
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium">{displayName}</div>
            {u.email && <div className="text-[10px] text-[var(--color-muted)] truncate">{u.email}</div>}
          </div>
          {u.role === "admin" && <span className="badge badge-accent">admin</span>}
        </div>
      </div>
    </>
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
function BrainIcon(p: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 3a3 3 0 0 0-3 3v0a3 3 0 0 0-2 5v0a3 3 0 0 0 1 5v0a3 3 0 0 0 4 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z"/><path d="M15 3a3 3 0 0 1 3 3v0a3 3 0 0 1 2 5v0a3 3 0 0 1-1 5v0a3 3 0 0 1-4 3 3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/></svg>;
}
