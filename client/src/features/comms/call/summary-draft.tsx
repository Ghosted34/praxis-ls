/**
 * The caller's summary draft (Smart Comms PR-2, §4.10 / decision row 3).
 *
 * ── THERE IS NO AUTO-POST ───────────────────────────────────────────────────
 *
 * This panel is the whole reason the send endpoint exists: the pipeline writes a
 * draft, the CALLER reads it, edits what is wrong, and presses send. Nothing
 * posts a summary by itself — not the pipeline, not a timer, not the socket
 * event that opened this panel.
 *
 * ── WHAT THE CALLER MAY EDIT, AND WHAT THEY MUST NOT ────────────────────────
 *
 * The connective prose (`summary_text`) is theirs to rewrite in the app
 * language they are working in, and the EN/FR toggle regenerates it. The key
 * points and follow-ups are quotations: they stay in the language they were
 * spoken, and neither this component nor anything behind it translates them
 * (§4.10). The labels below say so, in the reader's own language, because a
 * user who assumes the whole card follows the toggle would "fix" a French
 * quotation by rewriting it.
 *
 * ── THE STATE MACHINE IS PURE AND SEPARATE ─────────────────────────────────
 *
 * `summaryDraftReducer` owns the transitions (load → edit → regenerate → send)
 * and is exported because the guards in it are the promise: a regenerate while
 * a send is in flight, a second send of a sent summary, a send of a draft whose
 * text was emptied. The component below is a renderer over that state.
 */
import * as React from "react";
// The summary contract itself, shared with the API (§4.10). The caller's edit
// is checked against the SAME schema the endpoint parses, so the send button can
// say what is wrong — instead of the caller discovering a 422 after typing.
import { callSummary } from "@shared";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import * as api from "@/lib/smartcomm-api";
import type { CallProvenance } from "@/lib/smartcomm-api";
import { EMPTY, summaryDraftReducer } from "./summary-draft-state";

const PROVENANCE_LABEL: Record<CallProvenance, string> = {
  groq: "Transcribed from the call recording",
  "browser-live": "Generated from the in-call browser capture (unverified)",
  "transcript-only": "Summary unavailable — provider down",
};

/** How the draft reads out loud, whether or not it may be edited. */
function provenanceLabel(provenance: CallProvenance): string {
  return tr(PROVENANCE_LABEL[provenance] || PROVENANCE_LABEL.groq);
}

/** The caller's editor for one call's draft. `callId` is the whole input: the
 *  panel re-reads the view, because the pipeline may still be finishing. */
export function CallSummaryPanel({
  callId,
  onClose,
  onPosted,
}: {
  callId: string;
  onClose: () => void;
  onPosted?: (messageId: string) => void;
}) {
  const toast = useToast();
  const [state, dispatch] = React.useReducer(summaryDraftReducer, EMPTY);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const view = await api.getCallSummary(callId);
      dispatch({ type: "loaded", view });
    } catch {
      /* @silent:parse — the panel is opened by a socket event and may be a beat
         ahead of the row; the retry below is the answer, not an error screen. */
    } finally {
      setLoading(false);
    }
  }, [callId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // A draft that is still being written (the LLM is running, the last part is
  // still uploading) is worth waiting for: the socket event arrives when it is
  // ready, and this poll is the belt to that braces.
  React.useEffect(() => {
    if (!loading && state.status !== "waiting") return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [loading, state.status, load]);

  const regenerate = async (language: "en" | "fr") => {
    dispatch({ type: "regenerate", language });
    try {
      const out = await api.regenerateCallSummary(callId, language);
      dispatch({ type: "regenerated", payload: out });
    } catch {
      dispatch({ type: "error", message: tr("Could not rewrite the summary. Try again.") });
    }
  };

  // What the contract says about the current text: the limits and the shape
  // come from packages/shared, so the client cannot disagree with the API about
  // what is sendable.
  const validation = callSummary.schema.safeParse({
    summary: state.text,
    key_points: state.points,
    follow_ups: state.followUps,
  });
  const canSend = validation.success;

  const send = async () => {
    dispatch({ type: "send" });
    try {
      const out = await api.sendCallSummary(callId, {
        summary_text: state.text,
        key_points: state.points,
        follow_ups: state.followUps,
      });
      dispatch({ type: "sent", isUpdate: out.is_update });
      toast.success(tr("Summary sent to the conversation"));
      onPosted?.(out.message_id);
    } catch {
      dispatch({ type: "error", message: tr("Could not send the summary. Try again.") });
    }
  };

  const discard = async () => {
    dispatch({ type: "discard" });
    try {
      await api.discardCallSummary(callId);
      dispatch({ type: "discarded" });
      onClose();
    } catch {
      dispatch({ type: "error", message: tr("Could not discard the draft. Try again.") });
    }
  };

  if (state.status === "discarded") return null;

  return (
    <div
      role="dialog"
      aria-label={tr("Call summary")}
      className="fixed bottom-4 right-4 z-[60] w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-l)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{tr("Call summary")}</h2>
          <p className="text-micro text-muted-foreground">{provenanceLabel(state.provenance)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 text-muted-foreground hover:text-foreground"
          aria-label={tr("Close")}
        >
          ✕
        </button>
      </div>

      {state.status === "waiting" && (
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          {tr("Transcribing the call…")}
        </p>
      )}

      {state.status === "sent" && (
        <p className="mt-3 text-sm text-muted-foreground">
          {tr("This summary has been sent to the conversation.")}
        </p>
      )}

      {(state.status === "ready" || state.status === "sending" || state.status === "error") && (
        <div className="mt-3 space-y-3">
          {state.updateAvailable && (
            <p className="rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))/0.12] px-3 py-2 text-xs text-foreground">
              {tr("The certified transcript is ready — you can post an updated summary.")}
            </p>
          )}

          <label className="block text-xs font-medium text-muted-foreground" htmlFor="call-summary-text">
            {tr("Summary")}
          </label>
          <textarea
            id="call-summary-text"
            value={state.text}
            onChange={(e) => dispatch({ type: "edit", text: e.target.value })}
            rows={5}
            maxLength={callSummary.LIMITS.summaryMax}
            className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground"
          />

          <div className="flex items-center gap-2">
            <span className="text-micro text-muted-foreground">{tr("Rewrite in:")}</span>
            <button
              type="button"
              onClick={() => void regenerate("en")}
              disabled={state.regenerating || state.language === "en"}
              aria-pressed={state.language === "en"}
              className={cn(
                "rounded-md border px-2 py-0.5 text-micro",
                state.language === "en"
                  ? "border-[rgb(var(--brand-blue))]/50 bg-[rgb(var(--brand-blue))/0.15] text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {tr("English")}
            </button>
            <button
              type="button"
              onClick={() => void regenerate("fr")}
              disabled={state.regenerating || state.language === "fr"}
              aria-pressed={state.language === "fr"}
              className={cn(
                "rounded-md border px-2 py-0.5 text-micro",
                state.language === "fr"
                  ? "border-[rgb(var(--brand-blue))]/50 bg-[rgb(var(--brand-blue))/0.15] text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {tr("French")}
            </button>
            {state.regenerating && (
              <span className="text-micro text-muted-foreground" aria-live="polite">
                {tr("Rewriting…")}
              </span>
            )}
          </div>

          {state.points.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{tr("Key points")}</p>
              <ul className="mt-1 space-y-1">
                {state.points.map((p, i) => (
                  <li key={`${p.text}-${i}`} className="text-sm text-foreground">
                    • {p.text}{" "}
                    <span className="text-micro text-muted-foreground">
                      ({p.raised_by === "caller" ? tr("you") : tr("them")})
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-micro text-muted-foreground">
                {tr("Quoted as spoken — these are never translated.")}
              </p>
            </div>
          )}

          {state.followUps.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{tr("Follow-ups")}</p>
              <ul className="mt-1 space-y-1">
                {state.followUps.map((f, i) => (
                  <li key={`${f.text}-${i}`} className="text-sm text-foreground">
                    • {f.text}{" "}
                    <span className="text-micro text-muted-foreground">
                      ({f.owner === "caller" ? tr("you") : tr("them")}
                      {f.due ? ` · ${f.due}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.error && (
            <p role="alert" className="text-xs text-[rgb(var(--bad))]">
              {state.error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void discard()}
              disabled={state.status === "sending"}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {tr("Discard")}
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={state.status === "sending" || state.regenerating || !canSend}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {state.status === "sending"
                ? tr("Sending…")
                : state.updateAvailable
                  ? tr("Post updated summary")
                  : tr("Send to conversation")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
