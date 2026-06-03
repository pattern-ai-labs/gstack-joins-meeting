"use client";
import type { Specialist } from "@/lib/types";

export function SpecialistCard({
  s, selected, onToggle, dense = false,
}: { s: Specialist; selected: boolean; onToggle?: () => void; dense?: boolean }) {
  // Render as a button only when there's actually something to toggle.
  // /specialists uses this card in read-only mode; without this, keyboard
  // users tab through 19 dead buttons with focus rings.
  const Tag = onToggle ? "button" : "div";
  return (
    <Tag
      onClick={onToggle}
      className={`card ${onToggle ? "card-hover cursor-pointer" : ""} ${selected ? "card-selected" : ""} text-left w-full anim-up`}
      style={{ animationDelay: `0ms` }}
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/avatars/${s.id}.svg`}
          alt=""
          width={44} height={44}
          className="shrink-0 w-11 h-11 rounded-full"
          style={{
            boxShadow: selected
              ? `0 0 0 2px ${s.accent}, 0 0 0 5px ${s.accent}22`
              : `inset 0 0 0 1px ${s.accent}33`,
          }}
          loading="lazy"
        />
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
    </Tag>
  );
}
