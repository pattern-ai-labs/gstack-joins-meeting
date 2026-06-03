"use client";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { useToast } from "@/lib/toast";

/**
 * Shown on the dashboard when the user has 0 online workers.
 * Walks them through: mint a key → copy the install one-liner → wait for green.
 */
export function OnboardingFlow({ onMinted }: { onMinted: () => void }) {
  const call = useApi();
  const toast = useToast();
  const [label, setLabel] = useState("my-laptop");
  const [pending, setPending] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  async function mint() {
    setPending(true);
    try {
      const r = await call<{ worker_key: string }>("/api/worker-keys", {
        method: "POST", body: JSON.stringify({ label: label.trim() || "my-laptop" }),
      });
      setKey(r.worker_key);
      toast.push({ kind: "ok", title: "Worker key minted", body: "Copy it now — it's hashed at rest." });
      onMinted();
    } catch (e) {
      toast.push({ kind: "err", title: "Mint failed", body: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  async function copy(s: string, label: string) {
    try {
      await navigator.clipboard.writeText(s);
      toast.push({ kind: "ok", title: `${label} copied` });
    } catch {
      toast.push({ kind: "err", title: `Couldn't copy ${label.toLowerCase()}`, body: "Browser blocked clipboard access — select and copy manually." });
    }
  }

  const install = key
    ? `curl -fsSL https://raw.githubusercontent.com/pattern-ai-labs/gstack-joins-meeting/main/install | bash && \\
echo '{"worker_key":"${key}"}' > ~/.gstack/worker.json && chmod 600 ~/.gstack/worker.json && \\
python3 ~/gstack-joins-meeting/worker.py`
    : null;

  return (
    <div className="surface p-8 anim-up">
      <div className="flex items-center gap-3 mb-6">
        <span className="w-9 h-9 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center text-[14px] font-bold">1</span>
        <div>
          <div className="font-semibold text-[15px]">Get your first worker online</div>
          <div className="text-[13px] text-[var(--color-muted)]">A worker is a machine that runs the bots — your laptop is fine.</div>
        </div>
      </div>

      {!key ? (
        <div className="flex gap-2 max-w-md">
          <input
            value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Worker label (e.g. macbook-air)"
            className="flex-1"
          />
          <button className="btn btn-primary" disabled={pending} onClick={mint}>
            {pending ? "Minting…" : "Mint key"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="surface p-4 bg-[var(--color-bg-soft)]">
            <div className="label-cap mb-2">Your key (shown once)</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 mono text-[12.5px] break-all text-[var(--color-accent)]">{key}</code>
              <button className="btn btn-outline text-[11px] py-1.5 px-2.5 shrink-0" onClick={() => copy(key, "Key")}>Copy</button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <span className="w-9 h-9 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center text-[14px] font-bold">2</span>
            <div className="flex-1">
              <div className="font-semibold text-[14px]">Run this on your laptop</div>
              <div className="text-[12px] text-[var(--color-muted)]">Installs gstack, saves the key, starts the worker.</div>
            </div>
            <button className="btn btn-primary text-[12px]" onClick={() => copy(install!, "Command")}>Copy</button>
          </div>
          <pre className="surface p-4 bg-[var(--color-bg-soft)] text-[11.5px] mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
{install}
          </pre>

          <div className="flex items-center gap-3 pt-2">
            <span className="w-9 h-9 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center text-[14px] font-bold">3</span>
            <div className="flex-1">
              <div className="font-semibold text-[14px]">Wait for the green dot</div>
              <div className="text-[12px] text-[var(--color-muted)]">Once the worker connects, it shows up in the right rail. Then dispatch.</div>
            </div>
            <span className="dot dot-warn pulse" />
          </div>
        </div>
      )}
    </div>
  );
}
