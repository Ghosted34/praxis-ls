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
import { tr } from "@/lib/i18n";
import { UploadIcon, ClipboardIcon } from "@/components/ui/icons";
import { UploadProgress, fileSize } from "@/components/ui/upload-progress";
import { useUpload, type UploadItem } from "@/lib/use-upload";
import type { UploadProfile } from "@/lib/image-compress";
import {
  acceptsOnlyImages,
  pasteFileFromEvent,
  pastedFileList,
} from "./upload-paste";

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
function pasteControlCopy(
  accept: string | undefined,
  variant: "dropzone" | "inline",
) {
  const imageOnly = acceptsOnlyImages(accept);
  return {
    button: tr(imageOnly ? "Paste an image" : "Paste a file"),
    idle:
      variant === "dropzone"
        ? tr(imageOnly ? "or paste an image" : "or paste a file")
        : tr(imageOnly ? "Paste an image" : "Paste a file"),
    empty: tr(
      imageOnly
        ? "No image on the clipboard — copy one with Ctrl+C first, or choose a file."
        : "No file on the clipboard — copy one with Ctrl+C first, or choose a file.",
    ),
  };
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
  triggerClassName,
  className,
  onPaste = true,
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
  /** Rails a pasted file through `onPick`, as if the user had chosen it. */
  onPaste?: boolean;
  /** The clickable text, for variant="inline". */
  trigger?: React.ReactNode;
  /**
   * Replaces the trigger's own classes, for variant="inline".
   *
   * The default is an underlined `text-primary-ink` link, which is right inside
   * a table row ("Replace", "Attach scan") and wrong on a phone card, where the
   * control sits beside a bordered `⋯` and has to read as the same class of
   * thing. The text is still a `<label>`, so this changes how it looks and not
   * what it does — the input, the preview and the percentage all still come
   * from here.
   */
  triggerClassName?: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const surfaceRef = React.useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputId = React.useId();

  // The paste option is armed by the click ("Press Ctrl+V now"), but it must
  // also be reachable from the keyboard alone for AT users — so the armed
  // state is mirrored in the text ("Press Ctrl+V now") and the target keeps a
  // focusable, announced surface to Tab to and paste into.
  const pasteTargetRef = React.useRef<HTMLSpanElement>(null);
  const [pasteArmed, setPasteArmed] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const pasteCopy = React.useMemo(
    () => pasteControlCopy(accept, variant),
    [accept, variant],
  );

  // ONE listener for the ONE clipboard: a capture-phase `paste` on window sees
  // a paste into any focusable element and, when the clipboard holds a file the
  // surface admits, takes it before anything else can. The focus/ownership gate
  // below keeps multiple mounted pickers from all trying to claim the same one
  // paste. `Escape` is the way back out of the armed state.
  React.useEffect(() => {
    if (!onPaste) return;
    const onPasteEvent = (e: ClipboardEvent) => {
      if (e.defaultPrevented || disabled) return;
      const surface = surfaceRef.current;
      const target = e.target instanceof Node ? e.target : null;
      const active = document.activeElement;
      const targetInside = !!surface && !!target && surface.contains(target);
      const focusInside = !!surface && !!active && surface.contains(active);
      if (!targetInside && !focusInside) return;

      const result = pasteFileFromEvent(e, accept);
      if (result.kind === "accepted") {
        e.preventDefault();
        onPick(pastedFileList(result.file));
        setPasteArmed(false);
        setMessage(null);
        pasteTargetRef.current?.blur();
        return;
      }

      if (result.kind === "rejected") {
        e.preventDefault();
        setPasteArmed(false);
        setMessage(
          tr("That file type isn't accepted here — choose a file instead."),
        );
        return;
      }

      if (pasteTargetRef.current === document.activeElement) {
        // The user asked for the option, so a bare Ctrl+V with no file must not
        // sit silent while the target is armed.
        e.preventDefault();
        setPasteArmed(false);
        setMessage(pasteCopy.empty);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPasteArmed(false);
      pasteTargetRef.current?.blur();
    };
    window.addEventListener("paste", onPasteEvent, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPasteEvent, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [accept, disabled, onPaste, onPick, pasteCopy.empty]);

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
        setPasteArmed(false);
        setMessage(null);
        onPick(e.target.files);
        // Reset so picking the SAME file twice still fires a change event —
        // which is exactly what happens after a failed upload and a re-pick.
        e.target.value = "";
      }}
    />
  );

  const pasteControl = onPaste ? (
    <>
      <button
        type="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (disabled) return;
          setPasteArmed(true);
          setMessage(null);
          pasteTargetRef.current?.focus();
        }}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
      >
        <ClipboardIcon />
        {pasteArmed ? tr("Press Ctrl+V now") : pasteCopy.idle}
      </button>
      <span
        ref={pasteTargetRef}
        role="textbox"
        aria-label={pasteCopy.button}
        className="sr-only"
        tabIndex={disabled ? -1 : 0}
        contentEditable
        suppressContentEditableWarning
      />
    </>
  ) : null;

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex flex-col items-start gap-1", className)}>
        <span
          ref={(node) => {
            surfaceRef.current = node;
          }}
          className="inline-flex flex-wrap items-center gap-2"
        >
          <label
            className={cn(
              triggerClassName ??
                "cursor-pointer text-sm text-primary-ink underline underline-offset-2 hover:opacity-80",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            {trigger ?? "Choose a file"}
            {input}
          </label>
          {/*
           * "Paste a file" IS A KEYBOARD AFFORDANCE, so it is hidden where there
           * is no keyboard — a `(pointer: coarse)` device — rather than below a
           * width breakpoint. A narrow desktop window is still a desktop: the
           * person there has Ctrl+V and no reason to lose the button, and the
           * phone that never had one stops paying for four words of chrome on
           * every row. Same query, same reasoning, as the task board's
           * `[@media(pointer:coarse)]:select-none`.
           *
           * The behaviour itself is untouched: a pasted file is still caught by
           * the window listener on a touch device that has a clipboard.
           */}
          <span className="inline-flex [@media(pointer:coarse)]:hidden">
            {pasteControl}
          </span>
        </span>
        {message && (
          <span className="micro block text-destructive" role="status">
            {message}
          </span>
        )}
      </span>
    );
  }

  return (
    <div
      ref={(node) => {
        surfaceRef.current = node;
      }}
      className={cn("space-y-2", className)}
    >
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
          if (!disabled) {
            setPasteArmed(false);
            setMessage(null);
            onPick(e.dataTransfer?.files ?? null);
          }
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
      {pasteControl && <div className="flex items-center gap-2">{pasteControl}</div>}
      {message && (
        <p className="micro text-destructive" role="status">
          {message}
        </p>
      )}
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
