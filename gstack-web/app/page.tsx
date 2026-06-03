"use client";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { useState } from "react";
import { useApi, useApiSWR } from "@/lib/api";
import type { Specialist, Worker, Assignment } from "@/lib/types";

export default function Home() {
  return (
    <>
      <SignedOut>
        <div className="card text-center py-16">
          <h1 className="text-2xl font-semibold mb-2">Your engineering team, on the call.</h1>
          <p className="muted mb-6">Bring gstack specialists into Google Meet as voice bots.</p>
          <SignInButton mode="modal">
            <button className="primary">Sign in to dispatch</button>
          </SignInButton>
        </div>
      </SignedOut>
      <SignedIn><Dashboard /></SignedIn>
    </>
  );
}

function Dashboard() {
  const [meetUrl, setMeetUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"avatar" | "audio">("avatar");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string>("");

  const call = useApi();
  const { data: specsResp } = useApiSWR<{ specialists: Specialist[] }>("/api/specialists");
  const { data: workersResp, mutate: refreshWorkers } = useApiSWR<{ workers: Worker[] }>(
    "/api/workers");
  const { data: assignsResp, mutate: refreshAssignments } = useApiSWR<{ assignments: Assignment[] }>(
    "/api/assignments");

  const specialists = specsResp?.specialists ?? [];
  const workers = workersResp?.workers ?? [];
  const assignments = assignsResp?.assignments ?? [];

  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function dispatch() {
    setPending(true);
    setResult("");
    try {
      const body = {
        meetUrl,
        specialists: [...picked],
        brief,
        mode,
      };
      const r = await call<{ assignment_id: string; worker_id: string }>("/api/dispatch", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(`✓ assigned ${r.assignment_id} → worker ${r.worker_id}`);
      refreshWorkers();
      refreshAssignments();
    } catch (e: unknown) {
      const err = e as { message?: string; body?: { hint?: string } };
      setResult(`✗ ${err.message}${err.body?.hint ? ` (${err.body.hint})` : ""}`);
    } finally {
      setPending(false);
    }
  }

  async function recallAll() {
    await call<{ recalled: number }>("/api/recall", {
      method: "POST", body: JSON.stringify({ all: true }),
    });
    refreshWorkers();
  }

  return (
    <div className="space-y-8">
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Bring your <span className="text-[var(--color-accent)] italic">GStack team</span> into the meeting</h2>
        <div>
          <label className="muted text-xs">MEET URL</label>
          <input value={meetUrl} onChange={(e) => setMeetUrl(e.target.value)}
                 placeholder="https://meet.google.com/abc-defg-hij" />
        </div>
        <div>
          <label className="muted text-xs">BRIEF (optional)</label>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={2}
                    placeholder="Pitch we're discussing today, doc link, etc." maxLength={500} />
        </div>
        <div className="flex items-center gap-3">
          <select value={mode} onChange={(e) => setMode(e.target.value as "avatar" | "audio")} className="w-32">
            <option value="avatar">avatar</option>
            <option value="audio">audio</option>
          </select>
          <span className="muted text-sm">{picked.size} selected</span>
          <button className="primary ml-auto" disabled={pending || !meetUrl || picked.size === 0}
                  onClick={dispatch}>{pending ? "dispatching…" : "Dispatch selected →"}</button>
          <button onClick={recallAll} className="muted text-sm underline">Recall all</button>
        </div>
        {result && <div className="muted text-sm font-mono">{result}</div>}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Specialists</h2>
          <span className="muted text-xs">{specialists.length} available</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {specialists.map((s) => (
            <button key={s.id} onClick={() => toggle(s.id)}
                    className={`card text-left transition ${picked.has(s.id) ? "ring-2 ring-[var(--color-accent)]" : ""}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{ background: s.accent + "22", color: s.accent }}>{s.glyph}</span>
                <div>
                  <div className="font-semibold text-sm">{s.card_name || s.name}</div>
                  <div className="muted text-xs">{s.role}</div>
                </div>
              </div>
              <div className="text-xs">{s.desc_card || s.description}</div>
              <div className="muted text-xs mt-2 font-mono">/{s.id}</div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Workers <span className="muted text-xs">({workers.length})</span></h2>
        {workers.length === 0 ? (
          <div className="card muted text-sm">
            No workers online. Run <code>python3 worker.py</code> on a machine you own
            (after setting <code>~/.gstack/worker.json</code> with a key from the Workers page).
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {workers.map((w) => (
              <div key={w.id} className="card flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${w.state === "idle" ? "bg-green-400" : "bg-orange-400"}`} />
                <div className="flex-1 text-sm">
                  <div className="font-semibold">{w.name}</div>
                  <div className="muted text-xs">{w.platform} · {w.state}</div>
                </div>
                <span className="muted text-xs font-mono">{w.id}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent dispatches</h2>
        {assignments.length === 0 ? (
          <div className="card muted text-sm">No assignments yet.</div>
        ) : (
          <div className="space-y-2">
            {assignments.slice(0, 10).map((a) => (
              <div key={a.id} className="card flex items-center gap-3 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs ${a.status === "ended" ? "bg-green-900 text-green-300"
                  : a.status === "started" ? "bg-orange-900 text-orange-300"
                  : "bg-red-900 text-red-300"}`}>{a.status}</span>
                <span className="font-mono text-xs muted">{a.id.slice(0, 16)}</span>
                <span className="flex-1 truncate">{a.specialists.join(", ")}</span>
                <span className="muted text-xs">{a.billable_seconds ? `${a.billable_seconds}s` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
