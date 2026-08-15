import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Label — the styled `<label>` primitive.
 *
 * Association is the caller's `htmlFor`, spread through `...props`; the rule
 * inspects this file in isolation and cannot see it. `<Field>` (ui/modal.tsx) is
 * what wires htmlFor to a `useId`-minted control id for the 565 form fields that
 * had no association at all (audit F4) — and `Field`'s own contract test asserts
 * it, which is the check that actually guards this.
 */
export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  // eslint-disable-next-line jsx-a11y/label-has-associated-control
  <label
    ref={ref}
    className={cn("text-sm font-medium text-foreground", className)}
    {...props}
  />
));
Label.displayName = "Label";
