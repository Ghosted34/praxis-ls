/**
 * The appraisal review (0701) — the manager's half.
 *
 * ── WHY THE TWO NUMBERS SIT SIDE BY SIDE ──────────────────────────────────
 *
 * Each KPI shows what the evidence says AND what the manager decided, in
 * separate columns, permanently. The whole value of computing a score from
 * attendance and rule breaches is that a manager can DISAGREE with it — they
 * know the person was covering a colleague in March and the data does not. A
 * single column that silently becomes one or the other destroys exactly that,
 * so the screen never merges them and marks the rows a human has settled.
 *
 * A metric that could not be measured says so, in words, rather than showing a
 * zero. Zero reads as "failed", and nobody skimming twenty rows stops to ask
 * which kind of zero they are looking at.
 *
 * Desktop-first: the KPI table takes the height and scrolls inside itself, with
 * the roll-up and the narrative fixed beside it, so a manager comparing a line
 * against the summary does not lose one to reach the other.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  SUBMITTED: "warn",
  ACKNOWLEDGED: "ok",
  DISPUTED: "bad",
  FINALISED: "blue",
};

const num = (v: unknown) => (v == null ? null : Number(v));

/** Why a line has no evidence-derived rating — in words, never as a zero. */
const REASONS: Record<string, string> = {
  manual: "Scored by hand",
  no_attendance: "No attendance recorded",
  not_rostered: "Not rostered on any training",
  no_target: "No target set",
  unknown_source: "Source not understood",
};

function reasonOf(line: api.ReviewLine): string | null {
  const e = (line.ai_evidence || {}) as { reason?: string; source?: string };
  if (num(line.ai_rating) !== null) return null;
  if (e.reason && REASONS[e.reason]) return REASONS[e.reason];
  if (!line.auto_source) return REASONS.manual;
  return "Not measured";
}

/** The counts behind a rating — an employee disputing a score is entitled to
 *  the arithmetic, not the verdict. */
function workingOf(line: api.ReviewLine): string | null {
  const e = line.ai_evidence as Record<string, number | string> | null;
  if (!e) return null;
  const parts = Object.entries(e)
    .filter(([k]) => k !== "source" && k !== "reason")
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
  return parts.length ? parts.join(" · ") : null;
}

export function AppraisalReviewModal({
  reviewId,
  onClose,
  onSaved,
}: {
  reviewId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const q = useResource(() => api.getReview(reviewId), [reviewId]);
  const [comment, setComment] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const r = q.data;

  // Only seed once the review has loaded, and never clobber what the manager
  // has since typed.
  React.useEffect(() => {
    if (r && comment === null) setComment(r.manager_comment || "");
  }, [r, comment]);

  async function narrate() {
    setBusy("narrate");
    setError(null);
    try {
      const row = await api.narrateReview(reviewId);
      // The narrative is a SUGGESTION. It lands in the draft box for the
      // manager to edit and is never shown to the employee as it stands —
      // which is why `ai_summary` and `manager_comment` are different columns.
      if (row.ai_summary) setComment((c) => (c && c.trim() ? c : row.ai_summary || ""));
      q.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("submit");
    setError(null);
    try {
      await api.submitReview(reviewId, comment || undefined);
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const locked = !!r && r.status !== "DRAFT";

  return (
    <Modal
      open
      onClose={onClose}
      title={r ? r.employee_name || "Review" : "Review"}
      description={r ? `${r.cycle_name || r.cycle_code} · ${dateFmt(r.starts_on)} – ${dateFmt(r.ends_on)}` : ""}
    >
      {q.error ? (
        <ErrorState message={q.error} />
      ) : !r ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={STATUS_TONE[r.status] || "mute"}>{r.status}</Pill>
            {r.overall_score != null && (
              <span className="text-sm text-muted-foreground">
                Overall <span className="num font-semibold text-foreground">{r.overall_score}</span>
                {r.band ? ` — ${r.band}` : ""}
              </span>
            )}
            {r.weights && !r.weights.balanced && (
              // Reported, not enforced: a target set being built is legitimately
              // unbalanced. It matters here because the roll-up renormalises,
              // and the manager should know the denominator is not 100.
              <span className="text-xs text-[rgb(var(--warn))]">
                Weights total {r.weights.total}%, not 100%
              </span>
            )}
          </div>

          {r.status === "DISPUTED" && (
            <Callout tone="bad" title="The employee disputes this review">
              {r.employee_comment}
            </Callout>
          )}
          {r.status === "ACKNOWLEDGED" && r.employee_comment && (
            <Callout tone="ok" title="The employee acknowledged it">
              {r.employee_comment}
            </Callout>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
            {/* THE LINES — evidence and judgement, never merged. */}
            <div className="lux-card overflow-hidden">
              <div className="max-h-[46vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-[rgb(var(--surface))]">
                    <tr className="border-b text-left">
                      <th className="px-3 py-2 font-semibold uppercase text-muted-foreground">Metric</th>
                      <th className="px-3 py-2 text-right font-semibold uppercase text-muted-foreground">Weight</th>
                      <th className="px-3 py-2 text-right font-semibold uppercase text-muted-foreground">Evidence</th>
                      <th className="px-3 py-2 text-right font-semibold uppercase text-muted-foreground">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(r.lines || []).map((l) => (
                      <tr key={l.appraisal_id} className="border-b last:border-0 align-top">
                        <td className="px-3 py-1.5">
                          <span className="font-medium text-foreground">{l.metric || "—"}</span>
                          {workingOf(l) && (
                            <span className="block text-[11px] text-muted-foreground">{workingOf(l)}</span>
                          )}
                        </td>
                        <td className="num px-3 py-1.5 text-right text-muted-foreground">
                          {l.weight != null ? `${l.weight}%` : "—"}
                        </td>
                        <td className="num px-3 py-1.5 text-right">
                          {num(l.ai_rating) !== null ? (
                            <span className="text-muted-foreground">{l.ai_rating}</span>
                          ) : (
                            // In words. A zero here would read as failure.
                            <span className="text-[11px] text-muted-foreground">{reasonOf(l)}</span>
                          )}
                        </td>
                        <td className="num px-3 py-1.5 text-right">
                          <span
                            className={cn(
                              num(l.rating) !== null ? "font-semibold text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {num(l.rating) !== null ? l.rating : "—"}
                          </span>
                          {l.is_calibrated && (
                            <span className="ml-1 text-[10px] text-muted-foreground" title="Set by a person — re-scoring will not overwrite it">
                              ✓
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!(r.lines || []).length && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                          No KPI targets for this employee in this cycle.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* THE NARRATIVE. */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="micro">Manager's comments</p>
                <Button size="sm" variant="outline" loading={busy === "narrate"} disabled={locked} onClick={narrate}>
                  Draft with AI
                </Button>
              </div>
              <label className="sr-only" htmlFor="review-comment">
                Manager&apos;s comments
              </label>
              <textarea
                id="review-comment"
                className="h-[38vh] w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed"
                value={comment ?? ""}
                disabled={locked}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What went well, what needs attention, and what to do next."
              />
              {r.ai_summary && (
                <p className="text-[11px] text-muted-foreground">
                  A draft narrative was written by {r.ai_model}. It is a suggestion —
                  the employee only ever sees what is in the box above.
                </p>
              )}
            </div>
          </div>

          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose} disabled={!!busy}>
              Close
            </Button>
            {!locked && (
              <Button loading={busy === "submit"} onClick={submit}>
                Submit review
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * The employee's half — read it, and answer.
 *
 * A dispute demands words. "I disagree" with no reason is not a record anybody
 * can act on later, and the entire reason for storing the employee's side is
 * that somebody who was not in the room can read it.
 */
export function MyReviewCard({ review, onSaved }: { review: api.AppraisalReview; onSaved: () => void }) {
  const [comment, setComment] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const answered = review.status !== "SUBMITTED";

  async function respond(agree: boolean) {
    setBusy(agree ? "agree" : "dispute");
    setError(null);
    try {
      await api.respondToReview(review.appraisal_review_id, agree, comment || undefined);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="lux-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {review.cycle_name || review.cycle_code}
          </span>
          <Pill tone={STATUS_TONE[review.status] || "mute"}>{review.status}</Pill>
        </div>
        {review.overall_score != null && (
          <span className="text-sm">
            <span className="num font-semibold text-foreground">{review.overall_score}</span>
            {review.band ? <span className="text-muted-foreground"> — {review.band}</span> : null}
          </span>
        )}
      </div>

      {review.manager_comment && (
        <p className="whitespace-pre-line text-sm text-muted-foreground">{review.manager_comment}</p>
      )}

      {answered ? (
        review.employee_comment ? (
          <p className="text-xs text-muted-foreground">
            You said: <span className="text-foreground">{review.employee_comment}</span>
          </p>
        ) : null
      ) : (
        <div className="flex flex-col gap-2 border-t pt-3">
          <label className="text-xs text-muted-foreground" htmlFor={`resp-${review.appraisal_review_id}`}>
            Your comments — required if you disagree.
          </label>
          <Input
            id={`resp-${review.appraisal_review_id}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything you want on the record"
          />
          {error && <ErrorState message={error} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" loading={busy === "dispute"} onClick={() => respond(false)}>
              I disagree
            </Button>
            <Button size="sm" loading={busy === "agree"} onClick={() => respond(true)}>
              I acknowledge this
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AppraisalReviewModal;
