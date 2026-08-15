/**
 * New vacancy — the drafting interview (0526).
 *
 * ── WHY THIS IS NOT A FORM ─────────────────────────────────────────────────
 *
 * The old "New vacancy" modal asked for a title, a department and a description
 * box, which asks a recruiter to be a copywriter and gets a job advert that
 * reads like a database row. This asks questions instead — one at a time, in
 * their own words, typed or spoken — and the model writes the advert from the
 * answers. See `src/modules/hr/vacancy/vacancy.draft.js` for the other half.
 *
 * ── ONE QUESTION PER CARD ──────────────────────────────────────────────────
 *
 * Ten questions on one screen is the form again, and a form is skimmed: people
 * answer "requirements" with three words because eight other fields are
 * visible. One card at a time, with the hint under the question, is what gets a
 * spoken paragraph instead — and a spoken paragraph is what the model needs.
 *
 * The count is honest about what is coming: the server says how many questions
 * there are in total (eight fixed plus the follow-ups it intends to generate),
 * so the bar is sized for ten from the first card rather than reaching the end
 * and then growing. If the model returns fewer follow-ups — or none, when it is
 * unreachable — the total shrinks and the interview simply ends sooner.
 *
 * ── NOTHING HERE IS MANDATORY EXCEPT THE ROLE ──────────────────────────────
 *
 * Only the title blocks. Every other question can be skipped, because a
 * recruiter who does not yet know the salary band or the exact office should
 * still reach a draft — the model proposes what it was not told, and the editor
 * is where it gets corrected. A wizard that will not let you past question five
 * is one people route around by inventing an answer, which is worse than a gap.
 *
 * ── AND THE ESCAPE HATCH IS ALWAYS THERE ───────────────────────────────────
 *
 * "Skip the questions — start from a blank form" is on every card. Somebody
 * re-posting a role they have posted twice already does not want an interview,
 * and hiding the old form behind the new one would make this feel like a tax.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { VoiceInput } from "@/components/voice-input";
import { useResource, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/hr-api";

/** Where a `salary` question's two bounds land in the answers. The drafting
 *  service reads these keys by name, so they are a contract, not a convention. */
const salaryKeys = (key: string) => [`${key}_min`, `${key}_max`] as const;

export function VacancyWizard({
  onClose,
  onDrafted,
  onBlankForm,
}: {
  onClose: () => void;
  /** The saved DRAFT vacancy — the caller opens the editor on it. */
  onDrafted: (v: api.Vacancy) => void;
  /** "Start from a blank form" — hands back to the plain create modal. */
  onBlankForm: () => void;
}) {
  const start = useResource(() => api.intakeQuestions(), []);
  const [answers, setAnswers] = React.useState<api.IntakeAnswers>({});
  /** The generated questions. `null` until we have asked for them. */
  const [followUps, setFollowUps] = React.useState<api.IntakeQuestion[] | null>(
    null,
  );
  const [i, setI] = React.useState(0);
  const [thinking, setThinking] = React.useState(false);
  const [drafting, setDrafting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const base = React.useMemo(
    () => start.data?.questions || [],
    [start.data?.questions],
  );
  const questions = React.useMemo(
    () => [...base, ...(followUps || [])],
    [base, followUps],
  );
  const currency = start.data?.currency || "";
  const entity = start.data?.entity || null;

  // Until the model has told us how many follow-ups it wants, trust the total
  // the server declared — so the bar is sized for the whole interview from the
  // first card and only ever moves forwards.
  const total = followUps
    ? questions.length
    : Math.max(start.data?.total || base.length, base.length);
  const q = questions[i];
  const onLastFixed = base.length > 0 && i === base.length - 1;
  const isLast = questions.length > 0 && i === questions.length - 1;
  /** The interview is over when the follow-ups are known and we are past them. */
  const atEnd = followUps !== null && isLast;

  const set = (key: string, v: string | number | null) =>
    setAnswers((s) => ({ ...s, [key]: v }));

  const answered = React.useMemo(() => {
    if (!q) return false;
    if (q.type === "salary") {
      const [lo, hi] = salaryKeys(q.key);
      return answers[lo] != null || answers[hi] != null;
    }
    const v = answers[q.key];
    return typeof v === "number" ? true : Boolean(String(v ?? "").trim());
  }, [q, answers]);

  // Only the role title blocks — see the header.
  const blocked = q?.key === "title" && !answered;

  async function next() {
    setError(null);
    // Leaving the last fixed question is where the generated ones are fetched:
    // they are generated FROM these answers, which is what makes them specific
    // to the role rather than a second page of the same form.
    if (onLastFixed && followUps === null) {
      setThinking(true);
      try {
        const { questions: extra } = await api.intakeFollowUps({
          entity_id: entity?.entity_id ?? null,
          answers,
        });
        setFollowUps(extra || []);
        // No follow-ups (or none reachable) — this card becomes the last one
        // and the draft button appears in place of Next.
        if (extra?.length) setI(base.length);
      } catch {
        // A failed generation is a shorter interview, not a broken one: the
        // fixed answers are enough to draft from.
        setFollowUps([]);
      } finally {
        setThinking(false);
      }
      return;
    }
    if (!isLast) setI((n) => n + 1);
  }

  async function draft() {
    setDrafting(true);
    setError(null);
    try {
      onDrafted(
        await api.draftVacancy({
          entity_id: entity?.entity_id ?? null,
          answers,
        }),
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setDrafting(false);
    }
  }

  /** Answers are only in the browser until the draft is saved, so leaving
   *  mid-interview throws them away and should say so. */
  function close() {
    if (
      Object.keys(answers).length &&
      !drafting &&
      !window.confirm(
        "Leave the interview?\n\nYour answers haven't been saved yet — you'd start again from the first question.",
      )
    )
      return;
    onClose();
  }

  const busy = thinking || drafting;

  return (
    <Modal
      open
      onClose={close}
      title="New vacancy"
      description="Answer a few questions — type or speak them — and AI writes the advert."
      size="lg"
    >
      {start.error ? (
        <ErrorState
          message={start.error}
          action={
            <Button size="sm" variant="outline" onClick={start.reload}>
              Try again
            </Button>
          }
        />
      ) : start.loading ? (
        <LoadingRow />
      ) : !q ? (
        // No question set came back. The interview cannot run, but creating a
        // vacancy still can — so this offers the form rather than a spinner
        // that never resolves.
        <ErrorState
          message="The interview questions couldn't be loaded."
          action={
            <Button size="sm" variant="outline" onClick={onBlankForm}>
              Start from a blank form
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between micro">
              <span>
                Question {Math.min(i + 1, total)} of {total}
              </span>
              {entity?.name && <span className="truncate">Hiring for {entity.name}</span>}
            </div>
            <div
              role="progressbar"
              aria-valuenow={Math.min(i + 1, total)}
              aria-valuemin={1}
              aria-valuemax={total}
              aria-label="Interview progress"
              className="h-1 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${Math.round((Math.min(i + 1, total) / total) * 100)}%` }}
              />
            </div>
          </div>

          {/* The question is the heading of this card, not a field label — the
              label lives on the control below so the association is real. */}
          <div>
            <h3 className="text-base font-semibold text-foreground">{q.question}</h3>
            {q.hint && <p className="mt-1 text-sm text-muted-foreground">{q.hint}</p>}
          </div>

          <QuestionControl
            key={q.key}
            question={q}
            answers={answers}
            currency={currency}
            disabled={busy}
            onSet={set}
            onEnter={() => {
              if (!blocked && !busy && !atEnd) void next();
            }}
          />

          {error && <ErrorState message={error} />}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              // Stepping back while the follow-ups are in flight would be undone
              // the moment they arrive and move the cursor forward.
              disabled={i === 0 || busy}
              onClick={() => setI((n) => Math.max(0, n - 1))}
            >
              Back
            </Button>
            {atEnd ? (
              <Button loading={drafting} disabled={busy} onClick={() => void draft()}>
                Draft the whole vacancy with AI
              </Button>
            ) : (
              <Button
                variant={answered ? "default" : "outline"}
                loading={thinking}
                disabled={blocked || busy}
                onClick={() => void next()}
              >
                {thinking ? "Reading your answers…" : answered ? "Next" : "Skip"}
              </Button>
            )}
          </div>

          {drafting && (
            <p className="micro text-center">
              Writing the advert, working out the department, the employment type and a
              salary band. It saves as a draft — nothing is published.
            </p>
          )}

          <div className="border-t pt-3 text-center">
            <button
              type="button"
              disabled={busy}
              onClick={onBlankForm}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Skip the questions — start from a blank form
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The control for one question. `type` comes from the server, so a question
 *  set that grows a new kind of answer renders as a text box rather than as
 *  nothing at all. */
function QuestionControl({
  question: q,
  answers,
  currency,
  disabled,
  onSet,
  onEnter,
}: {
  question: api.IntakeQuestion;
  answers: api.IntakeAnswers;
  currency: string;
  disabled?: boolean;
  onSet: (key: string, v: string | number | null) => void;
  onEnter: () => void;
}) {
  // Focus follows the card. This component is keyed by the question, so it
  // remounts on every step and the effect runs once per question — which is the
  // whole point: in a one-question-at-a-time interview, landing the cursor in
  // the answer box is what makes it typeable without reaching for the mouse.
  // (`autoFocus` is banned repo-wide, and rightly: this is deliberate focus
  // management inside a dialog, not a page that grabs the caret on load.)
  const inputRef = React.useRef<HTMLInputElement>(null);
  const areaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    (inputRef.current || areaRef.current)?.focus();
  }, []);

  // The voice question's control is a textarea SIDE BY SIDE with the mic, so
  // `Field` has two children and cannot clone an id onto the one that matters.
  // The textarea owns its id and the label is pointed at it explicitly (the
  // documented escape hatch) — otherwise the only labelled thing in the group
  // would be the div.
  const textareaId = React.useId();
  const str = (key: string) => String(answers[key] ?? "");
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter();
    }
  };

  if (q.type === "salary") {
    const [lo, hi] = salaryKeys(q.key);
    const money = (key: string, label: string) => (
      <Field label={`${label}${currency ? ` (${currency}/month)` : ""}`}>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          ref={key.endsWith("_min") ? inputRef : undefined}
          disabled={disabled}
          value={str(key)}
          onKeyDown={enter}
          onChange={(e) =>
            onSet(key, e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </Field>
    );
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {money(lo, "From")}
        {money(hi, "To")}
      </div>
    );
  }

  if (q.type === "number") {
    return (
      <Field label="Your answer">
        <Input
          type="number"
          min={q.min ?? 1}
          max={q.max ?? undefined}
          inputMode="numeric"
          ref={inputRef}
          disabled={disabled}
          value={str(q.key)}
          onKeyDown={enter}
          onChange={(e) =>
            onSet(q.key, e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </Field>
    );
  }

  if (q.type === "text") {
    return (
      <Field label="Your answer">
        <Input
          ref={inputRef}
          disabled={disabled}
          value={str(q.key)}
          onKeyDown={enter}
          onChange={(e) => onSet(q.key, e.target.value)}
        />
      </Field>
    );
  }

  // textarea, and anything the server adds later.
  //
  // The label is written out rather than delegated to `Field`, which is the one
  // place in this file that departs from the house rule. `Field` names its
  // child by cloning an id onto it, and this control is a textarea with a mic
  // BESIDE it — so the id lands on the flex wrapper, the label points at a div,
  // and the box a person types in ends up unnamed. Labelling the textarea
  // directly is the same association `Field` would have made, made by hand.
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={textareaId}
        className="block text-sm font-medium text-foreground"
      >
        Your answer
      </label>
      <div className="flex items-start gap-2">
        <Textarea
          id={textareaId}
          aria-describedby={`${textareaId}-hint`}
          className="flex-1"
          rows={5}
          ref={areaRef}
          disabled={disabled}
          value={str(q.key)}
          onChange={(e) => onSet(q.key, e.target.value)}
        />
        {/* Appends, never replaces — half-typed answers survive a recording. */}
        <VoiceInput
          disabled={disabled}
          label="Speak your answer"
          onText={(text) => {
            const had = str(q.key).trim();
            onSet(q.key, had ? `${had} ${text}` : text);
          }}
        />
      </div>
      <p id={`${textareaId}-hint`} className="text-xs text-muted-foreground">
        Type it, or hold the mic and say it.
      </p>
    </div>
  );
}

export default VacancyWizard;
