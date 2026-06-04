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

  const filtered = useMemo(() => {
    return all.filter((s) => category === "All" || s.category === category);
  }, [all, category]);

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 anim-fade">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Specialists</h1>
        <p className="text-[13px] text-[var(--color-fg-soft)] mt-1">
          The full roster — 19 personas, each with a distinct voice and avatar. Same source of truth as <code className="mono">data/specialists.json</code>.
        </p>
      </header>

      <div className="flex gap-1.5 flex-wrap mb-4">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={`chip ${category === c ? "chip-active" : ""}`}>{c}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-[13px] text-[var(--color-muted)]">No specialists match.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s) => (
            <SpecialistCard key={s.id} s={s} selected={false} />
          ))}
        </div>
      )}
    </div>
  );
}
