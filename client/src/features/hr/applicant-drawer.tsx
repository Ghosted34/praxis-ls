/**
 * The applicant panel — everything known about one candidate, in one place.
 *
 * ── THE ONE RULE THIS SCREEN EXISTS TO ENFORCE ─────────────────────────────
 *
 * A score is never shown without saying what KIND of score it is.
 *
 * `ai_score` holds two different things. When `ai_provisional` is true it is
 * arithmetic over the fields the candidate typed about themselves — it has not
 * opened their CV. When false, a model has read the résumé against the job
 * description and the recruiter's criteria. Both render as a percentage, and a
 * percentage is the most persuasive thing you can put in front of a person
 * making a decision quickly.
 *
 * So the provisional state is not a subtitle here, it is the loudest element in
 * the block: a banner above the number, a muted rather than confident treatment
 * of the figure itself, and a Score button that is the panel's primary action
 * until it has been pressed. The failure being designed against is a recruiter
 * rejecting somebody on the strength of "97% match" that never looked at them.
 *
 * ── AND THE SECOND RULE ────────────────────────────────────────────────────
 *
 * The AI's number and the interviewer's stars sit side by side and are NEVER
 * added together. They are evidence of different kinds and the whole value of
 * the scorecard is that they can disagree; averaging them would destroy exactly
 * the signal a hiring manager needs. The layout says so by keeping them in
 * separate blocks with separate headings.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

const DIMENSION_LABEL: Record<string, string> = {
  skills: "Skills",
  experience: "Experience",
  salary_fit: "Salary fit",
  portfolio: "Portfolio",
};

/** A score bar. `null` renders as "not assessed" rather than an empty bar —
 *  a 0%-wide bar and "we could not tell" look identical and mean opposite
 *  things. */
function ScoreBar({
  label,
  value,
  note,
}: {
  label: string;
  value: number | null | undefined;
  note?: string | null;
}) {
  const has = typeof value === "number";
  return (
    <div className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2">
      <span className="truncate text-sm text-muted-foreground">{label}</span>
      <span
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          has ? `${label}: ${value} out of 100` : `${label}: not assessed`
        }
      >
        {has && (
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          />
        )}
      </span>
      <span
        className={cn(
          "num text-right text-sm",
          has ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {has ? value : "—"}
      </span>
      {note && (
        <p className="col-span-3 -mt-1 micro normal-case text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * Half-star rating, 0–5.
 *
 * A row of radio inputs rather than clickable spans: this is a single choice
 * from a set, which is what radios ARE, so keyboard support, focus and the
 * screen-reader announcement come from the platform instead of from handlers
 * somebody has to remember to write. The stars are the visual layer over them.
 */
function Stars({
  value,
  onChange,
  name,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  name: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1"
      role="radiogroup"
      aria-label="Rating out of 5"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const on = typeof value === "number" && value >= n;
        return (
          <label
            key={n}
            className={cn(
              "cursor-pointer",
              disabled && "cursor-not-allowed opacity-60",
            )}
            title={`${n} of 5`}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === n}
              disabled={disabled}
              // Keyboard selection. React does NOT fire `change` on a radio that
              // is already checked, which is why the clear-on-repeat-click below
              // is an `onClick` and not part of this handler — written as one,
              // the star you tapped by mistake could never be un-tapped.
              onChange={() => onChange(n)}
              // Clicking the star already selected CLEARS it. An interviewer who
              // mis-clicked otherwise has no way back to "not yet rated", and
              // would have to leave a wrong rating inside an average that a
              // hiring decision is later defended with.
              onClick={() => {
                if (value === n) onChange(null);
              }}
            />
            {/* The radio's accessible name. Without it this control was five
                unlabelled radios: the input is `sr-only`, the star is
                `aria-hidden` because it is decoration, and the `title` above
                sits on the LABEL, which does not name the input it wraps. A
                sighted user sees a row of stars; everyone else heard nothing. */}
            <span className="sr-only">{n === 1 ? "1 star" : `${n} stars`}</span>
            <svg
              viewBox="0 0 24 24"
              width={18}
              height={18}
              aria-hidden
              className={cn(
                "transition-colors",
                on ? "text-[rgb(var(--warn))]" : "text-muted-foreground/40",
              )}
              fill={on ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinejoin="round"
            >
              <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z" />
            </svg>
          </label>
        );
      })}
      <span className="ml-1 num text-sm text-muted-foreground">
        {typeof value === "number" ? `${value}/5` : "—"}
      </span>
    </div>
  );
}

/* ── The AI assessment block ─────────────────────────────────────────────── */

function Assessment({
  applicant,
  onScored,
}: {
  applicant: api.Applicant;
  onScored: (next: api.Applicant) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const b = applicant.ai_breakdown || {};
  const provisional = applicant.ai_provisional !== false;
  const scored = typeof applicant.ai_score === "number";

  async function run() {
    setBusy(true);
    setError(null);
    try {
      onScored(
        await api.scoreApplicant(applicant.vacancy_id, applicant.applicant_id),
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            AI assessment{" "}
            <span className="font-normal text-muted-foreground">
              {provisional
                ? "(provisional · heuristic)"
                : `(full CV read${applicant.ai_model ? ` · ${applicant.ai_model}` : ""})`}
            </span>
          </h3>
          {applicant.ai_scored_at && !provisional && (
            <p className="micro normal-case text-muted-foreground">
              Assessed {dateFmt(applicant.ai_scored_at)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-baseline gap-1">
          {/* Muted while provisional. The figure is the most persuasive thing on
              the panel and it has not read the CV yet — it should not look as
              settled as one that has. */}
          <span
            className={cn(
              "num text-2xl font-semibold",
              provisional ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {scored ? applicant.ai_score : "—"}
          </span>
          <span className="micro">match</span>
        </div>
      </div>

      {provisional && (
        <div className="mt-3">
          <Callout tone="warn" title="This score has not read the CV">
            It is an estimate from the skills, experience and salary the
            candidate typed in. Run the full assessment before it is used to
            decide anything.
          </Callout>
        </div>
      )}
      {!provisional && b.cv_read === false && (
        <div className="mt-3">
          <Callout tone="warn" title="Scored without the CV">
            The uploaded file could not be read, so this assessment is based on
            the application form alone.
          </Callout>
        </div>
      )}

      {applicant.ai_summary && (
        <p className="mt-3 text-sm text-muted-foreground">
          {applicant.ai_summary}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {(["skills", "experience", "salary_fit", "portfolio"] as const).map(
          (k) => (
            <ScoreBar key={k} label={DIMENSION_LABEL[k]} value={b[k]} />
          ),
        )}
        {(b.criteria || []).length > 0 && (
          <>
            <p className="pt-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              Your criteria
            </p>
            {(b.criteria || []).map((c) => (
              <ScoreBar
                key={c.label}
                label={c.label}
                value={c.score}
                note={c.note}
              />
            ))}
          </>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      )}

      <div className="mt-4">
        <Button
          size="sm"
          loading={busy}
          onClick={run}
          variant={provisional ? "default" : "outline"}
        >
          {provisional ? "Score with AI" : "Re-score"}
        </Button>
        <p className="mt-1 micro normal-case text-muted-foreground">
          Opens the CV and scores it against the job description and your
          criteria. Takes a few seconds.
        </p>
      </div>
    </section>
  );
}

/* ── The interview scorecard ─────────────────────────────────────────────── */

function Scorecard({
  applicant,
  onRated,
}: {
  applicant: api.Applicant;
  onRated: (overall: number | null) => void;
}) {
  const vacancyId = applicant.vacancy_id;
  const questions = useResource(
    () => api.listQuestions(vacancyId),
    [vacancyId],
  );
  const answers = useResource(
    () => api.listAnswers(vacancyId, applicant.applicant_id),
    [vacancyId, applicant.applicant_id],
  );
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Optimistic, keyed by question. A star that waits for a round trip before it
  // fills makes an interviewer think the click missed, and they click again.
  const [local, setLocal] = React.useState<Record<string, number | null>>({});

  const byQuestion = React.useMemo(() => {
    const m: Record<string, number | null> = {};
    (answers.data || []).forEach((a) => {
      m[a.vacancy_question_id] = a.rating == null ? null : Number(a.rating);
    });
    return m;
  }, [answers.data]);

  async function rate(questionId: string, rating: number | null) {
    setLocal((s) => ({ ...s, [questionId]: rating }));
    setError(null);
    try {
      const res = await api.rateAnswer(vacancyId, applicant.applicant_id, {
        vacancy_question_id: questionId,
        rating,
      });
      onRated(res.overall_rating ?? null);
    } catch (e) {
      // Put the star back where it was — an optimistic update that silently
      // stays put after a failed save is a rating nobody recorded.
      setLocal((s) => ({ ...s, [questionId]: byQuestion[questionId] ?? null }));
      setError(errMsg(e));
    }
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      await api.generateQuestions(vacancyId);
      questions.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setGenerating(false);
    }
  }

  const rows = questions.data || [];

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Interview scorecard
          </h3>
          <p className="micro normal-case text-muted-foreground">
            The same questions for every candidate for this role — which is what
            makes their scores comparable. Your overall rating is the average of
            these.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          loading={generating}
          onClick={generate}
        >
          {rows.length ? "Redraft with AI" : "Draft with AI"}
        </Button>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      )}

      {questions.loading ? (
        <div className="mt-3">
          <LoadingRow />
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No questions yet. Draft a set with AI, then edit it — every candidate
          for this role gets the same list.
        </p>
      ) : (
        <ol className="mt-3 space-y-4">
          {rows.map((q, i) => {
            const val =
              q.vacancy_question_id in local
                ? local[q.vacancy_question_id]
                : (byQuestion[q.vacancy_question_id] ?? null);
            return (
              <li
                key={q.vacancy_question_id}
                className="border-t pt-3 first:border-0 first:pt-0"
              >
                <div className="flex gap-2">
                  <span className="num shrink-0 text-sm text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{q.question}</p>
                    {/* Interviewer's eyes only — never shown to the candidate,
                        and never sent to the public careers surface. */}
                    {q.rationale && (
                      <p className="mt-1 micro normal-case text-muted-foreground">
                        {q.rationale}
                      </p>
                    )}
                    <div className="mt-2">
                      <Stars
                        name={`q-${q.vacancy_question_id}`}
                        value={val}
                        onChange={(v) => void rate(q.vacancy_question_id, v)}
                        disabled={answers.loading}
                      />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ── The panel ───────────────────────────────────────────────────────────── */

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "mute"> = {
  APPLIED: "mute",
  SHORTLISTED: "warn",
  INTERVIEWED: "warn",
  HIRED: "ok",
  REJECTED: "bad",
  TALENT_POOL: "mute",
};

export function ApplicantDrawer({
  applicant: initial,
  onClose,
  onChanged,
}: {
  applicant: api.Applicant;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [applicant, setApplicant] = React.useState(initial);
  React.useEffect(() => setApplicant(initial), [initial]);

  const merge = (patch: Partial<api.Applicant>) =>
    setApplicant((a) => ({ ...a, ...patch }));

  const facts = [
    applicant.email,
    applicant.phone,
    applicant.experience_years != null
      ? `${applicant.experience_years} yrs experience`
      : null,
    applicant.expected_salary != null
      ? `expects ${applicant.expected_salary}`
      : null,
    applicant.source ? `via ${applicant.source}` : null,
  ].filter(Boolean);

  return (
    <Modal
      open
      onClose={onClose}
      title={applicant.full_name}
      description="Assessment, scorecard and application details."
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {facts.join(" · ") || "No contact details"}
            </p>
            {applicant.address && (
              <p className="micro normal-case text-muted-foreground">
                {applicant.address}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Pill tone={STATUS_TONE[applicant.status] || "mute"}>
                {applicant.status.replace("_", " ").toLowerCase()}
              </Pill>
              {applicant.applied_at && (
                <span className="micro">
                  applied {dateFmt(applicant.applied_at)}
                </span>
              )}
            </div>
          </div>
          {/* Separate from the AI number and never combined with it. */}
          <div className="text-right">
            <p className="micro">Your rating</p>
            <p className="num text-lg font-semibold text-foreground">
              {applicant.rating != null
                ? `${Number(applicant.rating).toFixed(1)}/5`
                : "—"}
            </p>
          </div>
        </header>

        {(applicant.skills || []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(applicant.skills || []).map((s) => (
              <Pill key={s} tone="mute">
                {s}
              </Pill>
            ))}
          </div>
        )}

        {applicant.cover_note && (
          <section className="rounded-xl border bg-card p-4">
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              Covering note
            </h3>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {applicant.cover_note}
            </p>
          </section>
        )}

        <Assessment
          applicant={applicant}
          onScored={(next) => {
            merge(next);
            onChanged();
          }}
        />
        <Scorecard
          applicant={applicant}
          onRated={(overall) => {
            merge({ rating: overall });
            onChanged();
          }}
        />
      </div>

      <div className="flex justify-end pt-3">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

/* ── Custom scoring criteria (vacancy-level) ─────────────────────────────── */

export function CriteriaEditor({ vacancyId }: { vacancyId: string }) {
  const criteria = useResource(() => api.listCriteria(vacancyId), [vacancyId]);
  const [f, setF] = React.useState({ label: "", guidance: "", weight: "1" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addCriterion(vacancyId, {
        label: f.label.trim(),
        guidance: f.guidance.trim() || undefined,
        weight: Number(f.weight) || 1,
      });
      setF({ label: "", guidance: "", weight: "1" });
      criteria.reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.removeCriterion(vacancyId, id);
      criteria.reload();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const rows = criteria.data || [];

  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">
        Extra scoring criteria
      </h3>
      <p className="micro normal-case text-muted-foreground">
        What else should the AI weigh, beyond the job description? Weights are
        relative — a 3 counts three times a 1. Applies to every candidate for
        this role from the next assessment onwards.
      </p>

      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-lg border">
          {rows.map((c) => (
            <li
              key={c.vacancy_criterion_id}
              className="flex items-start gap-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm text-foreground">{c.label}</span>
                {c.guidance && (
                  <span className="block micro normal-case text-muted-foreground">
                    {c.guidance}
                  </span>
                )}
              </div>
              <Pill tone="mute">×{Number(c.weight)}</Pill>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove(c.vacancy_criterion_id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form className="mt-3 space-y-3" onSubmit={add}>
        <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
          <Field label="Criterion">
            <Input
              value={f.label}
              onChange={(e) => setF((s) => ({ ...s, label: e.target.value }))}
              placeholder="Customs clearance at a sea port"
            />
          </Field>
          <Field label="Weight">
            <Input
              className="num"
              type="number"
              min="0.5"
              max="10"
              step="0.5"
              value={f.weight}
              onChange={(e) => setF((s) => ({ ...s, weight: e.target.value }))}
            />
          </Field>
        </div>
        <Field
          label="Guidance"
          hint="Optional — told to the AI, not the candidate."
        >
          <Input
            value={f.guidance}
            onChange={(e) => setF((s) => ({ ...s, guidance: e.target.value }))}
            placeholder="Count only hands-on clearance, not supervision"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <Button
          type="submit"
          size="sm"
          loading={busy}
          disabled={!f.label.trim() || busy}
        >
          Add criterion
        </Button>
      </form>
    </section>
  );
}
