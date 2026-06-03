"use client";
import { useApi, useApiSWR } from "@/lib/api";
import type { User, Assignment, Worker } from "@/lib/types";

export default function AdminPage() {
  const call = useApi();
  const { data: meResp } = useApiSWR<{ user: User }>("/api/me");
  const { data: usersResp, mutate: refreshUsers } = useApiSWR<{ users: User[] }>("/api/admin/users");
  const { data: workersResp } = useApiSWR<{ workers: Worker[] }>("/api/workers");
  const { data: assignsResp } = useApiSWR<{ assignments: Assignment[] }>("/api/assignments");

  if (!meResp) return <div className="muted">…</div>;
  if (meResp.user.role !== "admin") {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold mb-2">Admin</h1>
        <p className="muted">You don't have admin access. Ask the first user (auto-admin on first sign-in) to promote you.</p>
      </div>
    );
  }

  async function setRole(uid: string, role: "admin" | "member") {
    await call(`/api/admin/users/${uid}/role`, {
      method: "POST", body: JSON.stringify({ role }),
    });
    refreshUsers();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <section>
        <h2 className="font-semibold mb-3">All users <span className="muted text-xs">({usersResp?.users.length ?? 0})</span></h2>
        <div className="space-y-2">
          {(usersResp?.users ?? []).map((u) => (
            <div key={u.id} className="card flex items-center gap-3 text-sm">
              <div className="flex-1">
                <div className="font-semibold">{u.display_name || u.email || u.id}</div>
                <div className="muted text-xs">{u.email} · {u.plan} · {u.minutes_used}/{u.quota_minutes} min used</div>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs ${u.role === "admin" ? "bg-[var(--color-accent)] text-black" : "bg-[var(--color-border)]"}`}>{u.role}</span>
              <select value={u.role} onChange={(e) => setRole(u.id, e.target.value as "admin" | "member")}
                      className="w-32 text-xs">
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">All workers</h2>
        <div className="space-y-2">
          {(workersResp?.workers ?? []).map((w) => (
            <div key={w.id} className="card flex items-center gap-3 text-sm">
              <span className={`w-2 h-2 rounded-full ${w.state === "idle" ? "bg-green-400" : "bg-orange-400"}`} />
              <div className="flex-1">
                <div className="font-semibold">{w.name}</div>
                <div className="muted text-xs">{w.platform} · owner {w.owner_user_id}</div>
              </div>
              <span className="muted text-xs font-mono">{w.id}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">All assignments</h2>
        <div className="space-y-2">
          {(assignsResp?.assignments ?? []).slice(0, 30).map((a) => (
            <div key={a.id} className="card flex items-center gap-3 text-sm">
              <span className={`px-2 py-0.5 rounded text-xs ${a.status === "ended" ? "bg-green-900 text-green-300"
                  : a.status === "started" ? "bg-orange-900 text-orange-300"
                  : "bg-red-900 text-red-300"}`}>{a.status}</span>
              <span className="font-mono text-xs muted">{a.id.slice(0, 16)}</span>
              <span className="muted text-xs">{a.user_id.slice(0, 12)}</span>
              <span className="flex-1 truncate">{a.specialists.join(", ")}</span>
              <span className="muted text-xs">{a.billable_seconds ? `${a.billable_seconds}s` : ""}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
