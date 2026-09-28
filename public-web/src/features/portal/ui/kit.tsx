/**
 * The portal's building blocks: sheets, toasts, pills, switches, fields,
 * skeletons, empty states, and the one data hook every screen loads through.
 *
 * Small on purpose. A client portal is five screens and a handful of sheets,
 * and every one of them should feel like the same app — the way a phone's own
 * apps do — which only happens if they are made of the same few pieces.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PortalError } from "@/lib/portal-api";
import { CloseIcon, EyeIcon, EyeOffIcon, InfoIcon, CheckCircleIcon, AlertIcon } from "./icons";

/* ── the layer sheets and toasts render into ────────────────────────────── */

/**
 * Sheets render into a layer INSIDE `.pt-root`, not into `document.body`.
 * The portal's utilities are scoped under `.pt-root` (tailwind.portal.config),
 * so a sheet portalled to the body would lose every class it uses. The layer is
 * still outside every card, so no ancestor transform can capture a fixed sheet.
 */
export const LayerContext = React.createContext<HTMLElement | null>(null);

/* ── errors, in the reader's language ───────────────────────────────────── */

/**
 * The server writes its messages in English for the log. What a client reads
 * comes from the dictionary, keyed by the error CODE — so a French client never
 * gets an English sentence in the middle of a French screen. An unmapped code
 * reads as the generic line rather than as the server's words.
 */
export function errorText(e: unknown): string {
  if (e instanceof PortalError) {
    const key = `portal.err.${e.code}`;
    if (i18n.exists(key)) return String(i18n.t(key));
    if (e.code === "OFFLINE") return String(i18n.t("portal.offline"));
  }
  return String(i18n.t("portal.err.generic"));
}

/* ── data ───────────────────────────────────────────────────────────────── */

export type Load<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

/**
 * Load once per `key`, keep the last data while reloading (so a pull to refresh
 * never flashes a skeleton over content the person was reading), and report an
 * error as a sentence. `loader` is read through a ref so a new closure on every
 * render does not re-run the read — `key` is what decides that.
 */
export function useLoad<T>(loader: () => Promise<T>, key: string): Load<T> {
  const ref = React.useRef(loader);
  ref.current = loader;
  const [tick, setTick] = React.useState(0);
  const [state, setState] = React.useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  React.useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    ref
      .current()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e) => alive && setState((s) => ({ ...s, error: errorText(e), loading: false })));
    return () => {
      alive = false;
    };
  }, [key, tick]);
  const reload = React.useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

/* ── sheet ──────────────────────────────────────────────────────────────── */

let openSheets = 0;
/**
 * Open sheets, oldest first. A sheet can open over another (the quote sheet's
 * place search opens over the quote sheet), and both register a key handler on
 * the document — so without this, Escape closed BOTH and threw away a
 * half-filled quote, and the lower sheet's Tab trap fought the upper one's.
 * Only the top of the stack answers keys.
 */
const sheetStack: symbol[] = [];

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  full = false,
  wide = false,
  bare = false,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  full?: boolean;
  wide?: boolean;
  /** The children ARE the panel — their own header, scroller and footer (the chat). */
  bare?: boolean;
  className?: string;
  labelledBy?: string;
}) {
  const layer = React.useContext(LayerContext);
  const { t } = useTranslation();
  const panel = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  // Read through a ref: callers pass an inline arrow, and depending on it would
  // re-run this effect on every keystroke inside the sheet — stealing focus
  // back to the first field mid-word.
  const close = React.useRef(onClose);
  close.current = onClose;
  /**
   * How many sheets were already open when this one opened. Read at render,
   * before this sheet's own effect pushes it, so the first paint is already
   * right. A sheet opened over another has to sit ABOVE it, scrim included —
   * with one shared z-index the upper scrim painted under the lower sheet and
   * the search looked pasted onto an undimmed quote.
   */
  const depth = React.useRef(-1);
  if (!open) depth.current = -1;
  else if (depth.current < 0) depth.current = sheetStack.length;
  const lift = depth.current > 0 ? depth.current * 2 : 0;

  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const me = Symbol("sheet");
    sheetStack.push(me);
    openSheets += 1;
    document.body.style.overflow = "hidden";
    // First focusable, or the panel itself, so a screen reader lands inside.
    const first = panel.current?.querySelector<HTMLElement>(
      "[data-autofocus], input, textarea, select, button:not([data-close])",
    );
    (first || panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (sheetStack[sheetStack.length - 1] !== me) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      sheetStack.splice(sheetStack.indexOf(me), 1);
      openSheets -= 1;
      if (openSheets <= 0) document.body.style.overflow = "";
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const node = (
    <>
      <div className="pt-scrim" onClick={onClose} aria-hidden="true" style={lift ? { zIndex: 60 + lift } : undefined} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
        tabIndex={-1}
        className={cn("pt-sheet outline-none", className)}
        style={lift ? { zIndex: 61 + lift } : undefined}
        data-full={full || undefined}
        data-wide={wide || undefined}
      >
        {bare ? (
          children
        ) : (
          <>
            <div className="pt-sheet-grip" aria-hidden="true" />
            {title ? (
              <div className="flex items-center gap-3 px-5 pb-2 pt-3 md:pt-5">
                <h2 id={titleId} className="pt-display min-w-0 flex-1 text-[1.3rem]">
                  {title}
                </h2>
                <button type="button" data-close onClick={onClose} className="pt-icon-btn -mr-2" aria-label={t("portal.common.close")}>
                  <CloseIcon size={20} />
                </button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-1">{children}</div>
            {footer ? <div className="border-t border-[var(--pt-line)] px-5 py-4">{footer}</div> : null}
          </>
        )}
      </div>
    </>
  );
  return layer ? createPortal(node, layer) : node;
}

/* ── toasts ─────────────────────────────────────────────────────────────── */

type Toast = { id: number; text: string; tone: "ok" | "bad" };
const ToastContext = React.createContext<(text: string, tone?: "ok" | "bad") => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((l) => [...l.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 3600);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pt-toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className="pt-toast">
            {x.tone === "ok" ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => React.useContext(ToastContext);

/* ── small pieces ───────────────────────────────────────────────────────── */

export type Tone = "ok" | "warn" | "bad" | "info" | "brand" | "mute";

export function Pill({ tone = "mute", children, plain, className }: { tone?: Tone; children: React.ReactNode; plain?: boolean; className?: string }) {
  return (
    <span className={cn("pt-pill", className)} data-tone={tone === "mute" ? undefined : tone} data-plain={plain || undefined}>
      {children}
    </span>
  );
}

export function IconDisc({ tone, children, size = 44, className }: { tone?: Tone; children: React.ReactNode; size?: number; className?: string }) {
  return (
    <span className={cn("pt-icon-disc", className)} data-tone={tone} style={size !== 44 ? { width: size, height: size, borderRadius: size * 0.32 } : undefined}>
      {children}
    </span>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: React.ReactNode; count?: number; aria?: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("pt-seg", className)} role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.value} type="button" className="pt-seg-item" aria-pressed={value === it.value} aria-label={it.aria} onClick={() => onChange(it.value)}>
          {it.label}
          {typeof it.count === "number" && it.count > 0 ? <span className="pt-seg-count pt-num">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="pt-switch disabled:opacity-50"
      onClick={() => onChange(!checked)}
    />
  );
}

export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const src = (name || "").trim() || (email || "").split("@")[0] || "";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const two = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : src.slice(0, 2);
  return two.toUpperCase();
}

export function Avatar({ name, email, size = 40, className }: { name?: string | null; email?: string | null; size?: number; className?: string }) {
  return (
    <span className={cn("pt-avatar", className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {initialsOf(name, email)}
    </span>
  );
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("pt-shimmer", className)} aria-hidden="true" />;
}

/** A card-shaped placeholder list — the page's shape before its data. */
export function SkeletonCards({ count = 3, className }: { count?: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("grid gap-3", className)} role="status" aria-label={t("portal.common.loading")}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="pt-card flex items-center gap-4 p-4">
          <Shimmer className="h-11 w-11 rounded-[14px]" />
          <div className="grid flex-1 gap-2">
            <Shimmer className="h-4 w-2/5" />
            <Shimmer className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
  tone = "brand",
  className,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <IconDisc tone={tone} size={60}>
        {icon}
      </IconDisc>
      <p className="mt-4 text-base font-semibold text-foreground">{title}</p>
      {hint ? <p className="mt-1 max-w-xs text-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="pt-card flex items-center gap-3 p-4" role="alert">
      <IconDisc tone="bad" size={40}>
        <AlertIcon size={20} />
      </IconDisc>
      <p className="min-w-0 flex-1 text-sm text-foreground">{message}</p>
      {onRetry ? (
        <button type="button" className="pt-btn pt-btn-soft pt-btn-sm" onClick={onRetry}>
          {t("portal.common.retry")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The ⓘ that holds the explanation a screen used to print as a paragraph.
 * The owner's rule for the portal: nothing wordy at first glance; the detail is
 * one tap away for whoever wants it.
 */
export function InfoButton({ title, children, label, className, onDark }: { title: React.ReactNode; children: React.ReactNode; label: string; className?: string; onDark?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        className={cn(onDark ? "pt-glass-chip !h-9 !w-9 !justify-center !p-0" : "pt-icon-btn text-muted-foreground", className)}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <InfoIcon size={onDark ? 18 : 20} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {children}
      </Sheet>
    </>
  );
}

/* ── fields ─────────────────────────────────────────────────────────────── */

export function TextField({
  label,
  id,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id?: string }) {
  const auto = React.useId();
  const fid = id || auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="pt-label">
        {label}
      </label>
      <input id={fid} className="pt-field" {...rest} />
    </div>
  );
}

export function TextArea({
  label,
  id,
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; id?: string }) {
  const auto = React.useId();
  const fid = id || auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="pt-label">
        {label}
      </label>
      <textarea id={fid} className="pt-field" {...rest} />
    </div>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = "current-password",
  autoFocus,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const [show, setShow] = React.useState(false);
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="pt-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          className="pt-field pr-14"
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="pt-icon-btn absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-label={show ? t("portal.signin.hidePassword") : t("portal.signin.showPassword")}
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
        >
          {show ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
        </button>
      </div>
    </div>
  );
}

/** In a button: a spinner INSTEAD of the icon while its action runs. */
export function Busy({ busy, children }: { busy: boolean; children?: React.ReactNode }) {
  return busy ? <span className="pt-spinner animate-spin" aria-hidden="true" /> : <>{children}</>;
}

/** Where a wizard is: one dot per step, the current one stretched. */
export function StepDots({ count, at, label }: { count: number; at: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5" role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={count} aria-valuenow={at + 1}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-[width,background-color] duration-200",
            i === at ? "w-6 bg-[var(--primary)]" : i < at ? "w-1.5 bg-[var(--primary)]" : "w-1.5 bg-[var(--pt-line-strong)]",
          )}
        />
      ))}
    </div>
  );
}

/** A value a client will type into their bank's app — one tap copies it. */
export function CopyRow({ label, value, mono = true }: { label: string; value: string | null | undefined; mono?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  if (!value) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* class D, best-effort — the value is on screen to read instead */
    }
  }
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className={cn("truncate text-[0.95rem] font-semibold text-foreground", mono && "pt-mono")}>{value}</p>
      </div>
      <button type="button" className="pt-btn pt-btn-soft pt-btn-sm shrink-0" onClick={() => void copy()}>
        {copied ? t("portal.common.copied") : t("portal.common.copy")}
      </button>
    </div>
  );
}

/**
 * "Are you sure?" as a sheet in the tenant's own colours — never the browser's
 * `confirm()` (CLAUDE.md). The title names the outcome, the button names the
 * action, and a destructive one looks destructive.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col items-center pb-1 pt-3 text-center">
        <IconDisc tone={destructive ? "bad" : "brand"} size={60}>
          <AlertIcon size={28} />
        </IconDisc>
        <h2 className="pt-display mt-4 text-[1.4rem]">{title}</h2>
        {body ? <p className="mt-2 max-w-sm text-[0.95rem] text-muted-foreground">{body}</p> : null}
        <div className="mt-6 grid w-full gap-2">
          <button type="button" className={cn("pt-btn pt-btn-block", destructive ? "pt-btn-danger" : "pt-btn-primary")} onClick={onConfirm} disabled={busy}>
            <Busy busy={busy} />
            {confirmLabel}
          </button>
          <button type="button" className="pt-btn pt-btn-ghost pt-btn-block" onClick={onClose} disabled={busy}>
            {t("portal.common.cancel")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
