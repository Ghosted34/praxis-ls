/**
 * Sending a file from the portal — a scan, a photo of a receipt, a PDF.
 *
 * The three things CLAUDE.md requires of every upload, and why each matters
 * MORE here than anywhere else in the product:
 *
 *   · A PREVIEW the moment the picker closes. A client photographing the wrong
 *     page has no second look otherwise; the reviewer rejects it three days
 *     later and the shipment waits.
 *   · A PERCENTAGE, ending in "Upload complete" only once the SERVER answered.
 *     On a phone connection a silent 20-second upload reads as a frozen screen,
 *     and people send it twice.
 *   · COMPRESSION before the bytes leave the phone — profile "document", which
 *     downsizes but never tonally corrects, so the scan still matches the paper.
 *
 * The raw file input lives in `components/ui/file-input.tsx` (`FilePicker`),
 * the one place `praxis/no-raw-upload` allows it.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { FilePicker } from "@/components/ui/file-input";
import { compressImage, isPreviewableImage, isSafeBlobUrl, previewUrlFor } from "@/lib/image-compress";
import { cn } from "@/lib/cn";
import { CameraIcon, UploadIcon, DocIcon, CloseIcon, CheckCircleIcon } from "./icons";

export const UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
const TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export type Picked = { file: File; previewUrl: string | null; originalBytes: number | null };

/** Pick, compress, check. Resolves to the prepared file or an error key. */
async function prepare(file: File): Promise<Picked | { error: string }> {
  // Phones label a HEIC photo as image/heic and many browsers leave `type`
  // empty for it; both are refused by the server's sniff, so say so now.
  if (!TYPES.includes(file.type)) return { error: "portal.upload.badType" };
  const { file: out, originalBytes } = await compressImage(file, "document");
  if (out.size > UPLOAD_MAX_BYTES) return { error: "portal.upload.tooBig" };
  return {
    file: out,
    previewUrl: isPreviewableImage(out) ? previewUrlFor(out) : null,
    originalBytes: originalBytes && originalBytes > out.size ? originalBytes : null,
  };
}

/**
 * The two ways in — camera and files — then the chosen file as a card.
 * Controlled: the parent owns `value`, so it can send the file itself (a
 * payment proof goes up WITH its form) or hand it to `UploadNow` below.
 */
export function FileChooser({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: Picked | null;
  onChange: (p: Picked | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const url = value?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [value?.previewUrl]);

  async function pick(files: FileList | null) {
    const f = files && files[0];
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      const out = await prepare(f);
      if ("error" in out) setError(t(out.error, { limit: formatBytes(UPLOAD_MAX_BYTES) }));
      else onChange(out);
    } catch {
      setError(t("portal.upload.unreadable"));
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="pt-card flex items-center gap-3 p-3">
        <span className="pt-upload-thumb">
          {isSafeBlobUrl(value.previewUrl) ? <img src={value.previewUrl} alt="" /> : <DocIcon size={24} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{value.file.name}</p>
          <p className="pt-num text-xs text-muted-foreground">
            {formatBytes(value.file.size)}
            {value.originalBytes ? ` · ${t("portal.upload.was", { size: formatBytes(value.originalBytes) })}` : ""}
          </p>
        </div>
        {!disabled ? (
          <button type="button" className="pt-icon-btn text-muted-foreground" onClick={() => onChange(null)} aria-label={t("portal.upload.remove")}>
            <CloseIcon size={18} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className={cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2")}>
        <FilePicker
          accept="image/*"
          capture="environment"
          label={t("portal.upload.takePhoto")}
          disabled={disabled || busy}
          onPick={(f) => void pick(f)}
          trigger={
            <span className="pt-card pt-card-press flex h-full flex-col items-center justify-center gap-2 px-3 py-5 text-center">
              <span className="pt-icon-disc">
                <CameraIcon />
              </span>
              <span className="text-sm font-semibold text-foreground">{t("portal.upload.takePhoto")}</span>
            </span>
          }
        />
        <FilePicker
          accept={UPLOAD_ACCEPT}
          label={t("portal.upload.chooseFile")}
          disabled={disabled || busy}
          onPick={(f) => void pick(f)}
          trigger={
            <span className="pt-card pt-card-press flex h-full flex-col items-center justify-center gap-2 px-3 py-5 text-center">
              <span className="pt-icon-disc" data-tone="info">
                <UploadIcon />
              </span>
              <span className="text-sm font-semibold text-foreground">{t("portal.upload.chooseFile")}</span>
            </span>
          }
        />
      </div>
      {busy ? <p className="mt-2 text-xs text-muted-foreground">{t("portal.upload.preparing")}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The bar: 0→100% while bytes go up, then a tick once the server answered. */
export function UploadProgress({ pct, done }: { pct: number; done: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-sm">
        {done ? (
          <span className="inline-flex items-center gap-2 font-semibold text-[rgb(var(--ok))]">
            <CheckCircleIcon size={18} />
            {t("portal.upload.complete")}
          </span>
        ) : (
          <span className="font-medium text-foreground">{t("portal.upload.sending")}</span>
        )}
        <span className="pt-num text-muted-foreground">{done ? 100 : pct}%</span>
      </div>
      <div className="pt-progress" data-tone={done ? "ok" : undefined}>
        <span style={{ width: `${done ? 100 : Math.max(4, pct)}%` }} />
      </div>
    </div>
  );
}
