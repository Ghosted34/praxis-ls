/**
 * Tooltip — a short clarification on hover or keyboard focus.
 *
 * The app used the native `title` attribute for this (e.g.
 * `screen-scaffold.tsx`'s disabled actions: `title="Available once the backend
 * is wired"`). `title` has a ~1s delay you cannot tune, does not appear on
 * keyboard focus in several browsers, cannot be styled, and is not announced
 * reliably by screen readers — so the explanation for a DISABLED control, which
 * is exactly when a user needs it most, frequently never arrives.
 *
 * Radix shows on hover AND on focus, wires `aria-describedby`, and dismisses on
 * Escape (WCAG 1.4.13, Content on Hover or Focus).
 *
 * IMPORTANT — a tooltip is supplementary, never the only source of information.
 * It does not appear on touch at all, so anything a user MUST read to operate
 * the screen belongs in a `<Field hint>`, a description, or visible text. Use
 * this for "why is this disabled", a full value behind a truncation, or the
 * expansion of an abbreviation.
 *
 * DISABLED TRIGGERS. A `disabled` button fires no pointer events, so a tooltip
 * on one never opens. Wrap it in a focusable span (`<TooltipTrigger>` below
 * handles this) or, better, explain the disabled state in visible text.
 *
 * @example
 * <TooltipProvider>   // once, near the app root
 *   …
 *   <Tooltip content="Available once the costing is approved">
 *     <span tabIndex={0}><Button disabled>Issue invoice</Button></span>
 *   </Tooltip>
 * </TooltipProvider>
 *
 * BEST PRACTICE. One short sentence, no interactive content inside (a tooltip
 * cannot be hovered into reliably and is not reachable by Tab). If you want the
 * user to click something in it, you want a `<Popover>`.
 */
import * as React from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

/** Mount once near the root. `delayDuration` 300ms is deliberate: long enough
 *  that tooltips do not flash while the pointer crosses a toolbar, short enough
 *  not to feel broken. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={150}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: React.ReactNode;
  /** The trigger. Must accept a ref and be focusable. */
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-50 max-w-xs rounded-md border bg-popover px-2.5 py-1.5 text-label text-popover-foreground shadow-[var(--shadow-l)]",
            className,
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-[var(--popover)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
