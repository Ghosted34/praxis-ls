import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";

type Toast = { id: number; msg: string; kind: "ok" | "bad" };
type ToastCtx = {
  toast: (msg: string, kind?: "ok" | "bad") => void;
  fail: (e: unknown) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const toast = useCallback((msg: string, kind: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, msg, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 3400);
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.reauth) {
        toast("Session expired — sign in again", "bad");
        // App's auth gate will redirect on next render; force a hash change.
        window.location.hash = "#/login";
        return;
      }
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast(msg, "bad");
    },
    [toast],
  );

  return (
    <Ctx.Provider value={{ toast, fail }}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={"toast " + t.kind}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
