"use client";
import { useState } from "react";
import { useApi, useApiSWR } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { Assignment, Worker } from "@/lib/types";

export function ActiveCallsRail() {
  const call = useApi();
  const toast = useToast();
  const { data: workersResp, mutate: refreshWorkers } = useApiSWR<{ workers: Worker[] }>("/api/workers");
  const { data: assignsResp, mutate: refreshAssignments } = useApiSWR<{ assignments: Assignment[] }>("/api/assignments");

  const workers = workersResp?.workers ?? [];
  const active = (assignsResp?.assignments ?? []).filter((a) => a.status === "started");

  async function recall(worker_id?: string) {
    try {
      const r = await call<{ recalled: number }>("/api/recall", {
        method: "POST", body: JSON.stringify(worker_id ? { worker_id } : { all: true }),
      });
      toast.push({ kind: "ok", title: "Recalled", body: `${r.recalled} worker${r.recalled === 1 ? "" : "s"} freed` });
      refreshWorkers(); refreshAssignments();
    } catch (e) {
      toast.push({ kind: "err", title: "Recall failed", body: (e as Error).message });
    }
  }

  return (
    <aside className="w-[320px] shrink-0 h-[calc(100vh-32px)] sticky top-4 mr-4 my-4 surface flex flex-col anim-fade">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">Now in meeting</div>
          <div className="text-[11px] text-[var(--color-muted)]">{active.length} active · {workers.length} worker{workers.length === 1 ? "" : "s"}</div>
        </div>
        {active.length > 0 && (
          <button className="btn btn-danger text-[11px] py-1.5 px-2.5" onClick={() => recall()}>Recall all</button>
        )}
      </div>

      <div className="flex-1 scroll-y px-4 py-3 space-y-3">
        {active.length === 0 && workers.length === 0 && (
          <EmptyRail title="No workers online" body="Start a worker daemon on a machine you own. Open Workers → mint a key → run the one-liner." />
        )}
        {active.length === 0 && workers.length > 0 && (
          <EmptyRail title="No active calls" body={`${workers.filter((w) => w.state === "idle").length} idle worker(s) ready. Dispatch from the main panel.`} />
        )}
        {active.map((a) => <ActiveCallCard key={a.id} a={a} onRecall={recall} />)}
        {workers.length > 0 && (
          <div className="pt-2 mt-3 border-t border-[var(--color-border)] space-y-2">
            <div className="label-cap mb-1">Workers</div>
            {workers.map((w) => <WorkerRow key={w.id} w={w} />)}
          </div>
        )}
      </div>
    </aside>
  );
}

function ActiveCallCard({ a, onRecall }: { a: Assignment; onRecall: (worker_id?: string) => void }) {
  const [msg, setMsg] = useState("");
  const call = useApi();
  const toast = useToast();

  async function sendMessage() {
    if (!msg.trim()) return;
    try {
      // Phase 2 doesn't yet have a /api/say endpoint — placeholder for the
      // broker→worker stdin pipe we'll add in Phase 3. For now: chat-via-recall-tunnel
      // would need that endpoint. Show "coming soon" toast.
      toast.push({ kind: "info", title: "Speak via outbox", body: "Direct UI→bot messaging ships in Phase 3. For now: edit the bot's outbox on the worker." });
      setMsg("");
    } catch (e) {
      toast.push({ kind: "err", title: "Send failed", body: (e as Error).message });
    }
  }

  const start = a.created_at ? new Date(a.created_at).getTime() : Date.now();
  const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
  const meetHost = (() => { try { return new URL(a.meet_url).hostname; } catch { return a.meet_url; } })();

  return (
    <div className="surface p-3 anim-up">
      <div className="flex items-center gap-2 mb-2">
        <span className="dot dot-warn pulse" />
        <span className="text-[12px] font-medium">{a.specialists.join(", ")}</span>
        <span className="ml-auto badge badge-warn">live</span>
      </div>
      <div className="text-[11px] text-[var(--color-muted)] truncate mono">{meetHost}</div>
      <div className="text-[11px] text-[var(--color-muted)] mt-1">{Math.floor(elapsed / 60)}m {elapsed % 60}s · {a.mode}</div>
      <div className="mt-3 flex gap-2">
        <input
          value={msg} onChange={(e) => setMsg(e.target.value)}
          placeholder="Send a quick line…"
          className="flex-1 !py-1.5 !px-2 text-[12px]"
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button className="btn btn-outline text-[11px] py-1.5 px-2.5" onClick={sendMessage}>Say</button>
      </div>
      <button className="btn btn-danger text-[11px] py-1.5 w-full mt-2" onClick={() => onRecall(a.worker_id)}>
        End this call
      </button>
    </div>
  );
}

function WorkerRow({ w }: { w: Worker }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className={`dot ${w.state === "idle" ? "dot-ok" : "dot-warn"}`} />
      <div className="flex-1 min-w-0">
        <div className="truncate">{w.name}</div>
        <div className="text-[10px] text-[var(--color-muted)] truncate">{w.platform}</div>
      </div>
      <span className={`badge ${w.state === "idle" ? "badge-ok" : "badge-warn"}`}>{w.state}</span>
    </div>
  );
}

function EmptyRail({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-10 text-[12px]">
      <div className="text-[24px] mb-2 opacity-30">○</div>
      <div className="font-medium text-[var(--color-fg-soft)]">{title}</div>
      <div className="text-[11px] text-[var(--color-muted)] mt-1 px-2">{body}</div>
    </div>
  );
}
