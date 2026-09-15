import { cn } from "@/lib/cn";
import { BoltIcon, CheckIcon } from "@/components/ui/icons";

/**
 * The wizard's step indicator, and its back-navigation.
 *
 * Their site's step dots are the one idea worth keeping wholesale: a visitor
 * four steps into a quote wants to correct the port they typed on step two
 * without losing steps three and four, and a "back" button that only walks one
 * step at a time makes that a chore.
 *
 * ── WHY A COMPLETED STEP IS A BUTTON AND A FUTURE ONE IS NOT ──────────────
 *
 * Jumping FORWARD would skip the validation the intervening step exists to
 * apply, so a future step is rendered as plain text with `aria-disabled` rather
 * than as a control that refuses when pressed. A control that does nothing is
 * worse than no control: the visitor presses it twice and concludes the page is
 * broken.
 *
 * `aria-current="step"` marks where they are — the one attribute a screen
 * reader uses to answer "where am I in this form", and the reason the dots are
 * a `<nav>` and not a decorative row of spans.
 */
export type Step = { key: string; label: string };

export function Stepper({
  steps,
  current,
  furthest,
  onGoTo,
  label,
  counter,
  className,
}: {
  steps: Step[];
  /** Index of the step being shown. */
  current: number;
  /** The furthest step reached — everything up to here is navigable. */
  furthest: number;
  onGoTo: (index: number) => void;
  label: string;
  /** "Step 2 of 4", already composed by the caller so the count is translated. */
  counter?: string;
  className?: string;
}) {
  const percent = Math.round(((current + 1) / steps.length) * 100);
  return (
    <nav aria-label={label} className={cn("stepper min-w-0", className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* NOWRAP. Wrapping put step 4 on a line of its own inside the quote
            card, which turns a progress strip into two rows of unequal weight
            and pushes the question below the fold. The strip shrinks instead:
            connectors narrow, labels truncate, and below `lg` only the step you
            are ON keeps its label — the others are already numbers, and the
            heading underneath says where you are. */}
        <ol className="flex min-w-0 flex-nowrap items-center gap-x-0.5">
        {steps.map((step, i) => {
          const done = i < current;
          const here = i === current;
          const reachable = i <= furthest && !here;
          const Tag = reachable ? "button" : "span";
          return (
            <li key={step.key} className="flex min-w-0 items-center">
              <Tag
                {...(reachable
                  ? { type: "button" as const, onClick: () => onGoTo(i) }
                  : { "aria-disabled": !here || undefined })}
                aria-current={here ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-full px-2 py-1.5 text-sm transition-colors",
                  reachable && "hover:bg-[rgb(var(--ink)/0.06)]",
                  here ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                    /* §8.3's "real progress depth". Colour alone stated where
                       you were; these give the strip the same three-elevation
                       encoding the track timeline uses — the step you are on is
                       lifted, the ones behind rest, the ones ahead are flush —
                       so both places in this app that answer "how far through
                       am I" read the same way, and both survive greyscale. */
                    done && "stepper-dot-done",
                    here && "stepper-dot-here",
                    done && "border-[rgb(var(--brand-orange))] bg-[rgb(var(--brand-orange))] text-[var(--primary-foreground)]",
                    /* The NUMBER is 11px type, so it is held to 4.5:1 and the
                       fill measured 3.13:1 on `--background` — a real AA
                       failure on the step a visitor is actually looking at.
                       `--primary-ink` is 4.88:1 light / 5.79:1 dark and is the
                       same brand colour. The BORDER keeps the fill: a
                       non-text affordance is held to 3:1 (WCAG 1.4.11), which
                       3.13:1 clears, and the ring is what carries "you are
                       here" at a glance. */
                    here && "border-[rgb(var(--brand-orange))] text-[var(--primary-ink)]",
                    !done && !here && "border-border",
                  )}
                >
                  {done ? <CheckIcon size={12} /> : <span className="num">{i + 1}</span>}
                </span>
                {/* Shown or hidden by the strip's OWN width — see `.stepper`
                    in index.css. No `truncate`: a label clipped to "Cargo
                    deta…" has stopped being a label, and the viewport
                    breakpoint this replaced could not see that the strip was
                    inside an 800px card. */}
                <span className={here ? "stepper-label-here" : "stepper-label"}>
                  {step.label}
                </span>
              </Tag>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-0.5 h-px w-2.5 shrink-0 sm:w-4 lg:w-6",
                    done ? "bg-[rgb(var(--brand-orange))]" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>

        {/* The counter their portal carries and ours did not: on a form with
            four screens, "how much is left" is the question a visitor asks
            before deciding to start, and a row of dots answers it only if you
            count them. Hidden below md, where the dots are already numbers and
            the line below says which step this is. */}
        {counter && (
          <p className="hidden shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium text-muted-foreground md:inline-flex">
            {/* The glyph sits INSIDE a text run (gap-2, beside the counter),
                so it reads as type and takes the ink token rather than the
                fill — 4.91:1 instead of 3.13:1, and the same brand hue. The
                standalone milestone marker in `shipment-state.tsx` keeps the
                fill because it is a circular affordance, not text, and WCAG
                1.4.11 holds that to 3:1. */}
            <BoltIcon size={14} className="text-[var(--primary-ink)]" />
            {counter}
          </p>
        )}
      </div>

      {/*
        The progress bar. Not decoration and not a duplicate of the dots: the
        dots say WHICH step, the bar says HOW FAR, and on a phone — where the
        labels are hidden and the dots are four small numbers — it is the only
        thing that answers the second question at a glance.

        `aria-hidden`, because the counter above and `aria-current` on the dots
        already state the same fact to a screen reader; a third announcement of
        it is noise.
      */}
      <div
        aria-hidden
        className="mt-4 h-1 overflow-hidden rounded-full bg-[rgb(var(--ink)/0.08)]"
      >
        <div
          className="h-full rounded-full bg-[rgb(var(--brand-orange))] transition-[width] duration-500 ease-[var(--ease)]"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* The label the dots cannot carry on a phone, where they are numbers
          only. Announced politely so it is not read over the step's heading. */}
      <p className="mt-3 text-sm text-muted-foreground sm:hidden" aria-live="polite">
        {steps[current]?.label}
      </p>
    </nav>
  );
}
