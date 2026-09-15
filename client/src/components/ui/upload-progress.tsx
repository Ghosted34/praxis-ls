/**
 * UploadProgress — the status line every upload in the product shows.
 *
 * Extracted rather than re-typed because it is the part people were leaving
 * out. `FileDrop` already drew this bar and 28 of 30 upload sites never fed it,
 * so the bar existing was not enough — it has to come attached to the thing
 * call sites already reach for. Both `FileDrop` and `ImageUpload` render this,
 * so the percentage, the wording and the success tick are identical wherever
 * an upload happens.
 *
 * WHY 100% IS NOT THE END. "Uploading…" runs 0→99 while bytes are in flight and
 * only becomes "Upload complete" once the SERVER has answered. The browser
 * finishes sending well before the server finishes storing, so a bar that hits
 * 100% on the last byte sent claims success the product has not yet earned —
 * and on a slow storage backend that gap is seconds long.
 */
import { cn } from "@/lib/cn";
import type { UploadState } from "@/lib/use-upload";

/** Compact human file size — shared with the file chip so both agree. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LABEL: Record<UploadState, string> = {
  idle: "Ready",
  compressing: "Optimising…",
  uploading: "Uploading…",
  success: "Upload complete",
  error: "Upload failed",
};

export function UploadProgress({
  state,
  percent,
  error = null,
  className,
}: {
  state: UploadState;
  /** 0–100. */
  percent: number;
  error?: string | null;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const done = state === "success";
  const failed = state === "error";

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        {/* aria-live on the label only: announcing every percentage tick would
            make a screen reader unusable, where the state change is the part a
            non-sighted user actually needs. */}
        <span
          className={cn(
            "text-muted-foreground",
            done && "text-ok",
            failed && "text-destructive",
          )}
          aria-live="polite"
        >
          {done ? "✓ " : ""}
          {LABEL[state]}
        </span>
        {!failed && <span className="num text-muted-foreground">{pct}%</span>}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            failed ? "bg-destructive" : done ? "bg-ok" : "bg-primary",
            // The indeterminate phase: compression has no measurable progress,
            // so the bar shows a small moving stub rather than a lying 0%.
            state === "compressing" && "animate-pulse",
          )}
          style={{ width: state === "compressing" ? "15%" : `${pct}%` }}
        />
      </div>
      {failed && error && (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
