import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-[10px] border border-input bg-background px-3 py-2 text-[13px]",
        "placeholder:text-muted-foreground",
        "transition-colors focus-visible:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
