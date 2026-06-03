"use client";
import { useApiSWR } from "@/lib/api";
import type { User } from "@/lib/types";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useApiSWR<{ user: User }>("/api/me");
  if (isLoading) return <div className="p-12 muted">Checking permissions…</div>;
  if (!data) return <Forbidden reason="Not signed in." />;
  if (data.user.role !== "admin") return <Forbidden reason="Members can't access admin." />;
  return <>{children}</>;
}

function Forbidden({ reason }: { reason: string }) {
  return (
    <div className="max-w-md mx-auto py-24 px-8 text-center anim-fade">
      <div className="text-[36px] mb-3 opacity-40">⛨</div>
      <h1 className="text-[20px] font-semibold mb-2">Admin only</h1>
      <p className="text-[13px] text-[var(--color-muted)]">{reason}</p>
    </div>
  );
}
