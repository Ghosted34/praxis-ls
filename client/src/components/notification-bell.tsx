/**
 * Notification bell — the topbar affordance. Shows the unread badge (count comes
 * from the app-shell poll) and, on click, a dropdown of the most recent
 * notifications with per-item and bulk "mark read". Deep links to the full
 * inbox at /notifications. Reads /notifications on open; writes go to the
 * existing mark-read endpoints, then ask the shell to re-poll the badge.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { tenant } from "@/lib/api-client";

type Notif = {
  notification_id: string;
  title: string;
  body?: string | null;
  priority?: string | null;
  read_at?: string | null;
  created_at?: string | null;
};

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const BellGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export function NotificationBell({ count = 0, onChange }: { count?: number; onChange?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Notif[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const load = React.useCallback(async () => {
    try {
      const data = await tenant<Notif[]>("/notifications");
      setRows(Array.isArray(data) ? data.slice(0, 8) : []);
    } catch {
      setRows([]);
    }
  }, []);

  React.useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function markRead(id: string) {
    setBusy(id);
    try {
      await tenant(`/notifications/${id}/read`, { method: "POST" });
      setRows((r) => (r ? r.map((n) => (n.notification_id === id ? { ...n, read_at: new Date().toISOString() } : n)) : r));
      onChange?.();
    } catch {
      /* ignore — next poll reconciles */
    } finally {
      setBusy(null);
    }
  }

  async function markAll() {
    setBusy("__all");
    try {
      await tenant("/notifications/read-all", { method: "POST" });
      setRows((r) => (r ? r.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })) : r));
      onChange?.();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative" ref={ref} data-navarea>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative hidden h-9 w-9 place-items-center rounded-xl border text-muted-foreground transition-colors hover:text-foreground sm:grid"
      >
        <BellGlyph />
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{ background: "var(--popover)" }}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-80 animate-fade-in overflow-hidden rounded-xl border bg-popover shadow-l"
        >
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {count > 0 && (
              <button
                type="button"
                onClick={markAll}
                disabled={busy === "__all"}
                className="text-xs font-medium text-[rgb(var(--primary))] transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {rows === null ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">You're all caught up.</div>
            ) : (
              rows.map((n) => (
                <button
                  type="button"
                  key={n.notification_id}
                  onClick={() => !n.read_at && markRead(n.notification_id)}
                  disabled={busy === n.notification_id}
                  className="flex w-full gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-accent/50"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                      n.read_at ? "bg-transparent" : String(n.priority).toUpperCase() === "HIGH" ? "bg-[rgb(var(--bad))]" : "bg-[rgb(var(--primary))]"
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${n.read_at ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
                      {n.title}
                    </span>
                    {n.body && <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t px-3 py-2.5 text-center text-sm font-medium text-[rgb(var(--primary))] transition-colors hover:bg-accent/50"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
