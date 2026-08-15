/**
 * Segmented — a small set of mutually exclusive choices shown side by side.
 *
 * Consolidates the FOUR independent implementations the audit found (F6 / A3):
 * `components/settings/controls.tsx:121` (exported, never imported),
 * `features/sales/ui.tsx:98`, `features/governance/pages.tsx:27` and
 * `features/security/pages.tsx:93` — the last of which carried the comment
 * *"Small local segmented control (sales/ui.tsx's is scoped to that feature)"*,
 * i.e. the duplication was known and accepted because there was no shared home
 * for it. This is that home.
 *
 * The four copies rendered two distinct looks, so both survive as variants
 * rather than being flattened into one and silently restyling four screens:
 *
 *   inset  (default) — recessed track, active segment lifts to `bg-card`.
 *                      Use inside a toolbar or card header. Was sales/ui +
 *                      settings/controls.
 *   solid            — active segment fills with the brand accent. Use as a
 *                      page-level view switcher where it is the primary
 *                      control. Was governance + security.
 *
 * ACCESSIBILITY. All four originals were a bare `<div>` of `<button>`s; only
 * one set `aria-pressed`, and none was arrow-key navigable. This implements the
 * WAI-ARIA radio group pattern: one tab stop for the whole control, arrows to
 * move between options (wrapping), Home/End for the ends. That is what a screen
 * reader announces as "Status, radio group, Open, 1 of 4" instead of four
 * unrelated buttons.
 *
 * @example
 * const [view, setView] = React.useState<"open" | "closed">("open");
 * <Segmented
 *   label="Ticket view"
 *   value={view}
 *   onChange={setView}
 *   options={[
 *     { value: "open", label: "Open" },
 *     { value: "closed", label: "Closed" },
 *   ]}
 * />
 *
 * BEST PRACTICE. Two to five options, short labels, and a value that is always
 * one of them — a segmented control has no empty state. Past five, or when the
 * labels wrap, use `<Chips>` (multi-line, filter-shaped) or a `<Select>`.
 * `label` is required and is not rendered: it names the group for assistive
 * tech, so write it as a noun ("Ticket view"), not an instruction.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Disables this one segment. Keyboard navigation skips it. */
  disabled?: boolean;
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  variant = "inset",
  className,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name for the group. Not rendered visually. */
  label: string;
  variant?: "inset" | "solid";
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  /** Move selection to the next enabled option, wrapping. */
  const step = React.useCallback(
    (from: number, delta: number) => {
      const n = options.length;
      for (let i = 1; i <= n; i++) {
        const next = options[(((from + delta * i) % n) + n) % n];
        if (next && !next.disabled) return next.value;
      }
      return undefined;
    },
    [options],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = [
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "Home",
      "End",
    ];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    let next: T | undefined;
    if (e.key === "Home") next = step(-1, 1);
    else if (e.key === "End") next = step(options.length, -1);
    else
      next = step(i, e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1);
    if (next === undefined || next === value) return;
    onChange(next);
    // Selection follows focus in a radio group, so the newly checked segment
    // must also take focus — otherwise the roving tabindex strands the user.
    requestAnimationFrame(() => {
      ref.current
        ?.querySelector<HTMLButtonElement>(
          `[data-value="${CSS.escape(next as string)}"]`,
        )
        ?.focus();
    });
  }

  return (
    // Composite radiogroup — see the note in ui/chips.tsx. Arrow keys on the
    // group, roving tabindex on the segments.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex flex-wrap",
        variant === "inset"
          ? "rounded-lg border bg-accent/40 p-0.5"
          : "gap-1 rounded-lg border bg-muted p-1",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-value={o.value}
            aria-checked={on}
            disabled={o.disabled}
            // Roving tabindex: only the checked segment is in the tab order.
            tabIndex={on ? 0 : -1}
            onClick={() => !o.disabled && onChange(o.value)}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-label font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              variant === "inset"
                ? on
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                : on
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
