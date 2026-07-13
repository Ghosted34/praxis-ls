/**
 * Shared building blocks for the Settings editors (Appearance, Login screen).
 * ImageField reuses the existing branding upload (uploadImage → POST
 * /branding/logo), so there's one upload path for logos, favicon, backgrounds
 * and per-business logos. `Soon` marks controls whose value is edited/sent but
 * not yet persisted by the backend (branding schema is being extended — see
 * doc/FE_IA_HANDOFF.md).
 */
import * as React from "react";
import { uploadImage } from "@/lib/branding";
import { ApiError } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

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
          {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
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

const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(TEXTAREA_CLASS, props.className)} />;
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
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
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
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
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
      <code className="w-24 flex-none text-[11px] text-muted-foreground">{token}</code>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" />
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
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  soon?: boolean;
  maxBytes?: number;
  hint?: string;
  shape?: "logo" | "square" | "wide";
}) {
  const [uploading, setUploading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const box =
    shape === "square" ? "h-12 w-12" : shape === "wide" ? "h-12 w-20 object-cover" : "h-8 w-auto max-w-[80px]";

  async function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Could not read the file"));
      r.readAsDataURL(file);
    });
  }

  async function onFile(file?: File | null) {
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith("image/")) return setErr("That's not an image file.");
    if (file.size > maxBytes) return setErr(`Image must be ${Math.round(maxBytes / 1024)} KB or smaller.`);
    setUploading(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const { logoUrl: url } = await uploadImage(dataUrl);
      onChange(url);
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 403
          ? "You need Settings (MOD-70) edit permission to upload."
          : e instanceof ApiError
            ? e.message
            : "Upload failed. Try a smaller image or paste a URL.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <Field label={label} soon={soon}>
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files?.[0]);
        }}
        className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground hover:bg-accent/40"
      >
        {value ? (
          <img src={value} alt="" className={cn("rounded", box)} />
        ) : (
          <span className={cn("flex items-center justify-center rounded bg-muted", shape === "logo" ? "h-8 w-8" : box)}>
            <span className="text-xs">IMG</span>
          </span>
        )}
        <span>{uploading ? "Uploading…" : value ? "Replace" : "Drop an image or click to upload"}</span>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <div className="flex items-center gap-2">
        <Input
          value={value.startsWith("data:") ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste a hosted URL"
          className="h-8 text-xs"
        />
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Clear
          </Button>
        )}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </Field>
  );
}
