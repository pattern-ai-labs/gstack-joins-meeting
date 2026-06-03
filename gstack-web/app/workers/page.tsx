"use client";
import { useState } from "react";
import { useApi, useApiSWR } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import type { Worker, WorkerKey } from "@/lib/types";

export default function WorkersPage() {
  const call = useApi();
  const toast = useToast();
  const { data: keysResp,    mutate: refreshKeys }    = useApiSWR<{ keys: WorkerKey[] }>("/api/worker-keys");
  const { data: workersResp, mutate: refreshWorkers } = useApiSWR<{ workers: Worker[] }>("/api/workers");

  const keys = keysResp?.keys ?? [];
  const workers = workersResp?.workers ?? [];
  const onlineKeys = new Set(
    workers.map((w) => keys.find((k) => k.label && k.label === w.name)?.key_hash_prefix).filter(Boolean) as string[]
  );

  async function revoke(prefix: string, label: string) {
    if (!confirm(`Revoke "${label}"? Any worker using this key will be disconnected.`)) return;
    try {
      await call("/api/worker-keys/revoke", {
        method: "POST",
        body: JSON.stringify({ key_hash: prefix.replace("…", "") }),
      });
      toast.push({ kind: "ok", title: "Key revoked", body: `"${label}" disconnected` });
      refreshKeys(); refreshWorkers();
    } catch (e) {
      toast.push({ kind: "err", title: "Revoke failed", body: (e as Error).message });
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 anim-fade">
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight">Workers</h1>
        <p className="text-[13px] text-[var(--color-fg-soft)] mt-1">
          One key per machine. Each running worker = one Claude Code session that can run a dispatch.
        </p>
      </header>

      <section className="mb-8">
        <OnboardingFlow onMinted={() => { refreshKeys(); refreshWorkers(); }} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[15px] font-semibold">Your keys</h2>
          <span className="text-[12px] text-[var(--color-muted)]">{keys.length} total · {workers.length} online</span>
        </div>
        {keys.length === 0 ? (
          <div className="surface p-8 text-center text-[13px] text-[var(--color-muted)]">No keys yet — mint one above.</div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => {
              const isOnline = workers.some((w) => w.name === k.label);
              return (
                <div key={k.key_hash_prefix} className="card flex items-center gap-3">
                  <span className={`dot ${k.revoked ? "dot-bad" : isOnline ? "dot-ok" : "dot-mute"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[13.5px]">{k.label}</div>
                    <div className="text-[11px] text-[var(--color-muted)] mono">{k.key_hash_prefix}</div>
                  </div>
                  <div className="text-[11px] text-[var(--color-muted)] text-right">
                    {k.last_seen_at
                      ? <>seen {new Date(k.last_seen_at).toLocaleString()}</>
                      : <>never connected</>}
                  </div>
                  {k.revoked
                    ? <span className="badge badge-bad">revoked</span>
                    : <button className="btn btn-danger text-[11px] py-1.5 px-2.5" onClick={() => revoke(k.key_hash_prefix, k.label)}>Revoke</button>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
