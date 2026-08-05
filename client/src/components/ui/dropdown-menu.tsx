/**
 * DropdownMenu — a button that opens a list of actions or destinations.
 *
 * WHY RADIX (audit F13). Three blocks declared `role="menu"` / `role="menuitem"`
 * — `app-shell.tsx:440` (the account menu), `app-shell.tsx:530` (the "More" nav
 * group) and `notification-bell.tsx:111` — and `app/layout/app-shell.tsx`
 * contained ZERO onKeyDown handlers.
 *
 * That combination is worse than doing nothing. Declaring `role="menu"` makes a
 * promise to assistive tech: arrow-key navigation, Home/End, type-ahead,
 * Escape, and a managed focus cycle. It also STRIPS the underlying link
 * semantics — a `<Link role="menuitem">` stops being announced as a link. So
 * the markup told a screen-reader user "this is a menu, use the arrow keys",
 * the arrow keys did nothing, and the user had lost the link affordance they
 * would otherwise have had. Plain links would have been strictly better.
 *
 * Radix implements the WAI-ARIA menu button pattern properly, and is headless,
 * so the existing popover look carries over unchanged.
 *
 * WHEN NOT TO USE THIS. A menu is for ACTIONS and destinations. If the popup
 * contains a list of content with its own controls — the notification panel,
 * with a "mark read" button per row — it is not a menu, and nesting buttons
 * inside a `menuitem` is invalid. Use `<Popover>` for that. The notification
 * bell was the clearest instance: it was never a menu, it was a panel wearing
 * a menu's ARIA.
 *
 * @example
 * <DropdownMenu trigger={<Button variant="outline">Actions</Button>} label="Row actions">
 *   <DropdownItem onSelect={() => edit(row)}>Edit</DropdownItem>
 *   <DropdownItem to={`/clients/${row.id}`}>Open client</DropdownItem>
 *   <DropdownSeparator />
 *   <DropdownItem destructive onSelect={() => remove(row)}>Delete</DropdownItem>
 * </DropdownMenu>
 *
 * BEST PRACTICE. Put the one or two most-used actions on the row as real
 * buttons and the rest in the menu — a menu hides everything inside it behind a
 * click plus a read. Order destructive items last, after a separator. Never put
 * a form control inside a menu item.
 */
import * as React from "react";
import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

const CONTENT_CLASS =
  "z-50 min-w-[13rem] animate-fade-in rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-l)]";

const ITEM_CLASS =
  "flex cursor-pointer select-none items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none transition-colors " +
  "data-[highlighted]:bg-accent/60 data-[highlighted]:text-foreground " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function DropdownMenu({
  trigger,
  label,
  children,
  align = "end",
  open,
  onOpenChange,
  modal = true,
  className,
}: {
  /** The button that opens the menu. Rendered as-is via `asChild`. */
  trigger: React.ReactNode;
  /**
   * Optional override for the menu's accessible name.
   *
   * Usually unnecessary and usually the wrong lever: Radix already points the
   * menu's `aria-labelledby` at its TRIGGER, which is the WAI-ARIA menu-button
   * pattern — "Actions menu" is announced from the button you pressed. If a menu
   * is coming out unnamed, the fix is to give the trigger accessible text (an
   * icon-only button needs an `aria-label`), not to name the menu here.
   * `aria-labelledby` wins over `aria-label`, so this only takes effect when
   * Radix has nothing to point at.
   */
  label?: string;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  /** Controlled mode. The top-bar nav uses it so hovering one area can close
   *  its sibling. Omit both for uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `false` leaves the page behind the menu interactive — required for the top
   *  bar, where moving the pointer from one area to the next must reach the
   *  sibling trigger rather than being swallowed by a modal layer. */
  modal?: boolean;
  className?: string;
}) {
  return (
    <RadixMenu.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          aria-label={label}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className={cn(CONTENT_CLASS, className)}
        >
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

/**
 * One menu entry. Pass `to` for a destination (renders a router `<Link>` inside
 * the item, so the menu closes and the route changes in one activation) or
 * `onSelect` for an action.
 */
export function DropdownItem({
  children,
  onSelect,
  to,
  disabled,
  destructive,
  className,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  to?: string;
  disabled?: boolean;
  destructive?: boolean;
  className?: string;
}) {
  const cls = cn(ITEM_CLASS, destructive && "text-[rgb(var(--bad))] data-[highlighted]:text-[rgb(var(--bad))]", className);

  if (to) {
    return (
      <RadixMenu.Item asChild disabled={disabled} className={cls}>
        <Link to={to}>{children}</Link>
      </RadixMenu.Item>
    );
  }
  return (
    <RadixMenu.Item disabled={disabled} onSelect={onSelect} className={cls}>
      {children}
    </RadixMenu.Item>
  );
}

/** A non-interactive heading above a group of items. */
export function DropdownLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <RadixMenu.Label className={cn("px-3 py-1.5", className)}>{children}</RadixMenu.Label>;
}

export function DropdownSeparator({ className }: { className?: string }) {
  return <RadixMenu.Separator className={cn("my-1.5 h-px bg-border", className)} />;
}

/** Escape hatch for arbitrary non-interactive content (an account summary
 *  header, say). Radix keeps it out of the arrow-key cycle. */
export function DropdownGroup({ children }: { children: React.ReactNode }) {
  return <RadixMenu.Group>{children}</RadixMenu.Group>;
}

/**
 * An independently on/off entry — a column's visibility, a filter toggle.
 *
 * Same reasoning as `DropdownRadioItem`: `menuitemcheckbox` carries
 * `aria-checked` as a fact rather than as a tick glyph, so a screen reader says
 * "Client, checked" instead of announcing a command whose name happens to start
 * with a mark. `onSelect` is prevented so the menu stays open — toggling six
 * columns should be six clicks, not six clicks and six re-openings.
 */
export function DropdownCheckboxItem({
  checked,
  onCheckedChange,
  children,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RadixMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className={cn(ITEM_CLASS, className)}
    >
      <span aria-hidden className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border border-input">
        <RadixMenu.ItemIndicator>
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </RadixMenu.ItemIndicator>
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </RadixMenu.CheckboxItem>
  );
}

/**
 * A set of mutually exclusive choices inside a menu — row density, sort order,
 * a view mode.
 *
 * WHY NOT JUST `DropdownItem`s WITH A TICK. Because a tick is a picture and
 * `aria-checked` is a fact. `menuitemradio` is what tells assistive tech that
 * these N entries are one choice, which of them is current, and that picking one
 * releases the others — "Compact, radio button, 1 of 3" instead of three
 * unrelated commands one of which happens to be drawn with a mark next to it.
 * Radix emits the role and the state; this only has to style them.
 *
 * @example
 * <DropdownRadioGroup value={density} onValueChange={setDensity}>
 *   <DropdownRadioItem value="compact">Compact</DropdownRadioItem>
 *   <DropdownRadioItem value="default">Default</DropdownRadioItem>
 * </DropdownRadioGroup>
 */
export function DropdownRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <RadixMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </RadixMenu.RadioGroup>
  );
}

export function DropdownRadioItem({
  value,
  children,
  hint,
  className,
}: {
  value: string;
  children: React.ReactNode;
  /** A line of explanation under the label. Not announced separately — it is
   *  inside the item, so it is part of the item's accessible name. */
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <RadixMenu.RadioItem value={value} className={cn(ITEM_CLASS, "items-start", className)}>
      {/* The indicator slot is reserved whether or not it is filled, so the
          labels stay on one left edge instead of shifting as the choice moves. */}
      <span aria-hidden className="mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-input">
        <RadixMenu.ItemIndicator>
          <span className="block h-1.5 w-1.5 rounded-full bg-primary" />
        </RadixMenu.ItemIndicator>
      </span>
      <span className="min-w-0">
        <span className="block">{children}</span>
        {hint && <span className="block text-micro normal-case text-muted-foreground">{hint}</span>}
      </span>
    </RadixMenu.RadioItem>
  );
}
