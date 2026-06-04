"use client";
import { useEffect, useState } from "react";
import { useApi, useApiSWR } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { Assignment } from "@/lib/types";

/**
 * Slim live-call card for member dashboard. Members can't see the brain
 * pool or the audit log; what they DO need is visibility into the call
 * they just started so they can:
 *   - confirm the dispatch worked
 *   - see specialists (with avatars) currently in the meeting
 *   - watch the elapsed timer tick up live (1Hz)
 *   - end the call with one click
 *
 * Renders nothing when there are no active assignments — so it's
 * invisible on first visit and only appears after dispatch.
 */
export function MemberActiveCalls() {
  const call = useApi();
  const toast = useToast();
  const { data, mutate } = useApiSWR<{ assignments: Assignment[] }>(
    "/api/assignments",
    { refreshInterval: 4000 },
  );
  const active = (data?.assignments ?? []).filter((a) => a.status === "started");
  if (active.length === 0) return null;

  async function recall(worker_id?: string) {
    try {
      const r = await call<{ recalled: number }>("/api/recall", {
        method: "POST",
        body: JSON.stringify(worker_id ? { worker_id } : {}),
      });
      toast.push({
        kind: "ok",
        title: "Call ended",
        body: `${r.recalled} brain${r.recalled === 1 ? "" : "s"} freed`,
      });
      mutate();
    } catch (e) {
      toast.push({ kind: "err", title: "Couldn't end call", body: (e as Error).message });
    }
  }

  return (
    <div className="mb-6 space-y-3 anim-up">
      {active.map((a) => <CallCard key={a.id} a={a} onEnd={() => recall(a.worker_id)} />)}
    </div>
  );
}

/** Per-second tick so the elapsed timer renders without waiting for SWR. */
function useTicker(): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function CallCard({ a, onEnd }: { a: Assignment; onEnd: () => void }) {
  useTicker();
  const start = a.created_at ? new Date(a.created_at).getTime() : Date.now();
  const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
  const meetHost = (() => { try { return new URL(a.meet_url).hostname; } catch { return a.meet_url; } })();

  return (
    <div className="surface p-4 flex items-center gap-4 relative overflow-hidden">
      {/* glowing accent edge on the left to telegraph "live" */}
      <span
        className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)]"
        style={{ boxShadow: "0 0 18px var(--color-accent-ring)" }}
      />

      {/* avatar stack */}
      <div className="flex -space-x-2 shrink-0 pl-2">
        {a.specialists.slice(0, 4).map((id) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={id}
            src={`/avatars/${id}.svg`}
            alt={id} title={id}
            width={32} height={32}
            className="w-8 h-8 rounded-full ring-2 ring-[var(--color-bg)]"
            loading="lazy"
          />
        ))}
        {a.specialists.length > 4 && (
          <span className="w-8 h-8 rounded-full bg-[var(--color-panel-2)] text-[11px] flex items-center justify-center ring-2 ring-[var(--color-bg)] font-medium">
            +{a.specialists.length - 4}
          </span>
        )}
      </div>

      {/* live status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="dot dot-warn pulse" />
          <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--color-accent)]">LIVE</span>
          <span className="text-[13.5px] font-medium truncate">
            {a.specialists.length} specialist{a.specialists.length === 1 ? "" : "s"} in your call
          </span>
        </div>
        <div className="text-[11.5px] text-[var(--color-muted)] mono flex items-center gap-3">
          <span>{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")} elapsed</span>
          <span className="opacity-50">·</span>
          <span className="truncate">{meetHost}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <a
          href={a.meet_url}
          target="_blank" rel="noopener noreferrer"
          className="btn btn-outline text-[12px] py-1.5 px-3"
          title="Open the Meet in a new tab"
        >
          Open meet
        </a>
        <button className="btn btn-danger text-[12px] py-1.5 px-3" onClick={onEnd}>
          End call
        </button>
      </div>
    </div>
  );
}
