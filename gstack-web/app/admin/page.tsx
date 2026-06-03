"use client";
import { useApi, useApiSWR } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { User, Assignment, Worker } from "@/lib/types";

export default function AdminPage() {
  const call = useApi();
  const toast = useToast();
  const { data: usersResp,   mutate: refreshUsers } = useApiSWR<{ users: User[] }>("/api/admin/users");
  const { data: workersResp }                       = useApiSWR<{ workers: Worker[] }>("/api/workers");
  const { data: assignsResp }                       = useApiSWR<{ assignments: Assignment[] }>("/api/assignments");

  const users = usersResp?.users ?? [];
  const workers = workersResp?.workers ?? [];
  const assignments = assignsResp?.assignments ?? [];

  async function setRole(uid: string, role: "admin" | "member") {
    try {
      await call(`/api/admin/users/${uid}/role`, { method: "POST", body: JSON.stringify({ role }) });
      toast.push({ kind: "ok", title: "Role updated" });
      refreshUsers();
    } catch (e) {
      toast.push({ kind: "err", title: "Update failed", body: (e as Error).message });
    }
  }

  const totalMin = users.reduce((sum, u) => sum + u.minutes_used, 0);
  const activeNow = assignments.filter((a) => a.status === "started").length;

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 anim-fade space-y-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Admin</h1>
        <p className="text-[13px] text-[var(--color-fg-soft)] mt-1">
          You see everything: every user, every worker, every dispatch.
        </p>
      </header>

      {/* metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Users"            value={users.length} />
        <Metric label="Workers online"   value={workers.length} sub={`${workers.filter((w) => w.state === "idle").length} idle`} />
        <Metric label="Active calls"     value={activeNow} />
        <Metric label="Total minutes"    value={totalMin} />
      </div>

      {/* users */}
      <section>
        <h2 className="text-[15px] font-semibold mb-3">All users</h2>
        <div className="surface overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[var(--color-panel-2)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">User</th>
                <th className="px-4 py-2.5 text-left font-semibold">Plan</th>
                <th className="px-4 py-2.5 text-right font-semibold">Usage</th>
                <th className="px-4 py-2.5 text-right font-semibold">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-panel-2)] transition">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.display_name || u.email || u.id}</div>
                    <div className="text-[11px] text-[var(--color-muted)]">{u.email || u.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="badge badge-muted">{u.plan}</span>
                  </td>
                  <td className="px-4 py-3 text-right mono text-[11.5px] text-[var(--color-fg-soft)]">
                    {u.minutes_used}/{u.quota_minutes} min
                  </td>
                  <td className="px-4 py-3 text-right">
                    <select
                      value={u.role}
                      onChange={(e) => setRole(u.id, e.target.value as "admin" | "member")}
                      className="!py-1 !px-2 !w-auto inline-block text-[11px]"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* workers */}
      <section>
        <h2 className="text-[15px] font-semibold mb-3">All workers <span className="text-[12px] text-[var(--color-muted)] font-normal ml-1">({workers.length})</span></h2>
        {workers.length === 0 ? (
          <div className="surface p-6 text-[12.5px] text-[var(--color-muted)] text-center">No workers online.</div>
        ) : (
          <div className="space-y-2">
            {workers.map((w) => (
              <div key={w.id} className="card flex items-center gap-3">
                <span className={`dot ${w.state === "idle" ? "dot-ok" : "dot-warn"}`} />
                <div className="flex-1">
                  <div className="text-[13px] font-medium">{w.name}</div>
                  <div className="text-[11px] text-[var(--color-muted)]">{w.platform} · owner <span className="mono">{w.owner_user_id}</span></div>
                </div>
                <span className="mono text-[11px] text-[var(--color-muted)]">{w.id}</span>
                <span className={`badge ${w.state === "idle" ? "badge-ok" : "badge-warn"}`}>{w.state}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* recent dispatches */}
      <section>
        <h2 className="text-[15px] font-semibold mb-3">Recent dispatches</h2>
        <div className="surface overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[var(--color-panel-2)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-left font-semibold">User</th>
                <th className="px-4 py-2.5 text-left font-semibold">Specialists</th>
                <th className="px-4 py-2.5 text-right font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody>
              {assignments.slice(0, 25).map((a) => (
                <tr key={a.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-panel-2)] transition">
                  <td className="px-4 py-3">
                    <span className={`badge ${
                      a.status === "started" ? "badge-warn" :
                      a.status === "ended"   ? "badge-ok"   :
                      "badge-bad"
                    }`}>{a.status}</span>
                  </td>
                  <td className="px-4 py-3 mono text-[11.5px] text-[var(--color-fg-soft)]">{a.user_id}</td>
                  <td className="px-4 py-3 text-[var(--color-fg-soft)]">{a.specialists.join(", ")}</td>
                  <td className="px-4 py-3 text-right mono text-[11.5px] text-[var(--color-fg-soft)]">
                    {a.billable_seconds ? `${a.billable_seconds}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="card">
      <div className="label-cap">{label}</div>
      <div className="text-[24px] font-semibold mt-1 tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-[var(--color-muted)] mt-1">{sub}</div>}
    </div>
  );
}
