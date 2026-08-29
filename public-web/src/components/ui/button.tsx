import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { p } from "@/lib/base-path";

/**
 * Buttons, and the one link that has to LOOK like one.
 *
 * Ported from `client/src/components/ui/button.tsx` with three deliberate
 * changes:
 *
 *   · `size` adds `lg`. On a public page the primary action is 44px tall, not 40:
 *     a finger on a phone, in sunlight, is the actual input device for "Request a
 *     quote", and 44px is the floor where that stops being a miss.
 *   · The label-verb icon inference the staff button does is GONE. It matches
 *     English verbs (`/^(new|add|create…)/`), so in French it silently paints an
 *     icon on half the buttons and none on the other half. On a bilingual public
 *     surface that is not a nicety, it is a defect — an icon that appears only in
 *     one language is a design that only half works.
 *   · `<Button as Link>` becomes `<ButtonLink>`, a separate component, so the
 *     polymorphic `as` prop and its type soup never appear.
 *
 * `onHero` is a variant rather than a colour because the hero is the one surface
 * where a tenant's chosen fill cannot be trusted: a pale primary on carbon is
 * unreadable, and the fix is a structural light button, not a tint.
 */
type Variant = "default" | "outline" | "ghost" | "onHero" | "outlineOnHero";
type Size = "sm" | "default" | "lg";

const VARIANTS: Record<Variant, string> = {
  default: "btn-primary",
  outline: "btn-surface",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  onHero: "btn-onhero",
  outlineOnHero: "btn-ghost-hero",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  default: "h-11 px-5 text-[0.9375rem]",
  lg: "h-[44px] px-7 text-base",
};

const BASE = [
  "inline-flex items-center justify-center gap-2 rounded-[calc(var(--radius)-2px)]",
  "font-semibold transition-colors select-none",
  // No `disabled:opacity-*`: the recipes in index.css paint the disabled state
  // properly, and an opacity laid over them would fade THAT too.
  "disabled:pointer-events-none",
].join(" ");

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      loading,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {loading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

/** A navigation control that is a real link — keyboard-activatable, openable in
 *  a new tab, and readable by a crawler. `className` matches `Button`'s so the
 *  two never drift apart visually. */
export function ButtonLink({
  to,
  href,
  className,
  variant = "default",
  size = "default",
  children,
  ...rest
}: {
  to?: string;
  href?: string;
  className?: string;
  variant?: Variant;
  size?: Size;
  children: React.ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const cls = cn(BASE, VARIANTS[variant], SIZES[size], className);
  if (href) {
    return (
      <a className={cls} href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to || p()} className={cls} {...rest}>
      {children}
    </Link>
  );
}
