import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { titleCase } from "@/lib/format";

/* Button ------------------------------------------------------------------ */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "default";
  size?: "sm" | "md";
  loading?: boolean;
};
export function Button({ variant = "default", size = "md", loading, children, className = "", disabled, ...rest }: BtnProps) {
  const cls = ["btn", variant !== "default" ? variant : "", size === "sm" ? "sm" : "", className].filter(Boolean).join(" ");
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spin" /> : children}
    </button>
  );
}

/* Field ------------------------------------------------------------------- */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className="f">{label}</label>
      {children}
      {hint && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/* Pills ------------------------------------------------------------------- */
type Tone = "ok" | "warn" | "bad" | "info" | "mute";
export function Pill({ tone = "mute", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={"pill " + tone}>{children}</span>;
}

export function StatusPill({ status, isLive }: { status?: string | null; isLive?: boolean }) {
  const s = String(status || "").toUpperCase();
  const tone: Tone = s === "LIVE" ? "ok" : s === "SUSPENDED" ? "bad" : s === "ARCHIVED" ? "mute" : "warn";
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={"pill " + tone}>
        <span className="dot" style={{ background: "currentColor" }} />
        {titleCase(s || "unknown")}
      </span>
      {isLive && <Pill tone="info">Live</Pill>}
    </span>
  );
}

export function SourcePill({ source }: { source: string }) {
  const map: Record<string, Tone> = { override: "info", plan: "ok", default: "mute" };
  return <Pill tone={map[source] || "mute"}>{titleCase(source)}</Pill>;
}

/* Card -------------------------------------------------------------------- */
export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={"card " + className}>
      {(title || actions) && (
        <div className="hd">
          <h3 style={{ fontSize: 15 }}>{title}</h3>
          {actions}
        </div>
      )}
      <div className="bd">{children}</div>
    </div>
  );
}

/* Page header ------------------------------------------------------------- */
export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="pagehd between wrap">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {actions}
    </div>
  );
}

/* Loading / empty --------------------------------------------------------- */
export function Loading() {
  return (
    <div className="center-load">
      <span className="spin" />
      <span>Loading…</span>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="card"><div className="empty">{children}</div></div>;
}

/* Modal ------------------------------------------------------------------- */
export function Modal({ title, children, footer, onClose, maxWidth }: { title: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; maxWidth?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" style={maxWidth ? { maxWidth } : undefined}>
        <div className="hd"><h3>{title}</h3></div>
        <div className="bd">{children}</div>
        {footer && <div className="ft">{footer}</div>}
      </div>
    </div>
  );
}

/* Confirm dialog ---------------------------------------------------------- */
export function ConfirmModal({ title, body, confirmLabel = "Confirm", danger, onConfirm, onClose }: {
  title: string; body: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => Promise<unknown> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={go} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="dim" style={{ fontSize: 13.5 }}>{body}</div>
    </Modal>
  );
}
