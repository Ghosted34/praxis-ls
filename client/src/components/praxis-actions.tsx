/**
 * PraxisActions — the in-screen AI affordance. Drop it in a screen's PageHeader
 * `action` slot with that screen's `ai` suggestions (from screen-specs.ts). It
 * opens a small panel where Praxis can draft / suggest / carry out the screen's
 * actions: proposed write-actions render with a Confirm (executed permission-
 * inheritingly), and `onApplied` refreshes the list.
 *
 * This is per-screen and screen-scoped — distinct from any general chat.
 *
 * ── STREAMING, LIKE THE CHAT (audit E1) ────────────────────────────────────
 *
 * This panel used the non-streaming `askPraxis`, which the general chat gave up
 * on for the reason recorded in `components/ai/thread.ts`: it waits for the
 * whole completion before rendering anything, so the person watches a spinner
 * for 5–15 seconds with no sign of progress. That was already the worse
 * experience; audit E1 made it a reliability problem too, because the server's
 * per-call cap is now 120s and the non-streaming request had no client bound at
 * all — a stalled turn was a spinner that never resolved.
 *
 * The SSE path fixes all three at once: first tokens in ~500ms, a 15s heartbeat
 * that proves the turn is alive through any proxy, and an abort that actually
 * reaches the server when the panel closes. `askPraxisStream` still falls back
 * to `askPraxis` by itself where SSE cannot be reached, and that call is now
 * bounded by `AI_ASK_TIMEOUT_MS`, so neither path can hang.
 */
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { errMsg } from "@/lib/use-resource";
import {
  askPraxisStream,
  classifyAiFailure,
  confirmAiAction,
  confirmAiBatch,
  type AiFailure,
  type AskResult,
  type AiActionRun,
} from "@/lib/ai-api";

export type PraxisSuggestion = {
  label: string;
  prompt: string;
  kind: "read" | "write" | "assist";
};

const KIND_TONE = { read: "blue", write: "orange", assist: "mute" } as const;

function Sparkle() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />
    </svg>
  );
}

export function PraxisActions({
  suggestions = [],
  context,
  onApplied,
  label = "Ask Praxis",
}: {
  suggestions?: PraxisSuggestion[];
  /** Short screen hint prefixed to the message so Praxis scopes to this screen. */
  context?: string;
  onApplied?: () => void;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sparkle /> {label}
      </Button>
      {open && (
        <PraxisPanel
          suggestions={suggestions}
          context={context}
          onClose={() => setOpen(false)}
          onApplied={onApplied}
        />
      )}
    </>
  );
}

function PraxisPanel({
  suggestions,
  context,
  onClose,
  onApplied,
}: {
  suggestions: PraxisSuggestion[];
  context?: string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<AiFailure | null>(null);
  const [result, setResult] = React.useState<AskResult | null>(null);
  /** The assistant's current step, replaced each time and never kept. */
  const [status, setStatus] = React.useState<string | null>(null);
  const [convId, setConvId] = React.useState<string | undefined>(undefined);
  const [executed, setExecuted] = React.useState<Record<string, "ok" | "err">>(
    {},
  );
  const [confirming, setConfirming] = React.useState<string | null>(null);

  // The in-flight stream. Aborted when the panel closes or a new question
  // starts, so a turn nobody is waiting for stops costing the server a model
  // call — the disconnect-abort half of audit E1.
  const streamAbort = React.useRef<AbortController | null>(null);
  const lastAsked = React.useRef<string | null>(null);
  React.useEffect(() => () => streamAbort.current?.abort(), []);

  async function ask(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    lastAsked.current = msg;

    streamAbort.current?.abort();
    const abort = new AbortController();
    streamAbort.current = abort;

    setBusy(true);
    setFailure(null);
    setStatus(null);
    setResult(null);
    setExecuted({});

    // Built up locally and committed to state as it grows, so the answer types
    // out rather than appearing all at once at the end.
    let answer = "";
    let streamed: AskResult = { answer: "", actions: [] };
    const commit = (patch: Partial<AskResult>) => {
      streamed = { ...streamed, ...patch };
      setResult(streamed);
    };

    try {
      for await (const event of askPraxisStream(
        context ? `[Screen: ${context}] ${msg}` : msg,
        convId,
        undefined,
        abort.signal,
      )) {
        if (abort.signal.aborted) return;
        if (event.type === "delta") {
          answer += event.text;
          setStatus(null);
          commit({ answer });
        } else if (event.type === "status") {
          // One line saying what is happening NOW — replaced, never appended.
          setStatus(event.text);
        } else if (event.type === "reset") {
          // What arrived so far was a preamble to a tool call, not the reply.
          answer = "";
          commit({ answer });
        } else if (event.type === "answer") {
          answer = event.text || answer;
          setStatus(null);
          commit({ answer });
        } else if (event.type === "actions") {
          commit({ actions: event.actions, batch_id: event.batch_id });
          // ai_action_run rows are keyed by conversation; the batch id keeps
          // follow-ups in the same thread when there is one.
          if (event.batch_id) setConvId((c) => c ?? event.batch_id ?? undefined);
        } else if (event.type === "done") {
          if (event.conversation_id) setConvId((c) => c ?? event.conversation_id ?? undefined);
          setFailure(
            classifyAiFailure({
              provider: event.provider,
              blocked: streamed.blocked,
              completed: true,
            }),
          );
        } else if (event.type === "error") {
          setFailure(classifyAiFailure({ error: new Error(event.message) }));
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) setFailure(classifyAiFailure({ error: e }));
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false);
        // A status line claims work is in progress. However the turn ended, it
        // is not, so the line must not outlive it.
        setStatus(null);
      }
      if (streamAbort.current === abort) streamAbort.current = null;
    }
  }

  async function confirmOne(a: AiActionRun) {
    setConfirming(a.action_run_id);
    try {
      const r = await confirmAiAction(a.action_run_id);
      setExecuted((m) => ({ ...m, [a.action_run_id]: r.ok ? "ok" : "err" }));
      if (r.ok) onApplied?.();
    } catch {
      setExecuted((m) => ({ ...m, [a.action_run_id]: "err" }));
    } finally {
      setConfirming(null);
    }
  }

  async function confirmAll(batchId: string) {
    setConfirming(batchId);
    try {
      const r = await confirmAiBatch(batchId);
      setResult((prev) => prev); // keep panel; mark all pending as executed
      setExecuted((m) => {
        const next = { ...m };
        (result?.actions || []).forEach((a) => {
          if (
            a.requires_confirmation &&
            !(a.validation_errors && a.validation_errors.length)
          )
            next[a.action_run_id] = "ok";
        });
        return next;
      });
      if (r.executed > 0) onApplied?.();
    } catch (e) {
      setFailure({ kind: "transient", message: errMsg(e) });
    } finally {
      setConfirming(null);
    }
  }

  const pending = (result?.actions || []).filter(
    (a) =>
      a.requires_confirmation &&
      !(a.validation_errors && a.validation_errors.length) &&
      !executed[a.action_run_id],
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Praxis"
      description="Ask Praxis to draft, suggest or carry out this screen's actions. Write actions run only after you confirm."
    >
      <div className="space-y-4">
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setMessage(s.prompt);
                  void ask(s.prompt);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-accent hover:text-foreground"
                title={s.prompt}
              >
                <Pill tone={KIND_TONE[s.kind]}>{s.kind}</Pill>
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                void ask(message);
            }}
            rows={2}
            placeholder="Ask Praxis… (⌘/Ctrl+Enter to send)"
            className="min-h-[44px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          />
          <Button
            onClick={() => void ask(message)}
            loading={busy}
            disabled={!message.trim() || busy}
          >
            Send
          </Button>
        </div>

        {failure && (
          <div className="space-y-2">
            <ErrorState message={failure.message} />
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !lastAsked.current}
                onClick={() => lastAsked.current && void ask(lastAsked.current)}
              >
                Try again
              </Button>
              {/* Both kinds keep the retry. Only a provider failure says where
                  the fix lives, because retrying does not resolve a credential
                  and the person needs to know who to ask. */}
              {failure.kind === "provider" && (
                <span className="text-xs text-muted-foreground">
                  Retrying will not help until the vendor credentials are fixed.
                </span>
              )}
            </div>
          </div>
        )}

        {status && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {status}
          </div>
        )}

        {result && (
          <div className="space-y-3">
            {result.blocked ? (
              <div className="lux-card p-3 text-sm text-muted-foreground">
                {result.answer}
              </div>
            ) : (
              <>
                {result.answer && (
                  <div className="lux-card whitespace-pre-wrap p-3 text-sm">
                    {result.answer}
                  </div>
                )}
                {result.actions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="micro">Proposed actions</span>
                      {pending.length > 1 && result.batch_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={confirming === result.batch_id}
                          onClick={() => void confirmAll(result.batch_id!)}
                        >
                          Confirm all {pending.length}
                        </Button>
                      )}
                    </div>
                    {result.actions.map((a) => {
                      const st = executed[a.action_run_id];
                      const invalid =
                        a.validation_errors && a.validation_errors.length > 0;
                      return (
                        <div
                          key={a.action_run_id}
                          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="num text-sm font-medium text-foreground">
                              {a.action_key}
                            </div>
                            {invalid && (
                              <div className="text-xs text-destructive">
                                {a.validation_errors!.join("; ")}
                              </div>
                            )}
                          </div>
                          {st === "ok" ? (
                            <Pill tone="ok">Done</Pill>
                          ) : st === "err" ? (
                            <Pill tone="bad">Failed</Pill>
                          ) : invalid ? (
                            <Pill tone="bad">Invalid</Pill>
                          ) : a.requires_confirmation ? (
                            <Button
                              size="sm"
                              loading={confirming === a.action_run_id}
                              onClick={() => void confirmOne(a)}
                            >
                              Confirm
                            </Button>
                          ) : (
                            <Pill tone="mute">Auto</Pill>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
