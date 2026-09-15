import * as React from "react";
import { cn } from "@/lib/cn";
import { tStatic } from "@/lib/i18n";
import { CloseIcon, DocumentIcon } from "@/components/ui/icons";
import {
  compressImage,
  isPreviewableImage,
  isSafeBlobUrl,
  previewUrlFor,
} from "@/lib/image-compress";

/**
 * One optional file, checked here and again on the server.
 *
 * ── WHY IT IS CHECKED TWICE ────────────────────────────────────────────────
 *
 * §3.6: "Enforce upload limits client-side as well as server-side. Their page
 * states 'Max 10MB' and never checks." A page that states a limit it does not
 * apply sends a prospect's 20 MB scan over a phone connection to be refused on
 * arrival — the one failure they could have avoided in a second, discovered
 * after the slowest part.
 *
 * The server checks are the real ones and are not weakened by these: the vault
 * bounds the decoded bytes and SNIFFS them, so a .exe renamed .pdf is refused
 * on what it contains rather than on what it claims. This is a courtesy in
 * front of that, never a substitute.
 *
 * ── WHY A DATA URL AND NOT MULTIPART ───────────────────────────────────────
 *
 * The one existing public upload on this product (`careers`, `cv_data_url`)
 * takes a base64 data URL in the JSON body, and following it keeps the whole
 * intake body inside one `.strict()` Zod schema. A multipart path would need
 * new middleware on an anonymous endpoint to gain nothing.
 *
 * Base64 costs about a third in size, which is why the ceiling below is the
 * DECODED one and the schema's outer bound is ~11 MB of string.
 */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

export type Attachment = {
  dataUrl: string;
  filename: string;
  bytes: number;
  /** An object URL for the image preview, or null for a PDF. Revoked on clear. */
  previewUrl?: string | null;
  /** The size before compression, when it was compressed. */
  originalBytes?: number;
};

// Annotated rather than `new Promise<string>(…)`: check-i18n scans for text
// between angle brackets, and a type argument reads to it as untranslated copy.
const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

export function FileInput({
  id,
  label,
  hint,
  value,
  onChange,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: Attachment | null;
  onChange: (a: Attachment | null) => void;
  className?: string;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // An object URL pins the whole file in memory until it is revoked.
  React.useEffect(() => {
    const url = value?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [value?.previewUrl]);

  async function pick(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!ATTACHMENT_TYPES.includes(file.type)) {
      setError(tStatic("site.quote.fileType"));
      return;
    }
    // The type check comes first, then compression, then the SIZE check —
    // against the compressed bytes. A 14 MB photo of a CV taken on a phone is
    // under the limit once resized, and refusing it before trying would turn a
    // solvable case into a dead end for someone with no account and no support
    // channel.
    setBusy(true);
    try {
      // "document": a CV or a scanned bill of lading keeps its source format, so
      // what the company receives is the kind of file they can open, and it is
      // never tonally corrected.
      const { file: prepared, originalBytes } = await compressImage(
        file,
        "document",
      );

      if (prepared.size > ATTACHMENT_MAX_BYTES) {
        setError(
          tStatic("site.quote.fileTooLarge", {
            size: formatBytes(prepared.size),
            limit: formatBytes(ATTACHMENT_MAX_BYTES),
          }),
        );
        return;
      }

      const dataUrl = await readAsDataUrl(prepared);
      onChange({
        dataUrl,
        filename: prepared.name,
        bytes: prepared.size,
        originalBytes,
        // The preview this control never had. A candidate attaching the wrong
        // scan has no account to come back and check it from, so the moment of
        // picking is the only moment they can notice.
        previewUrl: isPreviewableImage(prepared) ? previewUrlFor(prepared) : null,
      });
    } catch {
      setError(tStatic("site.quote.fileUnreadable"));
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
    setError(null);
    // Without this, re-picking the SAME file fires no change event and the
    // visitor concludes the control is broken.
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={cn("min-w-0", className)}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>

      {value ? (
        <div className="flex items-center gap-3 rounded-[calc(var(--radius)-2px)] border bg-muted/40 p-3">
          {/* Same guard as the careers form — see the note there. */}
          {isSafeBlobUrl(value.previewUrl) ? (
            <img
              src={value.previewUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded border bg-background object-cover"
            />
          ) : (
            <DocumentIcon size={18} className="shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">
            {value.filename}
            <span className="num ml-2 text-xs text-muted-foreground">
              {formatBytes(value.bytes)}
              {value.originalBytes && value.originalBytes > value.bytes ? (
                <> · {formatBytes(value.originalBytes)} before</>
              ) : null}
            </span>
          </span>
          <button
            type="button"
            onClick={clear}
            className="btn-surface grid h-8 w-8 shrink-0 place-items-center rounded-[calc(var(--radius)-4px)]"
          >
            <CloseIcon size={15} />
            <span className="sr-only">{tStatic("site.quote.fileRemove")}</span>
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPT}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          disabled={busy}
          onChange={(e) => void pick(e.target.files?.[0])}
          className="field file:mr-3 file:rounded-[calc(var(--radius)-4px)] file:border-0 file:bg-[rgb(var(--ink)/0.06)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      )}

      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}


/**
 * The file-picking control, without the attachment chip around it.
 *
 * `FileInput` above owns a whole labelled field; the careers form already has
 * its own layout and only needs the trigger. Both live here because this file
 * is the ONE place in public-web allowed to hold a raw `<input type="file">` —
 * `praxis/no-raw-upload` exempts it by path, and a second copy elsewhere is
 * exactly what that rule exists to stop.
 */
export function FilePicker({
  accept,
  label,
  trigger,
  disabled,
  onPick,
  className,
}: {
  accept: string;
  /** Names the control for assistive tech; visually hidden. */
  label: string;
  trigger: React.ReactNode;
  disabled?: boolean;
  onPick: (files: FileList | null) => void;
  className?: string;
}) {
  const id = React.useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "cursor-pointer",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {trigger}
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={label}
        className="sr-only"
        onChange={(e) => {
          onPick(e.target.files);
          // Without this, re-picking the SAME file fires no change event and
          // the visitor concludes the control is broken.
          e.target.value = "";
        }}
      />
    </label>
  );
}
