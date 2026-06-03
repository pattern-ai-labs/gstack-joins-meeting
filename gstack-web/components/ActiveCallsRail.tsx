"use client";
import { useEffect, useState } from "react";
import { useApi, useApiSWR } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { Assignment, Worker } from "@/lib/types";

export function ActiveCallsRail() {
  const call = useApi();
  const toast = useToast();
  // Workers refresh every 5s, assignments every 4s — keeps the rail live
  // without hammering the broker, and the elapsed timer's per-second
  // re-render is handled locally by useTicker below.
  const { data: workersResp, mutate: refreshWorkers }
    = useApiSWR<{ workers: Worker[] }>("/api/workers",     { refreshInterval: 5000 });
  const { data: assignsResp, mutate: refreshAssignments }
    = useApiSWR<{ assignments: Assignment[] }>("/api/assignments", { refreshInterval: 4000 });

  const workers = workersResp?.workers ?? [];
  const active = (assignsResp?.assignments ?? []).filter((a) => a.status === "started");

  async function recall(worker_id?: string) {
    try {
      const r = await call<{ recalled: number }>("/api/recall", {
        method: "POST",
        body: JSON.stringify(worker_id ? { worker_id } : {}),
      });
      toast.push({ kind: "ok", title: "Recalled", body: `${r.recalled} worker${r.recalled === 1 ? "" : "s"} freed` });
      refreshWorkers(); refreshAssignments();
    } catch (e) {
      toast.push({ kind: "err", title: "Recall failed", body: (e as Error).message });
    }
  }

  return (
    <aside className="w-full xl:w-[320px] shrink-0 xl:h-[calc(100vh-32px)] xl:sticky xl:top-4 xl:mr-4 xl:my-4 surface flex flex-col anim-fade">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">Now in meeting</div>
          <div className="text-[11px] text-[var(--color-muted)]">{active.length} active · {workers.length} worker{workers.length === 1 ? "" : "s"}</div>
        </div>
        {active.length > 0 && (
          <button className="btn btn-danger text-[11px] py-1.5 px-2.5" onClick={() => recall()}>Recall all</button>
        )}
      </div>

      <div className="flex-1 scroll-y px-4 py-3 space-y-3 max-h-[60vh] xl:max-h-none">
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

/* Per-second tick for elapsed-time text. Throttled to 1s and only runs
 * while a tab is visible (Page Visibility API) to avoid burning CPU on
 * backgrounded tabs. */
function useTicker(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id != null) return;
      id = setInterval(() => setTick((t) => t + 1), 1000);
    };
    const stop = () => {
      if (id != null) { clearInterval(id); id = null; }
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);
  return tick;
}

function ActiveCallCard({ a, onRecall }: { a: Assignment; onRecall: (worker_id?: string) => void }) {
  useTicker(true); // 1Hz re-render so elapsed text counts up live
  const start = a.created_at ? new Date(a.created_at).getTime() : Date.now();
  const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
  const meetHost = (() => { try { return new URL(a.meet_url).hostname; } catch { return a.meet_url; } })();

  return (
    <div className="surface p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="dot dot-warn pulse" />
        <div className="flex -space-x-1.5">
          {a.specialists.slice(0, 4).map((id) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={id}
              src={`/avatars/${id}.svg`}
              alt={id}
              title={id}
              width={20} height={20}
              className="w-5 h-5 rounded-full ring-1 ring-[var(--color-bg)]"
              loading="lazy"
            />
          ))}
          {a.specialists.length > 4 && (
            <span className="w-5 h-5 rounded-full bg-[var(--color-panel-2)] text-[9px] flex items-center justify-center ring-1 ring-[var(--color-bg)]">
              +{a.specialists.length - 4}
            </span>
          )}
        </div>
        <span className="ml-auto badge badge-warn">live</span>
      </div>
      <div className="text-[11px] text-[var(--color-muted)] truncate mono">{meetHost}</div>
      <div className="text-[11px] text-[var(--color-muted)] mt-1 mono">
        {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")} · {a.mode}
      </div>
      <button className="btn btn-danger text-[11px] py-1.5 w-full mt-3" onClick={() => onRecall(a.worker_id)}>
        End this call
      </button>
      <div className="mt-2 text-[10px] text-[var(--color-muted)] text-center">
        Direct messaging from the dashboard ships in the next release.
        For now, ask your local Claude session to speak through the bot's outbox.
      </div>
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
