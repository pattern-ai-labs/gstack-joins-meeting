"use client";
import { useState } from "react";
import { useApi, useApiSWR } from "@/lib/api";
import type { WorkerKey } from "@/lib/types";

export default function WorkersPage() {
  const call = useApi();
  const { data, mutate } = useApiSWR<{ keys: WorkerKey[] }>("/api/worker-keys");
  const [label, setLabel] = useState("");
  const [justMinted, setJustMinted] = useState<string>("");

  async function mint() {
    if (!label.trim()) return;
    const r = await call<{ worker_key: string; label: string }>(
      "/api/worker-keys", { method: "POST", body: JSON.stringify({ label }) });
    setJustMinted(r.worker_key);
    setLabel("");
    mutate();
  }

  async function revoke(prefix: string) {
    // Phase-1 API expected the plaintext or hash; we send the hash prefix
    // back and the broker looks up the full hash. For now: only revoke
    // by full key — list shows prefix so users must keep the plaintext.
    if (!confirm("Revoke this key? Any worker using it will be disconnected.")) return;
    await call("/api/worker-keys/revoke", {
      method: "POST", body: JSON.stringify({ key_hash: prefix.replace("…", "") }),
    });
    mutate();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Workers</h1>
      <p className="muted text-sm">
        A worker key authenticates one machine running <code>worker.py</code>.
        Mint one per laptop or pool node. The key is shown once — save it now.
      </p>

      <section className="card space-y-3">
        <h2 className="font-semibold">Mint a new key</h2>
        <div className="flex gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)}
                 placeholder="e.g. macbook-air" />
          <button className="primary" onClick={mint}>Mint</button>
        </div>
        {justMinted && (
          <div className="card bg-[var(--color-bg)] space-y-2">
            <div className="text-xs muted">Save this NOW — it's hashed at rest and never shown again.</div>
            <div className="font-mono text-sm break-all">{justMinted}</div>
            <div className="text-xs muted">
              On the worker:{" "}
              <code>{`mkdir -p ~/.gstack && echo '{"worker_key":"${justMinted}"}' > ~/.gstack/worker.json && chmod 600 ~/.gstack/worker.json`}</code>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">Your keys</h2>
        {(data?.keys ?? []).length === 0 ? (
          <div className="card muted text-sm">No keys yet.</div>
        ) : (
          <div className="space-y-2">
            {(data?.keys ?? []).map((k) => (
              <div key={k.key_hash_prefix} className="card flex items-center gap-3 text-sm">
                <span className="font-mono text-xs">{k.key_hash_prefix}</span>
                <span className="flex-1">{k.label}</span>
                <span className="muted text-xs">
                  {k.last_seen_at ? `seen ${new Date(k.last_seen_at).toLocaleString()}` : "never connected"}
                </span>
                {k.revoked
                  ? <span className="text-red-400 text-xs">revoked</span>
                  : <button onClick={() => revoke(k.key_hash_prefix)} className="muted text-xs underline">revoke</button>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
