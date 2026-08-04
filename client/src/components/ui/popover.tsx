/**
 * Popover — a panel anchored to a trigger, holding CONTENT rather than actions.
 *
 * The distinction from `<DropdownMenu>` is not cosmetic, and getting it wrong
 * is what `notification-bell.tsx:111` did (audit F13): it declared
 * `role="menu"` over a scrollable list of notifications, each row carrying its
 * own "mark read" button. A `menuitem` may not contain interactive children —
 * so that markup promised menu keyboard semantics it did not implement AND
 * nested buttons where none are allowed.
 *
 *   DropdownMenu  a list of actions/destinations, one activation each, arrow
 *                 keys move between them.
 *   Popover       a panel of content: text, a list with its own controls, a
 *                 small form. Tab moves through it like ordinary content.
 *
 * Radix gives the popover what the hand-rolled version lacked: focus moves into
 * the panel on open and RETURNS to the trigger on close, Escape closes,
 * outside-click closes, and the trigger carries `aria-expanded` /
 * `aria-controls` so its state is announced.
 *
 * @example
 * <Popover trigger={<button aria-label="Notifications"><BellIcon /></button>} label="Notifications">
 *   <NotificationList />
 * </Popover>
 *
 * BEST PRACTICE. Give `label` a name matching the trigger's purpose — it is
 * what a screen reader announces on entering the panel. Keep a popover under
 * roughly a screen-third tall and scroll inside it; past that the content
 * wants a page or a Dialog. Do not put a destructive confirmation in one — an
 * outside click dismisses it, which is the wrong default for an irreversible
 * action.
 */
import * as React from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";

export function Popover({
  trigger,
  label,
  children,
  align = "end",
  open,
  onOpenChange,
  className,
}: {
  trigger: React.ReactNode;
  /** Accessible name for the panel. Not rendered. */
  label: string;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  /** Controlled mode. Omit both for uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={label}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            "z-50 animate-fade-in overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[var(--shadow-l)]",
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export const PopoverClose = RadixPopover.Close;
