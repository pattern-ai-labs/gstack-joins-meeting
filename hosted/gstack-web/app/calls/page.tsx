"use client";
import { useApiSWR } from "@/lib/api";
import type { Assignment } from "@/lib/types";

export default function CallsPage() {
  const { data } = useApiSWR<{ assignments: Assignment[] }>("/api/assignments");
  const items = data?.assignments ?? [];

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 anim-fade">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Calls</h1>
        <p className="text-[13px] text-[var(--color-fg-soft)] mt-1">
          Every dispatch you've made. Active calls appear at the top.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="surface p-12 text-center text-[14px] text-[var(--color-muted)] anim-up">
          No calls yet. Head to the dashboard, paste a Meet URL, dispatch.
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[var(--color-panel-2)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-left font-semibold">When</th>
                <th className="px-4 py-2.5 text-left font-semibold">Specialists</th>
                <th className="px-4 py-2.5 text-left font-semibold">Meet</th>
                <th className="px-4 py-2.5 text-right font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const meetHost = (() => { try { return new URL(a.meet_url).hostname; } catch { return a.meet_url; } })();
                const when = a.created_at ? new Date(a.created_at) : null;
                return (
                  <tr key={a.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-panel-2)] transition">
                    <td className="px-4 py-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-[var(--color-fg-soft)]">
                      {when ? when.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 flex-wrap items-center">
                        {a.specialists.map((id) => (
                          <span key={id} className="badge badge-muted mono inline-flex items-center gap-1.5 !py-1 !pl-1 !pr-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/avatars/${id}.svg`}
                              alt=""
                              width={16} height={16}
                              className="w-4 h-4 rounded-full"
                              loading="lazy"
                            />
                            /{id}
                          </span>
                        ))}
                      </div>
                      {a.brief && <div className="text-[11px] text-[var(--color-muted)] mt-1 italic">{a.brief}</div>}
                    </td>
                    <td className="px-4 py-3 mono text-[11.5px] text-[var(--color-fg-soft)]">{meetHost}</td>
                    <td className="px-4 py-3 text-right mono text-[11.5px] text-[var(--color-fg-soft)]">
                      {a.billable_seconds ? `${Math.floor(a.billable_seconds / 60)}m ${a.billable_seconds % 60}s` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "started" ? "badge-warn" :
    status === "ended"   ? "badge-ok"   :
    status === "failed"  ? "badge-bad"  :
                           "badge-muted";
  return <span className={`badge ${cls}`}>{status}</span>;
}
