"use client";
import { useEffect, useRef, useState } from "react";
import { useApi, useApiSWR } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { Assignment, TranscriptEntry, TranscriptResponse } from "@/lib/types";

/**
 * The member's window into their call. Three states, one surface:
 *
 *  queued  — position in line, auto-fires when a brain frees, cancel button
 *  started — progress stepper (accepted → launching → joined N/M), the
 *            LIVE card with elapsed timer, a live transcript stream, and a
 *            "say" box that routes typed text into the meeting through the
 *            brain's normal turn-taking
 *  ended   — if the brain wrote call notes, a summary card with copy +
 *            share; dismissible
 *
 * Renders nothing when there's no recent activity — invisible on first visit.
 */
export function MemberActiveCalls() {
  const call = useApi();
  const toast = useToast();
  const { data, mutate } = useApiSWR<{ assignments: Assignment[] }>(
    "/api/assignments",
    { refreshInterval: 4000 },
  );
  const all = data?.assignments ?? [];
  const active = all.filter((a) => a.status === "started");
  const queued = all.filter((a) => a.status === "queued");
  // Latest ended call that produced notes — the post-call artifact.
  const lastWithNotes = all.find((a) => a.status === "ended" && a.summary);
  const [dismissedNotes, setDismissedNotes] = useState<string | null>(null);

  if (active.length === 0 && queued.length === 0 &&
      (!lastWithNotes || dismissedNotes === lastWithNotes.id)) return null;

  async function recall(worker_id?: string) {
    try {
      const r = await call<{ recalled: number }>("/api/recall", {
        method: "POST",
        body: JSON.stringify(worker_id ? { worker_id } : {}),
      });
      toast.push({
        kind: "ok",
        title: "Call ended",
        body: `${r.recalled} brain${r.recalled === 1 ? "" : "s"} freed — notes incoming`,
      });
      mutate();
    } catch (e) {
      toast.push({ kind: "err", title: "Couldn't end call", body: (e as Error).message });
    }
  }

  async function cancel(aid: string) {
    try {
      await call(`/api/assignments/${aid}/cancel`, { method: "POST", body: "{}" });
      toast.push({ kind: "ok", title: "Left the queue" });
      mutate();
    } catch (e) {
      toast.push({ kind: "err", title: "Couldn't cancel", body: (e as Error).message });
    }
  }

  return (
    <div className="mb-6 space-y-3 anim-up">
      {queued.map((a) => <QueuedCard key={a.id} a={a} onCancel={() => cancel(a.id)} />)}
      {active.map((a) => <CallCard key={a.id} a={a} onEnd={() => recall(a.worker_id)} />)}
      {lastWithNotes && dismissedNotes !== lastWithNotes.id &&
        active.length === 0 && queued.length === 0 && (
        <NotesCard a={lastWithNotes} onDismiss={() => setDismissedNotes(lastWithNotes.id)} />
      )}
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

/* ─── queued ────────────────────────────────────────────────────────── */

function QueuedCard({ a, onCancel }: { a: Assignment; onCancel: () => void }) {
  const pos = a.queue_position ?? 1;
  return (
    <div className="surface p-4 flex items-center gap-4 relative overflow-hidden">
      <span className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-warn,#fbbf24)]" />
      <AvatarStack ids={a.specialists} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="dot dot-warn pulse" />
          <span className="text-[13.5px] font-medium">
            #{pos} in line — waiting for a free brain
          </span>
        </div>
        <div className="text-[11.5px] text-[var(--color-muted)]">
          Fires automatically the moment one frees. Held for 10 minutes.
        </div>
      </div>
      <button className="btn btn-outline text-[12px] py-1.5 px-3 shrink-0" onClick={onCancel}>
        Leave queue
      </button>
    </div>
  );
}

/* ─── live call ─────────────────────────────────────────────────────── */

const STAGES = ["accepted", "launching", "joined"] as const;
const STAGE_LABEL: Record<string, string> = {
  accepted:  "Brain accepted",
  launching: "Launching bots",
  joined:    "In the meeting",
};

function CallCard({ a, onEnd }: { a: Assignment; onEnd: () => void }) {
  useTicker();
  const start = a.dispatched_at
    ? new Date(a.dispatched_at).getTime()
    : a.created_at ? new Date(a.created_at).getTime() : Date.now();
  const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
  const meetHost = (() => { try { return new URL(a.meet_url).hostname; } catch { return a.meet_url; } })();

  const stage = a.progress?.stage ?? "accepted";
  const joinedCount = a.progress?.joined?.length ?? 0;
  const allJoined = joinedCount >= a.specialists.length && joinedCount > 0;
  const stageIdx = stage === "joined" ? 2 : STAGES.indexOf(stage as typeof STAGES[number]);

  return (
    <div className="surface relative overflow-hidden">
      <span
        className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)]"
        style={{ boxShadow: "0 0 18px var(--color-accent-ring)" }}
      />
      <div className="p-4 flex items-center gap-4">
        <AvatarStack ids={a.specialists} pl />
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

      {/* progress stepper — fills the dead air between dispatch and the
          bots' tiles appearing in the Meet. Collapses once everyone's in.
          Only rendered when the broker reports progress at all (an old
          broker without the progress channel would pin it at step 1). */}
      {a.progress && !allJoined && (
        <div className="px-4 pb-3 flex items-center gap-2 text-[11px] mono">
          {STAGES.map((s, i) => {
            const done = stageIdx > i || (s === "joined" && allJoined);
            const here = stageIdx === i;
            return (
              <span key={s} className="flex items-center gap-2">
                {i > 0 && <span className="w-5 h-px bg-[var(--color-border)]" />}
                <span className={`flex items-center gap-1.5 ${
                  done ? "text-[var(--color-accent)]"
                  : here ? "text-[var(--color-fg)]"
                  : "text-[var(--color-muted)]"
                }`}>
                  <span className={`dot ${done ? "dot-ok" : here ? "dot-warn pulse" : "dot-mute"}`} />
                  {s === "joined" && stageIdx >= 2
                    ? `In the meeting ${joinedCount}/${a.specialists.length}`
                    : STAGE_LABEL[s]}
                </span>
              </span>
            );
          })}
        </div>
      )}

      <Transcript aid={a.id} specialists={a.specialists} />
    </div>
  );
}

/* ─── live transcript + say box ─────────────────────────────────────── */

function Transcript({ aid, specialists }: { aid: string; specialists: string[] }) {
  const callApi = useApi();
  const toast = useToast();
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // 404 = broker predates the transcript channel — remove the whole
  // section instead of showing a dead panel + erroring say box.
  const [unsupported, setUnsupported] = useState(false);
  const sinceRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cursor-based poll: only new entries cross the wire each tick.
  useEffect(() => {
    let live = true;
    const id = setInterval(async () => {
      try {
        const r = await callApi<TranscriptResponse>(
          `/api/assignments/${aid}/transcript?since=${sinceRef.current}`);
        if (!live || r.entries.length === 0) return;
        sinceRef.current = r.entries[r.entries.length - 1].seq;
        setEntries((cur) => [...cur, ...r.entries].slice(-200));
      } catch (e) {
        if ((e as { status?: number }).status === 404) {
          if (live) setUnsupported(true);
          clearInterval(id);
        }
        /* other errors: broker hiccup — next tick retries */
      }
    }, 2500);
    return () => { live = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aid]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries.length]);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await callApi(`/api/assignments/${aid}/say`, {
        method: "POST", body: JSON.stringify({ text: t }),
      });
      setText("");
    } catch (e) {
      toast.push({ kind: "err", title: "Couldn't send", body: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  if (unsupported) return null;

  return (
    <div className="border-t border-[var(--color-border)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 flex items-center gap-2 text-[11px] mono uppercase tracking-wider text-[var(--color-muted)] hover:text-[var(--color-fg)] transition"
      >
        <span>{open ? "▾" : "▸"}</span> Live transcript
        {entries.length > 0 && <span className="badge">{entries.length}</span>}
      </button>

      {open && (
        <>
          <div
            ref={scrollRef}
            className="px-4 pb-2 max-h-56 overflow-y-auto space-y-2 text-[12.5px] leading-snug"
          >
            {entries.length === 0 && (
              <div className="text-[var(--color-muted)] text-[11.5px] py-2">
                Waiting for the room to talk… say something in the Meet, or type below.
              </div>
            )}
            {entries.map((e) => (
              <div key={e.seq} className="flex gap-2">
                {e.kind === "bot" ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/avatars/${e.specialist_id}.svg`} alt=""
                      width={18} height={18}
                      className="w-[18px] h-[18px] rounded-full shrink-0 mt-0.5"
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <span className="text-[var(--color-accent)] mono text-[10.5px] mr-1.5">
                        {e.specialist_id}
                      </span>
                      <span className="text-[var(--color-fg-soft)]">{e.text}</span>
                    </div>
                  </>
                ) : (
                  <div className="min-w-0">
                    <span className="text-[var(--color-muted)] mono text-[10.5px] mr-1.5">
                      {e.speaker || "you"}
                    </span>
                    <span>{e.text}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="px-4 pb-3 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder={`Ask ${specialists[0] ?? "the team"} something — the bot answers out loud`}
              className="flex-1 text-[12.5px] py-1.5"
              maxLength={500}
            />
            <button
              className="btn btn-primary text-[12px] py-1.5 px-3 shrink-0"
              disabled={!text.trim() || sending}
              onClick={send}
            >
              {sending ? "…" : "Say it"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── post-call notes ───────────────────────────────────────────────── */

function NotesCard({ a, onDismiss }: { a: Assignment; onDismiss: () => void }) {
  const toast = useToast();
  const summary = a.summary ?? "";
  const tweet = encodeURIComponent(
    "Just had @garrytan's gstack specialists join my Google Meet and leave me written call notes. Wild. https://gstack-meeting.com",
  );
  return (
    <div className="surface relative overflow-hidden anim-up">
      <span className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)]" />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <AvatarStack ids={a.specialists} small />
          <span className="text-[13.5px] font-medium">Call notes from your specialists</span>
          <button
            onClick={onDismiss}
            className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-fg)] text-[14px] leading-none"
            aria-label="Dismiss"
          >×</button>
        </div>
        <div className="text-[12.5px] leading-relaxed text-[var(--color-fg-soft)] whitespace-pre-wrap max-h-72 overflow-y-auto">
          {summary}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            className="btn btn-outline text-[12px] py-1.5 px-3"
            onClick={() => {
              navigator.clipboard.writeText(summary).then(
                () => toast.push({ kind: "ok", title: "Notes copied" }),
                () => toast.push({ kind: "err", title: "Copy failed" }),
              );
            }}
          >
            Copy notes
          </button>
          <a
            href={`https://twitter.com/intent/tweet?text=${tweet}`}
            target="_blank" rel="noopener noreferrer"
            className="btn btn-outline text-[12px] py-1.5 px-3"
          >
            Share on X
          </a>
        </div>
      </div>
    </div>
  );
}

/* ─── shared ────────────────────────────────────────────────────────── */

function AvatarStack({ ids, pl = false, small = false }:
  { ids: string[]; pl?: boolean; small?: boolean }) {
  const size = small ? "w-6 h-6" : "w-8 h-8";
  return (
    <div className={`flex -space-x-2 shrink-0 ${pl ? "pl-2" : ""}`}>
      {ids.slice(0, 4).map((id) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={id}
          src={`/avatars/${id}.svg`}
          alt={id} title={id}
          width={32} height={32}
          className={`${size} rounded-full ring-2 ring-[var(--color-bg)]`}
          loading="lazy"
        />
      ))}
      {ids.length > 4 && (
        <span className={`${size} rounded-full bg-[var(--color-panel-2)] text-[11px] flex items-center justify-center ring-2 ring-[var(--color-bg)] font-medium`}>
          +{ids.length - 4}
        </span>
      )}
    </div>
  );
}
