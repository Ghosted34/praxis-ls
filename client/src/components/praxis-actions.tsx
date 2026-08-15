/**
 * PraxisActions — the in-screen AI affordance. Drop it in a screen's PageHeader
 * `action` slot with that screen's `ai` suggestions (from screen-specs.ts). It
 * opens a small panel where Praxis can draft / suggest / carry out the screen's
 * actions: the prompt goes to /ai/ask, proposed write-actions render with a
 * Confirm (executed permission-inheringly), and `onApplied` refreshes the list.
 *
 * This is per-screen and screen-scoped — distinct from any general chat.
 */
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { errMsg } from "@/lib/use-resource";
import {
  askPraxis,
  confirmAiAction,
  confirmAiBatch,
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
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<AskResult | null>(null);
  const [convId, setConvId] = React.useState<string | undefined>(undefined);
  const [executed, setExecuted] = React.useState<Record<string, "ok" | "err">>(
    {},
  );
  const [confirming, setConfirming] = React.useState<string | null>(null);

  async function ask(text: string) {
    const msg = text.trim();
    if (!msg) return;
    setBusy(true);
    setError(null);
    try {
      const out = await askPraxis(
        context ? `[Screen: ${context}] ${msg}` : msg,
        convId,
      );
      setResult(out);
      // ai_action_run rows are keyed by conversation; the batch id lets us keep
      // follow-ups in the same thread when present.
      if (out.batch_id) setConvId((c) => c ?? out.batch_id ?? undefined);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
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
      setError(errMsg(e));
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

        {error && <ErrorState message={error} />}

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
