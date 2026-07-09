import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "default" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
};
const sizes: Record<Size, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-9 px-3 text-sm",
  lg: "h-11 px-6 text-base",
  icon: "h-10 w-10",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
