/**
 * FileDrop — a drag-or-browse file picker, styled to sit inside a form.
 *
 * WHY IT IS SHARED. Both the client/supplier and the corporate-entity Documents
 * forms now take the scan inline, in the same submit that records the document —
 * instead of the old "save the row, find it again, attach the file from a second
 * control" errand. That is one dropzone, and it should look and behave the same
 * on both, so it lives here rather than being re-typed per screen. The parent
 * owns the chosen `File` and what to do with it (validate, upload to the vault,
 * link it onto the record); this component only surfaces the picker and reflects
 * what has been chosen.
 *
 * PREVIEW. Images render in `<img>` (img-src already allows blob: / data:).
 * PDFs cannot use the browser plugin — see `lib/pdfjs.ts` — so they are painted
 * onto a canvas by `<PdfPreview>`. A sandboxed iframe pointed at a data URL is
 * what produced Chrome's "This content is blocked" interstitial on every KYC
 * upload; do not put that back.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type { UploadItem } from "@/lib/use-upload";
import { UploadIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { PdfPreview } from "@/components/ui/pdf-preview";

/** Compact human file size for the chosen-file chip. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)
  );
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function FileDrop({
  file,
  onPick,
  accept,
  label,
  hint,
  error,
  disabled,
  uploadProgress = null,
  uploadSuccess = false,
}: {
  /** The currently chosen file, or null. */
  file: File | null;
  /** Called with the picked file, or null when it is cleared. */
  onPick: (file: File | null) => void;
  /** The `accept` list handed to the file input. */
  accept: string;
  /** Optional field label shown above the dropzone; also names the input for AT. */
  label?: string;
  /** Guidance shown inside the dropzone (formats, size limit). */
  hint?: string;
  /** A validation message shown under the dropzone (e.g. too large / wrong type). */
  error?: string | null;
  disabled?: boolean;
  /** Bytes-uploaded percentage, 0–100. */
  uploadProgress?: number | null;
  /** True after the server confirms the upload. */
  uploadSuccess?: boolean;
}) {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);

  const isImage = !!file && isImageFile(file);
  const isPdf = !!file && isPdfFile(file);

  React.useEffect(() => {
    setPreviewOpen(false);
    setImageUrl(null);
    if (!file || !isImage) return;

    let live = true;
    const reader = new FileReader();

    reader.onload = () => {
      if (live) setImageUrl(String(reader.result));
    };

    reader.onerror = () => {
      if (live) setImageUrl(null);
    };

    reader.readAsDataURL(file);

    return () => {
      live = false;
      reader.abort();
    };
  }, [file, isImage]);

  const canPreview = isImage || isPdf;
  const percent =
    uploadProgress == null
      ? null
      : Math.max(0, Math.min(100, Math.round(uploadProgress)));

  function previewBody(full = false) {
    if (!file) return null;
    if (isImage && imageUrl) {
      return (
        <img
          src={imageUrl}
          alt="Selected image preview"
          className={
            full
              ? "max-h-[70vh] max-w-full rounded-lg object-contain"
              : "h-28 w-full rounded-md object-contain"
          }
        />
      );
    }
    if (isPdf) return <PdfPreview file={file} full={full} />;
    return (
      <div className="flex h-28 items-center justify-center rounded-md border text-sm text-muted-foreground">
        Preview unavailable for this file type.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {label && (
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
      )}
      {/* Drag-and-drop layered over a real <label>+<input type="file">, which is
          what keyboard and AT users activate. The drop target is a pointer
          shortcut; it does not replace the control. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onPick(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          // `relative` IS LOAD-BEARING — see the note above the <input>.
          "relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-input px-4 py-6 text-center transition-colors hover:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] hover:bg-accent/40",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        {file ? (
          <span className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="font-medium text-foreground">{file.name}</span>
            <span className="micro text-muted-foreground">
              {fileSize(file.size)}
            </span>
          </span>
        ) : (
          <>
            <UploadIcon
              width={22}
              height={22}
              className="text-muted-foreground"
            />
            <span className="text-sm text-foreground">
              Drop a file here, or{" "}
              <span className="text-primary-ink underline">browse</span>
            </span>
          </>
        )}
        {hint && <span className="micro text-muted-foreground">{hint}</span>}
        {/*
         * THE LABEL ABOVE MUST STAY `relative`, AND THIS IS THE ENTIRE REASON.
         *
         * `sr-only` is `position: absolute` with no offsets. Absolute means the
         * element is laid out against its nearest POSITIONED ancestor, and if
         * there is none that is the initial containing block — the document.
         * An element positioned against the document contributes to the
         * DOCUMENT's scrollable overflow, even though it visually sits inside
         * the app shell's own scroll container.
         *
         * So on a long screen, scrolled down, this 1px input gave <html> a
         * scrollable region several hundred pixels tall. Clicking the label
         * focuses the input — that is how a file picker is opened — and the
         * browser scrolls the focused element into view. It scrolled the
         * DOCUMENT, pushing the whole app shell up and out of the viewport.
         *
         * What the user sees is the page turn black, because `html, body,
         * #root` are `height: 100%; overflow: hidden` (index.css) and what is
         * left below the shell is bare body background. And `overflow: hidden`
         * is why it does not come back: it suppresses the SCROLLBAR, it does
         * not stop the browser scrolling programmatically — so there is no way
         * left to scroll it back, and only a reload resets it. Measured in
         * Chromium at 1440×900: document scrollTop 50 → 768, `#root` top 0 →
         * -768. It reproduced on Cancel as well as on picking a file, because
         * the focus — not the file — is what moves it.
         *
         * One `relative` on the label gives this a containing block inside the
         * app's own scroll container, and the document's scrollable overflow
         * goes to zero. Do not remove it, and do not replace `sr-only` with
         * something else absolutely positioned without re-reading this.
         */}
        <input
          type="file"
          className="sr-only"
          accept={accept}
          disabled={disabled}
          aria-label={label || "File"}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            onPick(f);
          }}
        />
      </label>
      {file && canPreview && (
        <div className="rounded-lg border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="micro font-medium text-foreground">Preview</span>
            <button
              type="button"
              className="micro text-primary-ink underline"
              onClick={() => setPreviewOpen(true)}
            >
              Expand preview
            </button>
          </div>
          {previewBody()}
        </div>
      )}
      {percent !== null && (
        <div className="space-y-1" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{percent === 100 ? "Upload complete" : "Uploading…"}</span>
            <span className="num">{percent}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
      {uploadSuccess && (
        <p className="text-xs text-ok" role="status">
          ✓ Upload successful
        </p>
      )}
      {file && (
        <button
          type="button"
          className="micro text-primary-ink underline"
          onClick={() => onPick(null)}
        >
          Remove file
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {previewOpen && file && canPreview && (
        <Modal
          open
          onClose={() => setPreviewOpen(false)}
          title="Document preview"
          size="xl"
        >
          {previewBody(true)}
        </Modal>
      )}
    </div>
  );
}

/**
 * Map an upload-engine item onto FileDrop's props.
 *
 * WHY THIS EXISTS. FileDrop has accepted `uploadProgress` and `uploadSuccess`
 * since the day it was written, and of its ten call sites TWO passed them —
 * the same two that were passing them before the upload engine was built. The
 * props were never the problem: assembling them by hand is a file, a
 * percentage, a success flag, an error and a reset, in every site, every time.
 *
 * So this is the whole wiring, once:
 *
 *     const upload = useUpload({ profile: "photo", send });
 *     <FileDrop
 *       {...fileDropProps(upload.items[0])}
 *       onPick={(f) => (f ? void upload.pick([f]) : upload.reset())}
 *       accept={IMAGE_ACCEPT}
 *       label="Cover image"
 *     />
 *
 * and the site gets compression, a real 0→100 percentage and the completion
 * state for free, because they all come from the same engine every other
 * upload in the product uses.
 *
 * `praxis/require-upload-progress` fails a `<FileDrop>` that has neither this
 * spread nor an explicit `uploadProgress`, so the two-of-ten outcome cannot
 * happen again quietly.
 */
export function fileDropProps<T>(item: UploadItem<T> | null | undefined): {
  file: File | null;
  uploadProgress: number | null;
  uploadSuccess: boolean;
  error: string | null;
} {
  return {
    // The PREPARED file once compression has run, so the chip shows the size
    // that will actually be sent rather than the one off the camera.
    file: item ? (item.prepared ?? item.file) : null,
    // null while idle: a bar reading 0% before anything has started is noise.
    uploadProgress:
      item && item.state !== "idle" && item.state !== "error"
        ? item.percent
        : null,
    uploadSuccess: item?.state === "success",
    error: item?.error ?? null,
  };
}
