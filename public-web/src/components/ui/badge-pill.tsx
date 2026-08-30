import * as React from "react";
import { cn } from "@/lib/cn";

/** The one page-kind capsule allowed above a public-page heading. */
export function BadgePill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 eyebrow text-[rgb(var(--brand-orange))]",
        className,
      )}
    >
      {children}
    </span>
  );
}
