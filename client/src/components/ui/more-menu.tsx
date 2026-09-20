/**
 * MoreMenu — the `⋯` control that holds a row's less-used actions.
 *
 * WHY. At 390px the party 360's document row carried up to six controls —
 * View, Replace, "Paste a file", Verify, Edit, Remove — and they wrapped into a
 * ragged column down the right-hand side of the table. Two of those (View, and
 * whichever file action applies) are what the row is for; the other four are
 * things you do to it once in a while. A phone row has room for the second
 * group only behind a disclosure, and `⋯` is the disclosure every reader
 * already knows.
 *
 * It is `<DropdownMenu>` with the trigger filled in — a real `<button>` with an
 * accessible name, wired to Radix's menu-button pattern (arrow keys, Home/End,
 * Escape, focus returned to the trigger). Do not hand-roll the button or
 * declare `role="menu"` on a `<div>`; see the header of `dropdown-menu.tsx`
 * for what that costs.
 *
 * WHAT GOES IN, AND IN WHAT ORDER. One or two most-used actions stay visible on
 * the row as real buttons; everything else goes here, most-used first and
 * anything destructive LAST, after a `<DropdownSeparator />`, with
 * `destructive` set so it reads as one. A menu whose first item is "Delete" is
 * a menu that gets mis-tapped.
 *
 * TARGET SIZE. 36px (`h-9 w-9`) — the same as `<Button size="sm">`, and wider
 * than the icon needs, because the alternative is a 16px glyph inside a 24px
 * box and a mis-tap rate nobody measures. It is the row's smallest control and
 * it is deliberately not the smallest thing that could hold the dots.
 *
 * @example
 * <MoreMenu label={tr("Document actions")}>
 *   <DropdownItem onSelect={verify}>Verify</DropdownItem>
 *   <DropdownItem onSelect={edit}>Edit</DropdownItem>
 *   <DropdownSeparator />
 *   <DropdownItem destructive onSelect={remove}>Remove</DropdownItem>
 * </MoreMenu>
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { MoreIcon } from "@/components/ui/icons";

export function MoreMenu({
  label,
  children,
  align = "end",
  disabled = false,
  className,
}: {
  /** The accessible name of both the button and the menu it opens ("Document
   *  actions", "Contact actions"). Required: an icon-only trigger with no name
   *  is announced as "button". */
  label: string;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu
      label={label}
      align={align}
      trigger={
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <MoreIcon width={18} height={18} />
        </button>
      }
    >
      {children}
    </DropdownMenu>
  );
}
