"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type ToastKind = "info" | "ok" | "err";
type Toast = { id: number; kind: ToastKind; title: string; body?: string };

const ToastCtx = createContext<{
  push: (t: Omit<Toast, "id">) => void;
}>({ push: () => {} });

export function useToast() { return useContext(ToastCtx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
        {items.map((t) => <ToastView key={t.id} t={t} onDismiss={() => setItems((cur) => cur.filter((x) => x.id !== t.id))} />)}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(true); }, []);
  const ring =
    t.kind === "ok"  ? "border-[var(--color-ok)]/40"   :
    t.kind === "err" ? "border-[var(--color-bad)]/40"  :
                       "border-[var(--color-info)]/40";
  return (
    <div className={`glass rounded-xl px-4 py-3 min-w-[280px] anim-in ${ring}`}>
      <div className="flex items-start gap-3">
        <span className={`dot mt-1.5 ${t.kind === "ok" ? "dot-ok" : t.kind === "err" ? "dot-bad" : "dot-mute"}`} />
        <div className="flex-1 text-[13px]">
          <div className="font-medium">{t.title}</div>
          {t.body && <div className="text-[var(--color-fg-soft)] mt-0.5 text-[12px]">{t.body}</div>}
        </div>
        <button onClick={onDismiss} className="text-[var(--color-muted)] hover:text-[var(--color-fg)] text-[18px] leading-none">×</button>
      </div>
    </div>
  );
}
