/**
 * Chips — a wrapping row of filter tokens, one selected at a time.
 *
 * Relocated from `features/sales/ui.tsx` (audit A2): it was the only
 * implementation, but it lived in a feature folder and was imported by
 * Commercial, Vault and Settings, so three areas depended on Sales for a
 * filter control.
 *
 * Chips vs `<Segmented>`: chips wrap onto several lines and carry optional
 * counts, so they suit an open-ended filter set (statuses, categories, tags)
 * that may grow at runtime. Segmented is for a short, fixed, known set.
 * Visuals come from the `.chips` / `.chip` design-system classes in index.css
 * — do not restyle here.
 *
 * ACCESSIBILITY. Same WAI-ARIA radio group pattern as `<Segmented>`: one tab
 * stop, arrows between options. The original was a bare `<div>` of `<button>`s
 * with no selected state exposed to assistive tech at all — a screen-reader
 * user could not tell which filter was active.
 *
 * @example
 * const [status, setStatus] = React.useState("all");
 * <Chips
 *   label="Filter by status"
 *   value={status}
 *   onChange={setStatus}
 *   options={[
 *     { value: "all", label: "All", count: rows.length },
 *     { value: "open", label: "Open", count: open.length },
 *   ]}
 * />
 *
 * BEST PRACTICE. Always include an "All" option as the default — a filter row
 * with nothing selected leaves the user unable to get back to the full list.
 * Counts help people choose before they click; omit them rather than show a
 * stale or estimated number.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export type ChipOption = {
  value: string;
  label: string;
  /** Optional trailing count badge. */
  count?: number;
};

export function Chips({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: string;
  options: ChipOption[];
  onChange: (v: string) => void;
  /** Accessible name for the group. Not rendered visually. */
  label: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const n = options.length;
    const i = options.findIndex((o) => o.value === value);
    const next =
      e.key === "Home"
        ? options[0]
        : e.key === "End"
          ? options[n - 1]
          : options[(((i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1)) % n) + n) % n];
    if (!next || next.value === value) return;
    onChange(next.value);
    requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
    });
  }

  return (
    /*
     * The APG radiogroup pattern: the GROUP owns arrow-key handling, the
     * children own focus via a roving tabindex (`tabIndex={on ? 0 : -1}` below).
     * `interactive-supports-focus` wants the element with the key handler to be
     * focusable itself, which is right for a single control and wrong for a
     * composite widget — the rule cannot see the children's tabindex. Making
     * this div focusable would add a dead tab stop in front of the real one.
     */
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn("chips", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-value={o.value}
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn("chip", on && "on")}
          >
            {o.label}
            {o.count !== undefined && <span className="ct">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
