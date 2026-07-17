/** Skeleton shimmer for loading states (nicer than a bare spinner on tables). */
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  // --ink-3 is a bare channel triplet, so the alpha here is reliable (unlike the
  // full-rgb semantic tokens, where Tailwind opacity modifiers don't apply).
  return <div className={cn("animate-pulse rounded-md bg-[rgb(var(--ink-3)/0.15)]", className)} />;
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="lux-card space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
