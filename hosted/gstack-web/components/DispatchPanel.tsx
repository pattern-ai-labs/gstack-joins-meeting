"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, useApiSWR } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { SpecialistCard } from "./SpecialistCard";
import { PoolBusyModal } from "./PoolBusyModal";
import type { Specialist } from "@/lib/types";

// Curated team presets — mirrors data/teams.json on the backend.
const TEAMS: { id: string; name: string; specs: string[] }[] = [
  { id: "founding",     name: "Founding Team", specs: ["office-hours", "plan-ceo-review", "plan-eng-review"] },
  { id: "design",       name: "Design",        specs: ["plan-design-review", "design-consultation", "design-shotgun", "design-html", "design-review"] },
  { id: "build-review", name: "Build & Review", specs: ["spec", "plan-eng-review", "review", "investigate"] },
  { id: "qa-ship",      name: "QA & Ship",     specs: ["qa", "cso", "ship", "land-and-deploy", "canary"] },
  { id: "dx",           name: "DX",            specs: ["plan-devex-review", "devex-review"] },
  { id: "retro",        name: "Retro",         specs: ["retro"] },
];

const CATEGORIES = ["All", "Strategy", "Planning", "Design", "Engineering", "Review", "Quality", "Release", "Ops"];

export function DispatchPanel() {
  const call = useApi();
  const toast = useToast();
  const { data: specsResp } = useApiSWR<{ specialists: Specialist[] }>("/api/specialists");
  const { mutate: refreshWorkers }     = useApiSWR<unknown>("/api/workers");
  const { mutate: refreshAssignments } = useApiSWR<unknown>("/api/assignments");

  const all = specsResp?.specialists ?? [];

  const [meetUrl, setMeetUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [showBrief, setShowBrief] = useState(false);
  const [mode, setMode] = useState<"avatar" | "audio">("avatar");
  // Restore the last-used mode from localStorage so a user who switched
  // to audio for cost/latency stays on audio after a refresh.
  useEffect(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("gstack:mode");
    if (saved === "avatar" || saved === "audio") setMode(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("gstack:mode", mode);
  }, [mode]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("All");
  const [pending, setPending] = useState(false);
  const [poolBusyOpen, setPoolBusyOpen] = useState(false);

  const filtered = useMemo(() => {
    return all.filter((s) => category === "All" || s.category === category);
  }, [all, category]);

  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function pickTeam(specs: string[]) {
    setPicked((cur) => {
      const next = new Set(cur);
      const allIn = specs.every((s) => next.has(s));
      if (allIn) specs.forEach((s) => next.delete(s));
      else       specs.forEach((s) => next.add(s));
      return next;
    });
  }
  function clear() { setPicked(new Set()); }

  async function dispatch() {
    if (!meetUrl.trim() || picked.size === 0) return;
    setPending(true);
    try {
      const r = await call<{ assignment_id: string; worker_id: string }>("/api/dispatch", {
        method: "POST",
        body: JSON.stringify({ meetUrl: meetUrl.trim(), specialists: [...picked], brief, mode }),
      });
      toast.push({
        kind: "ok",
        title: `${picked.size} specialist${picked.size === 1 ? "" : "s"} dispatched`,
        body: `Assignment ${r.assignment_id.slice(0, 12)}… → brain ${r.worker_id}`,
      });
      // optimistic: clear pick & refresh
      setPicked(new Set());
      refreshWorkers(); refreshAssignments();
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string; body?: { hint?: string; error?: string } };
      // Pool-is-busy: the broker returns 503 with error="demo_busy".
      // Render the friendly modal instead of a generic error toast so
      // the user gets a real way forward (retry, or bring their own brain).
      if (err.status === 503 && err.body?.error === "demo_busy") {
        setPoolBusyOpen(true);
      } else {
        toast.push({
          kind: "err",
          title: "Dispatch failed",
          body: err.body?.hint || err.body?.error || err.message,
        });
      }
    } finally {
      setPending(false);
    }
  }

  const meetLooksValid = /^https?:\/\/(meet\.google\.com|zoom\.us|.*\.zoom\.us|teams\.(microsoft|live)\.com)/.test(meetUrl.trim());

  return (
    <div className="space-y-8">
      <PoolBusyModal
        open={poolBusyOpen}
        onClose={() => setPoolBusyOpen(false)}
        onRetry={() => {
          // Auto-retry from inside the modal: re-trigger the dispatch
          // with the same selection. If it succeeds the modal closes
          // (via the catch branch above no longer firing).
          setPoolBusyOpen(false);
          dispatch();
        }}
      />
      {/* HERO */}
      <section className="surface p-6 anim-up">
        <div className="flex items-end gap-3 mb-1">
          <h1 className="text-[26px] font-semibold tracking-tight">Dispatch your team</h1>
          <span className="text-[12px] text-[var(--color-muted)] mb-1">{all.length} specialists · {TEAMS.length} team presets</span>
        </div>
        <p className="text-[13px] text-[var(--color-fg-soft)] mb-5">Drop a meeting link, pick the specialists you want, hit dispatch.</p>

        <div className="flex items-baseline justify-between mb-1.5">
          <label className="label-cap">Meeting URL</label>
          <a
            href="https://meet.new"
            target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-[var(--color-accent)] hover:underline underline-offset-2"
            title="Opens meet.new in a new tab — it creates a fresh Google Meet room. Copy the URL from the address bar, then paste here."
          >
            Don't have a link? Start one →
          </a>
        </div>
        <div className="relative">
          <input
            value={meetUrl} onChange={(e) => setMeetUrl(e.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
            className="mono pr-28"
          />
          <span className={`absolute right-3 top-1/2 -translate-y-1/2 badge ${meetUrl.trim() ? (meetLooksValid ? "badge-ok" : "badge-bad") : "badge-muted"}`}>
            {meetUrl.trim() ? (meetLooksValid ? "valid" : "bad host") : "empty"}
          </span>
        </div>

        <div className="mt-4">
          {!showBrief ? (
            <button className="btn btn-ghost text-[12px] px-0" onClick={() => setShowBrief(true)}>+ Add brief (agenda, doc, context)</button>
          ) : (
            <>
              <label className="label-cap block mb-1.5">Brief (optional · 500 chars)</label>
              <textarea
                value={brief} onChange={(e) => setBrief(e.target.value.slice(0, 500))}
                rows={2}
                placeholder="e.g. We're pitching getsun.io — drill traction, moat vs Vapi, why-now."
              />
              <div className="text-[10px] text-[var(--color-muted)] text-right mt-1">{brief.length}/500</div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <div className="flex bg-[var(--color-panel-2)] rounded-lg p-0.5 border border-[var(--color-border)]">
            {(["avatar", "audio"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`text-[12px] px-3 py-1.5 rounded-md transition ${
                  mode === m ? "bg-[var(--color-panel)] text-[var(--color-fg)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-[var(--color-muted)]">
            {mode === "avatar" ? "voice + 3D avatar (slower join)" : "voice only (faster)"}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[12px] text-[var(--color-muted)]">{picked.size} selected</span>
            <button className="btn btn-outline text-[12px]" disabled={picked.size === 0} onClick={clear}>Clear</button>
            <button className="btn btn-primary px-5 py-2.5 text-[13px]" disabled={pending || !meetUrl.trim() || picked.size === 0} onClick={dispatch}>
              {pending ? "Dispatching…" : `Dispatch ${picked.size || ""} →`}
            </button>
          </div>
        </div>
      </section>

      {/* TEAM PRESETS */}
      <section>
        <div className="label-cap mb-2">Team presets · one-click pick</div>
        <div className="flex gap-2 flex-wrap">
          {TEAMS.map((t) => {
            const allIn = t.specs.every((s) => picked.has(s));
            return (
              <button
                key={t.id}
                onClick={() => pickTeam(t.specs)}
                className={`chip ${allIn ? "chip-active" : ""}`}
              >
                {t.name}
                <span className="mono opacity-60 text-[10px]">·{t.specs.length}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* SPECIALISTS */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[15px] font-semibold">Specialists</h2>
          <span className="text-[12px] text-[var(--color-muted)]">{filtered.length} of {all.length}</span>
        </div>
        <div className="flex gap-1.5 flex-wrap mb-4">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`chip ${category === c ? "chip-active" : ""}`}
            >
              {c}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-[13px] text-[var(--color-muted)]">No specialists match the filter.</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((s) => (
              <SpecialistCard key={s.id} s={s} selected={picked.has(s.id)} onToggle={() => toggle(s.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
