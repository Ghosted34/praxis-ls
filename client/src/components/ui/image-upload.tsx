/**
 * ImageUpload — the upload control. Use this, not an <input type="file">.
 *
 * WHAT IT GUARANTEES, and why each one is a guarantee rather than a prop:
 *
 *  · A PREVIEW, always. Created from an object URL the moment the picker
 *    closes, before compression or upload start. It is not optional and there
 *    is no prop to switch it off, because "most places have it" is exactly the
 *    state that produced screens where you upload a document and are shown a
 *    filename you have to trust.
 *  · A PERCENTAGE, always. 0→100 with the phase named — Optimising, Uploading,
 *    then Upload complete only once the server has answered.
 *  · COMPRESSION, always. Before a byte leaves the device, sized by `profile`.
 *  · A WAY BACK. Remove cancels an upload in flight; Retry re-sends a failure
 *    without re-compressing.
 *
 * PROFILE IS REQUIRED and is not cosmetic — it decides whether the image is
 * tonally corrected. `document` never is (a scan must keep matching the paper),
 * `brand` never is (a tenant's logo colour must survive), `photo` and `avatar`
 * are. Pass the one that describes the picture, not the one that looks best.
 * See `lib/image-compress.ts` and `src/services/image-pipeline.service.js`.
 *
 * Native dialogs are banned here as everywhere: removing an uploaded file
 * surfaces through `useConfirm()` at the call site if it needs confirming, not
 * `window.confirm`. See CLAUDE.md.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { UploadIcon } from "@/components/ui/icons";
import { UploadProgress, fileSize } from "@/components/ui/upload-progress";
import { useUpload, type UploadItem } from "@/lib/use-upload";
import type { UploadProfile } from "@/lib/image-compress";

export type ImageUploadProps<T> = {
  /** What this picture IS. Drives compression and server-side treatment. */
  profile: UploadProfile;
  /** Performs the request. Pair with `uploadFile()` from lib/api-client. */
  send: (
    file: File,
    ctx: { onProgress: (percent: number) => void; signal: AbortSignal },
  ) => Promise<T>;
  /** The `accept` list for the picker. */
  accept?: string;
  /** Field label, also names the input for assistive tech. */
  label?: string;
  /** Guidance inside the dropzone — formats and the size limit. */
  hint?: string;
  /** Reject anything larger, before compression. */
  maxBytes?: number;
  multiple?: boolean;
  disabled?: boolean;
  /** Called once every picked file has uploaded successfully. */
  onAllComplete?: (results: T[]) => void;
  className?: string;
};

export function ItemCard<T>({
  item,
  onRemove,
  onRetry,
}: {
  item: UploadItem<T>;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const saved =
    item.bytes < item.originalBytes
      ? Math.round((1 - item.bytes / item.originalBytes) * 100)
      : 0;

  return (
    <li className="rounded-lg border bg-muted/20 p-2">
      <div className="flex items-start gap-3">
        {item.previewUrl ? (
          <img
            src={item.previewUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-md border bg-background object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
            <UploadIcon />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm" title={item.file.name}>
              {item.file.name}
            </p>
            <div className="flex shrink-0 gap-2">
              {item.state === "error" && (
                <button
                  type="button"
                  className="micro text-primary-ink underline"
                  onClick={onRetry}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                className="micro text-primary-ink underline"
                onClick={onRemove}
              >
                {item.state === "uploading" || item.state === "compressing"
                  ? "Cancel"
                  : "Remove"}
              </button>
            </div>
          </div>

          <p className="micro text-muted-foreground">
            {fileSize(item.bytes)}
            {saved > 0 && (
              <>
                {" "}
                · {saved}% smaller than the {fileSize(item.originalBytes)}{" "}
                original
              </>
            )}
          </p>

          <UploadProgress
            state={item.state}
            percent={item.percent}
            error={item.error}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * The picked-files list: preview, size, progress, remove/retry — one card each.
 *
 * Exported separately from `ImageUpload` because deferred sites (the vault
 * upload, where the document type is typed after the file is chosen and the
 * bytes wait for Save) drive `useUpload` themselves and still must not
 * hand-roll the preview and the bar. This is what keeps those sites honest.
 */
export function UploadList<T>({
  items,
  onRemove,
  onRetry,
  className,
}: {
  items: UploadItem<T>[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          onRemove={() => onRemove(item.id)}
          onRetry={() => onRetry(item.id)}
        />
      ))}
    </ul>
  );
}

/**
 * The dropzone and the file input behind it.
 *
 * This holds one of the only two real `<input type="file">` elements in the
 * client (the other is FileDrop's). Everything else goes through here, which is
 * what makes `praxis/no-raw-upload` enforceable rather than aspirational.
 */
export function FilePicker({
  onPick,
  openRef,
  accept = "image/*",
  label,
  hint,
  multiple = false,
  disabled = false,
  variant = "dropzone",
  trigger,
  className,
}: {
  onPick: (files: FileList | null) => void;
  /** Lets an action menu open the engine picker without unmounting its input. */
  openRef?: React.Ref<() => void>;
  accept?: string;
  label?: string;
  hint?: string;
  multiple?: boolean;
  disabled?: boolean;
  /**
   * "dropzone" is the default and right for a form field. "inline" renders a
   * text trigger instead, for the places a dropzone would be absurd — an
   * "Attach scan" link in a table row, a "Replace" beside an existing file.
   *
   * This variant exists so those sites are not pushed into an
   * eslint-disable. A gate that the honest cases cannot satisfy is a gate that
   * gets disabled, and then the preview and the percentage go with it.
   */
  variant?: "dropzone" | "inline";
  /** The clickable text, for variant="inline". */
  trigger?: React.ReactNode;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputId = React.useId();

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  React.useImperativeHandle(openRef, () => open);

  const input = (
    <input
      id={inputId}
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      disabled={disabled}
      className="sr-only"
      // In the dropzone variant the visible <label htmlFor> names this input.
      // The inline variant has no separate label element — the trigger sits
      // INSIDE the label — so `label` is applied here instead. Without this the
      // input's accessible name is whatever the trigger happens to say, which
      // for a trigger reading "Replace" tells a screen-reader user nothing
      // about what is being replaced.
      aria-label={variant === "inline" ? label : undefined}
      onChange={(e) => {
        onPick(e.target.files);
        // Reset so picking the SAME file twice still fires a change event —
        // which is exactly what happens after a failed upload and a re-pick.
        e.target.value = "";
      }}
    />
  );

  if (variant === "inline") {
    return (
      <label
        className={cn(
          "cursor-pointer text-sm text-primary-ink underline underline-offset-2 hover:opacity-80",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        {trigger ?? "Choose a file"}
        {input}
      </label>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium">
          {label}
        </label>
      )}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) onPick(e.dataTransfer?.files ?? null);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-input px-4 py-6 text-center transition-colors",
          "hover:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] hover:bg-accent/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging &&
            "border-[color-mix(in_srgb,var(--primary)_60%,transparent)] bg-accent/50",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <UploadIcon />
        <p className="text-sm">
          <span className="text-primary-ink underline">Choose a file</span> or
          drag it here
        </p>
        {hint && <p className="micro text-muted-foreground">{hint}</p>}
      </div>

      {input}
    </div>
  );
}

export function ImageUpload<T = unknown>({
  profile,
  send,
  accept = "image/*",
  label,
  hint,
  maxBytes,
  multiple = false,
  disabled = false,
  onAllComplete,
  className,
}: ImageUploadProps<T>) {
  const { items, pick, remove, retry } = useUpload<T>({
    profile,
    maxBytes,
    multiple,
    send,
    onAllComplete,
  });

  return (
    <div className={cn("space-y-2", className)}>
      <FilePicker
        onPick={(files) => void pick(files)}
        accept={accept}
        label={label}
        hint={hint}
        multiple={multiple}
        disabled={disabled}
      />
      <UploadList items={items} onRemove={remove} onRetry={retry} />
    </div>
  );
}
