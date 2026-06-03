"use client";
import type { Specialist } from "@/lib/types";

export function SpecialistCard({
  s, selected, onToggle, dense = false,
}: { s: Specialist; selected: boolean; onToggle: () => void; dense?: boolean }) {
  return (
    <button
      onClick={onToggle}
      className={`card card-hover ${selected ? "card-selected" : ""} text-left w-full anim-up`}
      style={{ animationDelay: `0ms` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-base font-bold"
          style={{
            background: `linear-gradient(135deg, ${s.accent}33, ${s.accent}11)`,
            color: s.accent,
            boxShadow: selected ? `0 0 0 2px ${s.accent}` : `inset 0 0 0 1px ${s.accent}33`,
          }}
        >
          {s.glyph}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-[14px]">{s.card_name || s.name}</span>
            {selected && <span className="badge badge-accent">picked</span>}
          </div>
          <div className="text-[12px] text-[var(--color-muted)] mt-0.5">{s.role}</div>
        </div>
      </div>
      {!dense && (
        <p className="text-[12.5px] text-[var(--color-fg-soft)] mt-3 leading-snug">
          {s.desc_card || s.description}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="mono text-[var(--color-muted)]">/{s.id}</span>
        <span className="badge badge-muted">{s.category}</span>
      </div>
    </button>
  );
}
