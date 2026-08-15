/**
 * Toast — transient confirmation or failure notice for an action.
 *
 * WHY IT EXISTS (F13). The audit counted THREE live regions in ~40,000 lines,
 * and noted that "async success/failure is announced nowhere". A user who saves
 * a journal entry gets a modal close and a row appearing; a screen-reader user
 * gets silence, and cannot tell a successful post from one that quietly failed.
 * In a ledger that is not a polish issue.
 *
 * The region is `aria-live="polite"` with `role="status"` for success and
 * `role="alert"` (assertive) for errors — success should not interrupt what the
 * user is reading, a failure should.
 *
 * NOT A REPLACEMENT FOR INLINE ERRORS. A toast disappears; anything the user
 * must act on belongs where the problem is — a field `error` (F4) or an
 * `ErrorState` in the panel. Use a toast for "done" and for failures the user
 * cannot fix in place ("Export failed — the report timed out").
 *
 * @example  // once, near the app root
 * <ToastProvider>{children}</ToastProvider>
 *
 * @example  // anywhere below it
 * const toast = useToast();
 * await tenant("/clients", { method: "POST", body });
 * toast.success("Client created");
 * // …
 * catch (e) { toast.error(errMsg(e)); }
 *
 * BEST PRACTICE. One short line, past tense, naming what happened ("Invoice
 * posted"), not the mechanism ("Success"). Errors get a longer timeout than
 * successes because they need reading. Never put a control inside a toast that
 * exists nowhere else — it will time out before a keyboard user reaches it.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { XIcon } from "@/components/ui/icons";

export type ToastTone = "success" | "error" | "info";

type Toast = { id: number; tone: ToastTone; message: string };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
};

const ToastContext = React.createContext<ToastApi | null>(null);

/** Errors linger: a failure needs reading, a confirmation does not. */
const TIMEOUT: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  error: 8000,
};

const TONE_CLASS: Record<ToastTone, string> = {
  success: "border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok-fill)/0.12)]",
  error: "border-[rgb(var(--bad))]/40 bg-[rgb(var(--bad-fill)/0.12)]",
  info: "border-[rgb(var(--brand-blue))]/40 bg-[rgb(var(--brand-blue)/0.10)]",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const push = React.useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, tone, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TIMEOUT[tone]),
      );
    },
    [dismiss],
  );

  // Clear pending timers on unmount so a dismiss cannot fire into a dead tree.
  React.useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The region is always mounted, not created with the first toast: a live
          region added to the DOM at the same moment as its content is not
          reliably announced. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-3 shadow-[var(--shadow-l)] animate-fade-in",
              TONE_CLASS[t.tone],
            )}
          >
            <p className="min-w-0 flex-1 text-sm text-foreground">
              {t.message}
            </p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <XIcon width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx)
    throw new Error(
      "useToast must be used inside <ToastProvider>. Mount it once near the app root.",
    );
  return ctx;
}
