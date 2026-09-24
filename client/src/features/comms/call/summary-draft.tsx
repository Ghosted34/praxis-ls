/**
 * The caller's summary draft editor (decision row 3: nothing posts a summary
 * by itself; the caller reads, edits and sends).
 *
 * Embeddable: the call's own page (/comms/calls/:id, call-record.tsx) renders
 * it inline. It used to be a floating panel that only a socket event could
 * open, and the event never arrived from the worker (calls audit A6).
 *
 * The prose is the caller's to rewrite, and the EN/FR switch regenerates it.
 * Key points and follow-ups are quotations and stay in the language spoken.
 * The state machine lives in summary-draft-state.ts.
 */
import * as React from "react";
// The same shared schema the send endpoint parses, so the button can say what
// is wrong before the caller meets a 422.
import { callSummary } from "@shared";
import { tr } from "@/lib/i18n";
import { dateDmy } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/use-confirm";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ui/segmented";
import { Callout } from "@/components/ui/callout";
import * as api from "@/lib/smartcomm-api";
import { EMPTY, summaryDraftReducer } from "./summary-draft-state";
import { provenanceLabel } from "./call-provenance";

export function CallSummaryEditor({
  callId,
  onChanged,
}: {
  callId: string;
  /** After a send or a discard, so the page around it can refresh. */
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [state, dispatch] = React.useReducer(summaryDraftReducer, EMPTY);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const view = await api.getCallSummary(callId);
      dispatch({ type: "loaded", view });
    } catch {
      /* @silent:parse — the draft may still be being written; the poll below
         retries, and the page shows the transcription state meanwhile. */
    } finally {
      setLoading(false);
    }
  }, [callId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // A draft that is still being written is worth waiting for.
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

  const validation = callSummary.schema.safeParse({
    summary: state.text,
    key_points: state.points,
    follow_ups: state.followUps,
  });

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
      onChanged?.();
    } catch {
      dispatch({ type: "error", message: tr("Could not send the summary. Try again.") });
    }
  };

  const discard = async () => {
    const ok = await confirm({
      title: tr("Discard this summary?"),
      body: tr("The draft is kept on the call but can no longer be sent."),
      confirmLabel: tr("Discard summary"),
      cancelLabel: tr("Keep it"),
      destructive: true,
    });
    if (!ok) return;
    dispatch({ type: "discard" });
    try {
      await api.discardCallSummary(callId);
      dispatch({ type: "discarded" });
      onChanged?.();
    } catch {
      dispatch({ type: "error", message: tr("Could not discard the draft. Try again.") });
    }
  };

  const editing = state.status === "ready" || state.status === "sending" || state.status === "error";

  return (
    <div className="space-y-3">
      <p className="text-micro text-muted-foreground">{provenanceLabel(state.provenance)}</p>

      {state.status === "waiting" && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {loading ? tr("Loading…") : tr("Transcribing the call…")}
        </p>
      )}
      {state.status === "sent" && (
        <p className="text-sm text-muted-foreground">
          {tr("This summary has been sent to the conversation.")}
        </p>
      )}
      {state.status === "discarded" && (
        <p className="text-sm text-muted-foreground">{tr("This draft was discarded.")}</p>
      )}

      {editing && (
        <>
          {state.updateAvailable && (
            <Callout tone="info">
              {tr("The certified transcript is ready — you can post an updated summary.")}
            </Callout>
          )}

          <Field label={tr("Summary")} htmlFor="call-summary-text">
            <Textarea
              id="call-summary-text"
              value={state.text}
              onChange={(e) => dispatch({ type: "edit", text: e.target.value })}
              rows={5}
              maxLength={callSummary.LIMITS.summaryMax}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-micro text-muted-foreground">{tr("Rewrite in:")}</span>
            <Segmented<"en" | "fr">
              label={tr("Summary language")}
              value={state.language}
              options={[
                { value: "en", label: tr("English"), disabled: state.regenerating },
                { value: "fr", label: tr("French"), disabled: state.regenerating },
              ]}
              onChange={(language) => void regenerate(language)}
            />
            {state.regenerating && (
              <span className="text-micro text-muted-foreground" aria-live="polite">{tr("Rewriting…")}</span>
            )}
          </div>

          {state.points.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{tr("Key points")}</p>
              <ul className="mt-1 space-y-1">
                {state.points.map((p, i) => (
                  <li key={`${p.text}-${i}`} className="text-sm text-foreground">
                    {p.text}{" "}
                    <span className="text-micro text-muted-foreground">({p.raised_by === "caller" ? tr("you") : tr("them")})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-micro text-muted-foreground">{tr("Quoted as spoken — these are never translated.")}</p>
            </div>
          )}

          {state.followUps.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{tr("Follow-ups")}</p>
              <ul className="mt-1 space-y-1">
                {state.followUps.map((f, i) => (
                  <li key={`${f.text}-${i}`} className="text-sm text-foreground">
                    {f.text}{" "}
                    <span className="text-micro text-muted-foreground">
                      ({f.owner === "caller" ? tr("you") : tr("them")}
                      {f.due ? ` · ${dateDmy(f.due)}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.error && <Callout tone="bad">{state.error}</Callout>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => void discard()}
              disabled={state.status === "sending"}
              icon={null}
            >
              {tr("Discard")}
            </Button>
            <Button
              onClick={() => void send()}
              disabled={state.status === "sending" || state.regenerating || !validation.success}
              loading={state.status === "sending"}
            >
              {state.updateAvailable ? tr("Post updated summary") : tr("Send to conversation")}
            </Button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
