import * as React from "react";
import { cn } from "@/lib/cn";
import { tStatic } from "@/lib/i18n";
import { CloseIcon, DocumentIcon } from "@/components/ui/icons";

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

export type Attachment = { dataUrl: string; filename: string; bytes: number };

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
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!ATTACHMENT_TYPES.includes(file.type)) {
      setError(tStatic("site.quote.fileType"));
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError(
        tStatic("site.quote.fileTooLarge", {
          size: formatBytes(file.size),
          limit: formatBytes(ATTACHMENT_MAX_BYTES),
        }),
      );
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      onChange({ dataUrl, filename: file.name, bytes: file.size });
    } catch {
      setError(tStatic("site.quote.fileUnreadable"));
    }
  }

  function clear() {
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
          <DocumentIcon size={18} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {value.filename}
            <span className="num ml-2 text-xs text-muted-foreground">
              {formatBytes(value.bytes)}
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
