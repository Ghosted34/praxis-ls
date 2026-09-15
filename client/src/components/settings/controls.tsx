/**
 * Shared building blocks for the Settings editors (Appearance, Login screen).
 * ImageField reuses the existing branding upload (uploadImage → POST
 * /branding/logo), so there's one upload path for logos, favicon, backgrounds
 * and per-business logos. `Soon` marks controls whose value is edited/sent but
 * not yet persisted by the backend (branding schema is being extended — see
 * doc/FE_IA_HANDOFF.md).
 */
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { uploadImage } from "@/lib/branding";
import { ApiError } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { FilePicker } from "@/components/ui/image-upload";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl, type UploadProfile } from "@/lib/image-compress";

/** "pending backend" badge. */
export function Soon({ className }: { className?: string }) {
  return (
    <span
      className={cn("status st-warn !px-2 !py-0.5 !text-[9px]", className)}
      title="Editable now; persistence pending a backend field."
    >
      pending backend
    </span>
  );
}

export function SettingsCard({
  title,
  desc,
  soon,
  children,
  className,
}: {
  title: string;
  desc?: string;
  soon?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("lux-card p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg tracking-tight">{title}</h2>
          {desc && (
            <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
          )}
        </div>
        {soon && <Soon />}
      </div>
      {children}
    </div>
  );
}

export function Field({
  label,
  soon,
  children,
}: {
  label: string;
  soon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <Label>{label}</Label>
        {soon && <Soon />}
      </span>
      {children}
    </div>
  );
}

/** @deprecated Import `Textarea` from `@/components/ui/textarea` instead. This
 *  was one of the three local class constants F6 counted; it now just forwards,
 *  so existing settings screens keep working while they migrate. */
export function TextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return <Textarea {...props} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
      <span>
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        {hint && (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 flex-none rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border bg-accent/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A labelled range input with its live value. Used by the App & PWA editor for
 * the icon transform, where the control has to be continuous — the whole point
 * is nudging a mark until it sits right inside a circular crop, which is not a
 * thing anyone can type.
 *
 * Native `<input type="range">` rather than a custom widget: it is already
 * keyboard-operable, already announces its value, and already respects the
 * platform's pointer conventions.
 */
export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "",
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-5 w-full cursor-pointer accent-primary"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ColorRow({
  token,
  value,
  onChange,
}: {
  token: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const safe = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : "#000000";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 flex-none cursor-pointer rounded border bg-transparent p-0.5"
        aria-label={token}
      />
      <code className="w-24 flex-none text-[11px] text-muted-foreground">
        {token}
      </code>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
}

/**
 * Image upload/preview/clear, reusing the branding upload endpoint. Returns the
 * stored /media URL via onChange. `shape` controls the thumbnail box.
 */
export function ImageField({
  label,
  value,
  onChange,
  soon,
  maxBytes = 512_000,
  hint,
  shape = "logo",
  upload,
  profile = "brand",
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  soon?: boolean;
  maxBytes?: number;
  hint?: string;
  shape?: "logo" | "square" | "wide";
  /**
   * Custom uploader returning the stored URL; defaults to the branding logo
   * upload. The second argument reports real upload progress — XHR gives it for
   * a JSON body too, so an uploader that ignores it still works but drives a
   * bar that only jumps.
   */
  upload?: (
    dataUrl: string,
    onProgress: (percent: number) => void,
  ) => Promise<string>;
  /**
   * What this picture IS, which decides whether it is tonally corrected.
   * Defaults to "brand" — the conservative choice for this control, because
   * most of its call sites are a tenant's logo or app icon and auto-levelling
   * one hands them back a slightly different colour on every screen. Pass
   * "photo" for an actual photograph, like the site hero.
   */
  profile?: UploadProfile;
}) {
  const [err, setErr] = React.useState<string | null>(null);

  const box =
    shape === "square"
      ? "h-12 w-12"
      : shape === "wide"
        ? "h-12 w-20 object-cover"
        : "h-8 w-auto max-w-[80px]";

  /**
   * Through the upload engine: compression before the bytes leave the device,
   * a preview of the NEW file (not just the already-saved `value`), and a real
   * percentage. Uploads on pick — there is no Save button on this control, the
   * stored URL is the state.
   */
  const uploader = useUpload<string>({
    profile,
    maxBytes,
    send: async (file, ctx) => {
      const dataUrl = await fileToDataUrl(file);
      return upload
        ? await upload(dataUrl, ctx.onProgress)
        : (await uploadImage(dataUrl, ctx.onProgress)).logoUrl;
    },
    onAllComplete: ([url]) => {
      if (url) onChange(url);
    },
  });

  const item = uploader.items[0] ?? null;
  const uploading =
    item?.state === "uploading" || item?.state === "compressing";

  React.useEffect(() => {
    if (item?.state !== "error") return;
    const cause = item.errorCause;
    setErr(
      cause instanceof ApiError && cause.status === 403
        ? "You need Settings edit permission to upload."
        : cause instanceof ApiError
          ? cause.message
          : item.error || "Upload failed. Try a smaller image, or paste a URL.",
    );
  }, [item?.state, item?.error, item?.errorCause]);

  function onFile(file?: File | null) {
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith("image/")) {
      return setErr("That's not an image file.");
    }
    void uploader.pick([file]);
  }

  return (
    <Field label={label} soon={soon}>
      {/* The drop target adds a POINTER-ONLY shortcut on top of FilePicker's
          own control, which is what keyboard and AT users activate — so the
          drag handlers below are an enhancement, not the control. That is the
          same justification the <label> here carried before; only the rule name
          changes, because this is a <div> now. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files?.[0]);
        }}
        className="flex items-center gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
      >
        {/* The preview shows the file being uploaded the moment it is picked,
            and falls back to the already-stored image. Before this, a failed or
            slow upload left the OLD logo on screen with no sign anything had
            happened. */}
        {item?.previewUrl || value ? (
          <img
            src={item?.previewUrl || value}
            alt=""
            className={cn("rounded", box)}
          />
        ) : (
          <span
            className={cn(
              "flex items-center justify-center rounded bg-muted",
              shape === "logo" ? "h-8 w-8" : box,
            )}
          >
            <span className="text-xs">IMG</span>
          </span>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <FilePicker
            variant="inline"
            accept="image/*"
            disabled={uploading}
            trigger={
              uploading
                ? "Uploading…"
                : value
                  ? "Replace"
                  : "Drop an image or click to upload"
            }
            onPick={(files) => onFile(files?.[0])}
          />
          {item && item.state !== "idle" && (
            <UploadProgress
              state={item.state}
              percent={item.percent}
              error={item.error}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={value.startsWith("data:") ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste a hosted URL"
          className="h-8 text-xs"
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
          >
            Clear
          </Button>
        )}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </Field>
  );
}
