import { cn } from "@/lib/cn";

/** Reusable loading / empty / error blocks so screens have real states, not blank spinners. */
export const Spinner = ({ className }: { className?: string }) => (
  <span
    className={cn("inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    aria-label="Loading"
  />
);

export const LoadingRow = ({ label = "Loading…" }: { label?: string }) => (
  <div className="flex items-center gap-3 p-6 text-muted-foreground">
    <Spinner /> {label}
  </div>
);

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="rounded-lg border border-dashed p-10 text-center">
    <p className="font-medium">{title}</p>
    {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
  </div>
);

export const ErrorState = ({ message }: { message: string }) => (
  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{message}</div>
);
