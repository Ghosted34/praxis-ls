import * as React from "react";
import { cn } from "@/lib/cn";
import { IconTile, type IconComponent } from "./icon-tile";

/**
 * One choice among several, rendered as a card (doc/UI_UPGRADE_PLAN.md §6.2).
 *
 * ── A RADIO GROUP, NOT TOGGLE BUTTONS ─────────────────────────────────────
 *
 * This is a single choice among several, which is what a radio group IS, and
 * the semantics are not a formality: a group gives arrow-key navigation, one
 * tab stop instead of four, and a screen reader that announces "2 of 4" rather
 * than four unrelated pressed/unpressed buttons. Our first version used
 * `aria-pressed` buttons; their markup gets this right, and it was the thing
 * worth copying.
 *
 * The visible card is a SIBLING of a visually-hidden input, so the focus ring is
 * drawn on the card via `peer-focus-visible` while the real control keeps every
 * keyboard behaviour the platform gives it for free.
 *
 * ── THE SELECTED STATE CHANGES THREE THINGS AT ONCE ───────────────────────
 *
 * Border colour, background tint, and the icon tile filling. A selected state
 * carried by border colour alone is invisible on a phone in sunlight and
 * invisible to anyone who does not see that hue — that was the defect in the
 * first shipped version of the quote wizard. The ring itself is `--pick-ring`
 * (§5), so a tenant re-tints the selection in one place rather than in every
 * card that ever draws one.
 *
 * ── THE DESCRIPTION IS REQUIRED, NOT OPTIONAL ─────────────────────────────
 *
 * A prospect who does not know whether "By road or rail" covers a Douala →
 * N'Djamena run picks nothing, and picking nothing is where a form loses them.
 * It is a required prop for that reason: making it optional means the next
 * caller omits it, and the card goes back to being a labelled square.
 */
export function SelectCard({
  name,
  value,
  checked,
  onChange,
  icon,
  title,
  description,
  className,
}: {
  /** The group. Every card in one choice shares it — that is what makes the
   *  browser treat them as one control with one tab stop. */
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  icon?: IconComponent;
  title: React.ReactNode;
  description: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("group relative block cursor-pointer", className)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex h-full flex-col rounded-[var(--radius)] border p-4 transition-all duration-200",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--brand-orange)]",
          checked
            ? "border-[var(--brand-orange)] bg-[rgb(var(--brand-orange)/0.06)] shadow-[var(--pick-ring)]"
            : "hover:border-[rgb(var(--ink)/0.25)] hover:bg-[rgb(var(--ink)/0.03)]",
        )}
      >
        {icon && <IconTile icon={icon} active={checked} className="mb-3" />}
        <span
          className={cn("font-medium leading-snug", checked && "font-semibold")}
        >
          {title}
        </span>
        <span className="mt-1 text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}
