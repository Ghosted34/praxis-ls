/**
 * The attachment strip under the editor.
 *
 * ── THE TOTAL IS ALWAYS VISIBLE, NOT JUST THE FAILURE ───────────────────────
 *
 * The 25 MB cap is on the whole message, so a person adding a fourth file has no
 * way to know they are about to be refused unless the running total is on
 * screen. Showing it only in the error is how someone loses a large upload and
 * has to start again.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import type { AttachmentTray as Tray } from "@/lib/mail-api";

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

export function AttachmentTray({
  tray,
  onRemove,
  busy,
}: {
  tray: Tray | null;
  onRemove: (id: string) => void;
  busy?: boolean;
}) {
  if (!tray || tray.attachments.length === 0) return null;
  const pct = Math.min(100, Math.round((tray.total_bytes / tray.limit_bytes) * 100));
  // Inline images are referenced from the body by cid: and are not a separate
  // thing the reader downloads, so they are not listed as attachments.
  const files = tray.attachments.filter((a) => a.disposition !== "inline");

  return (
    <div className="border-t border-border px-3 py-2">
      <ul className="flex flex-wrap gap-1.5">
        {files.map((a) => (
          <li
            key={a.email_attachment_id}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
          >
            <span className="max-w-52 truncate">{a.filename || "file"}</span>
            <span className="num text-muted-foreground">{mb(Number(a.size_bytes || 0))}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(a.email_attachment_id)}
              aria-label={`Remove ${a.filename || "attachment"}`}
              className="rounded px-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-1.5 flex items-center gap-2">
        <div
          className="h-1 w-32 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Attachment size used"
        >
          <div
            className={cn("h-full rounded-full", pct > 90 ? "bg-destructive" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="num text-[0.6875rem] text-muted-foreground">
          {mb(tray.total_bytes)} of {mb(tray.limit_bytes)}
        </span>
        {tray.offer_secure_link && (
          <span title="Available once secure links are enabled">
            <Pill tone="mute">Large — a secure link would be better</Pill>
          </span>
        )}
      </div>

      {tray.offer_secure_link && (
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">
          Attachments this size are often rejected or filtered. Sending a secure
          link instead arrives in a later release.
        </p>
      )}
    </div>
  );
}

/** The "attach" control. Kept next to the tray so the two stay consistent. */
export function AttachButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          onFiles([...(e.target.files || [])]);
          // Reset, or picking the same file twice in a row does nothing and
          // reads as the button being broken.
          e.target.value = "";
        }}
      />
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => ref.current?.click()}>
        Attach
      </Button>
    </>
  );
}
