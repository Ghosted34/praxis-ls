/**
 * The caller's summary draft editor (decision row 3: nothing posts a summary
 * by itself; the caller reads, edits and sends).
 *
 * Embedded twice: pinned above the composer of the conversation (owner
 * decision O3, pinned-call-summary.tsx) and on the call's own page
 * (call-record.tsx). The caller edits the prose, the key points and the
 * follow-ups, switches EN/FR (which redrafts the prose), then sends or
 * discards. Key points and follow-ups stay in the language spoken. Minutes
 * that could not be transcribed are named. The state machine lives in
 * summary-draft-state.ts.
 */
import * as React from "react";
// The same shared schema the send endpoint parses, so the button can say what
// is wrong before the caller meets a 422.
import { callSummary } from "@shared";
import { tr, tv } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/use-confirm";
import { Button } from "@/components/ui/button";
import { Field, Select as NativeSelect } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { TrashIcon } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ui/segmented";
import { Callout } from "@/components/ui/callout";
import * as api from "@/lib/smartcomm-api";
import { EMPTY, summaryDraftReducer } from "./summary-draft-state";
import { provenanceLabel } from "./call-provenance";
import { gapsSentence } from "./call-labels";

export function CallSummaryEditor({
  callId,
  onChanged,
  refreshKey,
}: {
  callId: string;
  /** After a send or a discard, so the page around it can refresh. */
  onChanged?: () => void;
  /** Bumped when the server redrafted the summary; re-read unless the caller
   *  has unsent edits, which a redraft must never overwrite. */
  refreshKey?: number;
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

  const dirty = React.useRef(false);
  dirty.current = state.dirty;

  // The rewrite is a job (audit C8): after the request, the draft is re-read
  // until it is in the language asked for, or has stopped being a draft.
  const rewriteTo = React.useRef<"en" | "fr" | null>(null);
  const checkRewrite = React.useCallback(async () => {
    const target = rewriteTo.current;
    if (!target) return;
    try {
      const view = await api.getCallSummary(callId);
      const s = view.summary;
      if (!s || s.language === target || s.draft_status !== "PENDING_REVIEW") {
        rewriteTo.current = null;
        dispatch({ type: "loaded", view });
      }
    } catch {
      /* @silent:parse — the next poll asks again; the timeout below says so. */
    }
  }, [callId]);

  React.useEffect(() => {
    if (!refreshKey) return;
    if (rewriteTo.current) void checkRewrite();
    else if (!dirty.current) void load();
  }, [refreshKey, load, checkRewrite]);

  React.useEffect(() => {
    if (!state.regenerating) return;
    const poll = setInterval(() => void checkRewrite(), 2000);
    const giveUp = setTimeout(() => {
      rewriteTo.current = null;
      dispatch({ type: "error", message: tr("Could not rewrite the summary. Try again.") });
    }, 90_000);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [state.regenerating, checkRewrite]);

  // A draft that is still being written is worth waiting for.
  React.useEffect(() => {
    if (!loading && state.status !== "waiting") return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [loading, state.status, load]);

  const regenerate = async (language: "en" | "fr") => {
    dispatch({ type: "regenerate", language });
    try {
      await api.regenerateCallSummary(callId, language);
      rewriteTo.current = language;
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
          {state.gaps.length > 0 && (
            <Callout tone="warn">{gapsSentence(state.gaps)}</Callout>
          )}
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
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">{tr("Key points")}</legend>
              {state.points.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={tv("Key point {{n}}", { n: i + 1 })}
                    value={p.text}
                    maxLength={callSummary.LIMITS.textMax}
                    onChange={(e) => dispatch({
                      type: "edit",
                      points: state.points.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                    })}
                  />
                  <span className="shrink-0 text-micro text-muted-foreground">
                    {p.raised_by === "caller" ? tr("you") : tr("them")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    icon={null}
                    aria-label={tv("Remove key point {{n}}", { n: i + 1 })}
                    onClick={() => dispatch({ type: "edit", points: state.points.filter((_, j) => j !== i) })}
                  >
                    <TrashIcon width={16} height={16} />
                  </Button>
                </div>
              ))}
              <p className="text-micro text-muted-foreground">{tr("Quoted as spoken — these are never translated.")}</p>
            </fieldset>
          )}

          {state.followUps.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">{tr("Follow-ups")}</legend>
              {state.followUps.map((f, i) => {
                const update = (patch: Partial<typeof f>) => dispatch({
                  type: "edit",
                  followUps: state.followUps.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                });
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="min-w-[12rem] flex-1"
                      aria-label={tv("Follow-up {{n}}", { n: i + 1 })}
                      value={f.text}
                      maxLength={callSummary.LIMITS.textMax}
                      onChange={(e) => update({ text: e.target.value })}
                    />
                    <NativeSelect
                      className="w-auto"
                      aria-label={tv("Who does follow-up {{n}}", { n: i + 1 })}
                      value={f.owner}
                      onChange={(e) => update({ owner: e.target.value === "callee" ? "callee" : "caller" })}
                    >
                      <option value="caller">{tr("You")}</option>
                      <option value="callee">{tr("Them")}</option>
                    </NativeSelect>
                    <DateField
                      className="w-[9.5rem]"
                      aria-label={tv("Due date of follow-up {{n}}", { n: i + 1 })}
                      value={f.due || ""}
                      onChange={(iso) => update({ due: iso || null })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      icon={null}
                      aria-label={tv("Remove follow-up {{n}}", { n: i + 1 })}
                      onClick={() => dispatch({ type: "edit", followUps: state.followUps.filter((_, j) => j !== i) })}
                    >
                      <TrashIcon width={16} height={16} />
                    </Button>
                  </div>
                );
              })}
            </fieldset>
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
