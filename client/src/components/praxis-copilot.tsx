/**
 * Praxis copilot — the global AI assistant, mounted once in the app shell so it
 * rides along on every screen (finance, procurement, operations, everywhere).
 * A floating "Chat with Praxis AI" button opens a slide-out chat panel backed by
 * /ai/ask; proposed write-actions come back AWAITING_CONFIRM and are executed
 * permission-inheringly via Confirm. Accent is --primary (settings-driven).
 * This is the general copilot — distinct from a screen's inline PraxisActions.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { askPraxis, confirmAiAction, confirmAiBatch, type AiActionRun } from "@/lib/ai-api";
import { errMsg } from "@/lib/use-resource";
import { useAiEnabled } from "@/components/ai-actions";

type Msg = {
  role: "user" | "praxis";
  text: string;
  actions?: AiActionRun[];
  batchId?: string | null;
  done?: boolean;
};

const STARTERS = [
  "What's overdue in receivables?",
  "Summarise open operation files",
  "Draft a proforma advance",
];

export function PraxisCopilot() {
  const aiEnabled = useAiEnabled();
  const [open, setOpen] = React.useState(false);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, open]);

  // Latest `send` in a ref so the (once-registered) event listener always calls
  // the current closure, not a stale one.
  const sendRef = React.useRef<(t: string) => void>(() => {});

  // Openable from elsewhere: the command palette's "Ask Praxis AI…" (no payload)
  // and a screen's clickable AI-action cards (which pass `detail.prompt` to
  // auto-ask — writes still come back AWAITING_CONFIRM for the human).
  React.useEffect(() => {
    const openCopilot = (e: Event) => {
      setOpen(true);
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (prompt) sendRef.current(prompt);
    };
    window.addEventListener("praxis:open-copilot", openCopilot);
    return () => window.removeEventListener("praxis:open-copilot", openCopilot);
  }, []);

  // Global AI gate: when the tenant has AI off, no Praxis affordance shows (doc/AI_GATE_BE_HANDOFF.md).
  if (!aiEnabled) return null;

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const r = await askPraxis(q);
      setMsgs((m) => [...m, { role: "praxis", text: r.answer || "…", actions: r.actions, batchId: r.batch_id }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "praxis", text: errMsg(e) }]);
    } finally {
      setBusy(false);
    }
  }
  sendRef.current = send;

  async function runAction(mi: number, run: AiActionRun) {
    setConfirming(run.action_run_id);
    try {
      await confirmAiAction(run.action_run_id);
      setMsgs((m) => m.map((mm, i) => (i === mi ? { ...mm, done: true } : mm)));
    } catch (e) {
      setMsgs((m) => [...m, { role: "praxis", text: errMsg(e) }]);
    } finally {
      setConfirming(null);
    }
  }

  async function runBatch(mi: number, batchId: string) {
    setConfirming(batchId);
    try {
      await confirmAiBatch(batchId);
      setMsgs((m) => m.map((mm, i) => (i === mi ? { ...mm, done: true } : mm)));
    } catch (e) {
      setMsgs((m) => [...m, { role: "praxis", text: errMsg(e) }]);
    } finally {
      setConfirming(null);
    }
  }

  return (
    <>
      {/* Launcher lives in the floating action cluster (components/floating-actions);
          it opens this panel via the `praxis:open-copilot` event. */}
      {open && (
        <div className="lux-card fixed bottom-40 right-5 z-50 flex h-[min(70vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-border shadow-2xl md:bottom-24">
          {/* header */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-[rgb(var(--primary))]">
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold">Praxis AI</div>
              <div className="micro">Copilot · permission-aware</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          {/* body */}
          <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {msgs.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Ask about anything on your desk — receivables, operation files, costing, procurement. I only act within your permissions.</p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary">{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-card"}`}>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    {m.actions && m.actions.length > 0 && !m.done && (
                      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                        {m.batchId ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="micro">{m.actions.length} actions proposed</span>
                            <Button size="sm" loading={confirming === m.batchId} onClick={() => runBatch(i, m.batchId!)}>Confirm all</Button>
                          </div>
                        ) : (
                          m.actions.map((a) => (
                            <div key={a.action_run_id} className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5"><Pill tone="warn">action</Pill><span className="micro">{a.action_key}</span></span>
                              <Button size="sm" loading={confirming === a.action_run_id} onClick={() => runAction(i, a)}>Confirm</Button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                    {m.done && <div className="mt-1 micro text-[rgb(var(--ok))]">✓ Done</div>}
                  </div>
                </div>
              ))
            )}
            {busy && <div className="micro">Praxis is thinking…</div>}
          </div>

          {/* input */}
          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2"
            onSubmit={(e) => { e.preventDefault(); send(input); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Praxis…"
              className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <Button type="submit" size="sm" loading={busy} disabled={!input.trim()}>Send</Button>
          </form>
        </div>
      )}
    </>
  );
}
