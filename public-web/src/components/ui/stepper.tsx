import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/ui/icons";

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
  className,
}: {
  steps: Step[];
  /** Index of the step being shown. */
  current: number;
  /** The furthest step reached — everything up to here is navigable. */
  furthest: number;
  onGoTo: (index: number) => void;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
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
                  "flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm transition-colors",
                  reachable && "hover:bg-[rgb(var(--ink)/0.06)]",
                  here ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                    done && "border-[var(--brand-orange)] bg-[var(--brand-orange)] text-[var(--primary-foreground)]",
                    here && "border-[var(--brand-orange)] text-[var(--brand-orange)]",
                    !done && !here && "border-border",
                  )}
                >
                  {done ? <CheckIcon size={12} /> : <span className="num">{i + 1}</span>}
                </span>
                <span className="hidden truncate sm:inline">{step.label}</span>
              </Tag>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-1 h-px w-4 shrink-0 sm:w-6",
                    done ? "bg-[var(--brand-orange)]" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
      {/* The label the dots cannot carry on a phone, where they are numbers
          only. Announced politely so it is not read over the step's heading. */}
      <p className="mt-2 text-sm text-muted-foreground sm:hidden" aria-live="polite">
        {steps[current]?.label}
      </p>
    </nav>
  );
}
