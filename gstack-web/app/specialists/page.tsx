"use client";
import { useMemo, useState } from "react";
import { useApiSWR } from "@/lib/api";
import { SpecialistCard } from "@/components/SpecialistCard";
import type { Specialist } from "@/lib/types";

const CATEGORIES = ["All", "Strategy", "Planning", "Design", "Engineering", "Review", "Quality", "Release", "Ops"];

export default function SpecialistsPage() {
  const { data } = useApiSWR<{ specialists: Specialist[] }>("/api/specialists");
  const all = data?.specialists ?? [];
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((s) => {
      if (category !== "All" && s.category !== category) return false;
      if (!q) return true;
      return [s.id, s.name, s.role, s.description].some((f) => (f || "").toLowerCase().includes(q));
    });
  }, [all, category, query]);

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 anim-fade">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Specialists</h1>
        <p className="text-[13px] text-[var(--color-fg-soft)] mt-1">
          The full roster — 19 personas, each with a distinct voice and avatar. Same source of truth as <code className="mono">data/specialists.json</code>.
        </p>
      </header>

      <div className="flex gap-3 items-center mb-4">
        <div className="flex gap-1.5 flex-wrap flex-1">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={`chip ${category === c ? "chip-active" : ""}`}>{c}</button>
          ))}
        </div>
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="max-w-xs"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-[13px] text-[var(--color-muted)]">No specialists match.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s) => (
            <SpecialistCard key={s.id} s={s} selected={false} onToggle={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
}
