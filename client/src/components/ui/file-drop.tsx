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
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { UploadIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";

/** Compact human file size for the chosen-file chip. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPreviewOpen(false);
    if (!file || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isImage = !!file && (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name));
  const isPdf = !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  const percent = uploadProgress == null ? null : Math.max(0, Math.min(100, Math.round(uploadProgress)));

  function previewBody(full = false) {
    if (!previewUrl || !file) return null;
    if (isImage) return <img src={previewUrl} alt={`Preview of ${file.name}`} className={full ? "max-h-[70vh] max-w-full rounded-lg object-contain" : "h-28 w-full rounded-md object-contain"} />;
    if (isPdf) return <iframe src={previewUrl} title={`Preview of ${file.name}`} className={full ? "h-[70vh] w-full rounded-lg border" : "h-28 w-full rounded-md border"} />;
    return <div className="flex h-28 items-center justify-center rounded-md border text-sm text-muted-foreground">Preview unavailable for this file type.</div>;
  }

  return (
    <div className="space-y-1.5">
      {label && <span className="block text-sm font-medium text-foreground">{label}</span>}
      {/* Drag-and-drop layered over a real <label>+<input type="file">, which is
          what keyboard and AT users activate. The drop target is a pointer
          shortcut; it does not replace the control. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files?.[0] ?? null); }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-input px-4 py-6 text-center transition-colors hover:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] hover:bg-accent/40",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        {file ? (
          <span className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="font-medium text-foreground">{file.name}</span>
            <span className="micro text-muted-foreground">{fileSize(file.size)}</span>
          </span>
        ) : (
          <>
            <UploadIcon width={22} height={22} className="text-muted-foreground" />
            <span className="text-sm text-foreground">
              Drop a file here, or <span className="text-primary-ink underline">browse</span>
            </span>
          </>
        )}
        {hint && <span className="micro text-muted-foreground">{hint}</span>}
        <input
          type="file"
          className="sr-only"
          accept={accept}
          disabled={disabled}
          aria-label={label || "File"}
          onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; onPick(f); }}
        />
      </label>
      {file && previewUrl && (
        <div className="rounded-lg border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="micro font-medium text-foreground">Preview</span>
            <button type="button" className="micro text-primary-ink underline" onClick={() => setPreviewOpen(true)}>
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
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      {uploadSuccess && <p className="text-xs text-ok" role="status">✓ Upload successful</p>}
      {file && (
        <button type="button" className="micro text-primary-ink underline" onClick={() => onPick(null)}>
          Remove file
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {previewOpen && previewUrl && file && (
        <Modal open onClose={() => setPreviewOpen(false)} title={`Preview — ${file.name}`} size="xl">
          {previewBody(true)}
        </Modal>
      )}
    </div>
  );
}
