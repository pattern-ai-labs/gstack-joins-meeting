"use client";
import { useEffect } from "react";
import type { MarketingSpecialist } from "@/lib/specialists-static";
import { voiceLabel } from "@/lib/specialists-static";

/**
 * Persona detail overlay for the landing-page specialist grid. Replaces
 * the old "click → GitHub 404" behaviour with a real narrative card:
 * who the specialist is, what it does (in its own voice), and when to
 * reach for it. Pure presentational — fed a MarketingSpecialist or null.
 *
 * Closes on backdrop click or Escape. Locks body scroll while open.
 */
export function SpecialistDetailModal({
  specialist,
  onClose,
}: {
  specialist: MarketingSpecialist | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!specialist) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [specialist, onClose]);

  if (!specialist) return null;
  const s = specialist;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 anim-fade"
      style={{ background: "rgba(7,8,10,0.72)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${s.name} — ${s.role}`}
    >
      <div
        className="relative w-full sm:max-w-lg surface rounded-t-2xl sm:rounded-2xl p-6 sm:p-7 anim-up"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 -8px 60px rgba(0,0,0,0.5)" }}
      >
        {/* accent edge */}
        <span
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
          style={{ background: s.accent, boxShadow: `0 0 24px ${s.accent}66` }}
        />

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel)] transition"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>

        {/* header: avatar + name + role */}
        <div className="flex items-center gap-3.5 pl-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/avatars/${s.id}.svg`}
            alt=""
            width={56} height={56}
            className="w-14 h-14 rounded-full shrink-0"
            style={{ boxShadow: `inset 0 0 0 1.5px ${s.accent}66` }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[19px] font-semibold tracking-tight">{s.name}</h3>
              <span
                className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: `${s.accent}1f`, color: s.accent }}
              >{s.category}</span>
            </div>
            <div className="text-[13px] text-[var(--color-muted)] mt-0.5">{s.role}</div>
          </div>
        </div>

        {/* what it does — in voice */}
        <div className="mt-6 pl-2">
          <div className="label-cap mb-1.5">What it does</div>
          <p className="text-[15px] leading-relaxed text-[var(--color-fg-soft)]">
            <span className="text-[var(--color-fg)]">“{s.blurb}”</span>
          </p>
        </div>

        {/* when to call */}
        <div className="mt-5 pl-2">
          <div className="label-cap mb-1.5">When to call it</div>
          <p className="text-[14px] leading-relaxed text-[var(--color-fg-soft)]">{s.whenToCall}</p>
        </div>

        {/* footer meta */}
        <div className="mt-6 pl-2 flex items-center gap-4 text-[12px] text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/></svg>
            Voiced by {voiceLabel(s.voice)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: s.accent }} />
            Unique 3D avatar
          </span>
        </div>
      </div>
    </div>
  );
}
