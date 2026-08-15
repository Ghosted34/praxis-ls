/**
 * Notification bell — the topbar affordance. Shows the unread badge (count comes
 * from the app-shell poll) and, on click, a dropdown of the most recent
 * notifications with per-item and bulk "mark read". Deep links to the full
 * inbox at /notifications. Reads /notifications on open; writes go to the
 * existing mark-read endpoints, then ask the shell to re-poll the badge.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Popover } from "@/components/ui/popover";
import { tenant } from "@/lib/api-client";
import { LoadingRow } from "@/components/ui/states";

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
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export function NotificationBell({
  count = 0,
  onChange,
}: {
  count?: number;
  onChange?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Notif[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  // The hand-rolled outside-click listener that used to live here is gone:
  // Radix dismisses on outside pointer-down AND on Escape, and restores focus
  // to the trigger — none of which the manual version did.

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
      setRows((r) =>
        r
          ? r.map((n) =>
              n.notification_id === id
                ? { ...n, read_at: new Date().toISOString() }
                : n,
            )
          : r,
      );
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
      setRows((r) =>
        r
          ? r.map((n) => ({
              ...n,
              read_at: n.read_at || new Date().toISOString(),
            }))
          : r,
      );
      onChange?.();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  }

  // This popup was the third role="menu" in the audit (F13) — and it was never a
  // menu at all. A menuitem may not contain interactive children, and every row
  // here carries its own mark-read button. So it declared menu keyboard
  // semantics it did not implement AND nested controls where the role forbids
  // them. A Popover is the correct pattern: Tab moves through the rows as
  // ordinary content, Escape closes, and focus returns to the bell.
  return (
    <div data-navarea>
      <Popover
        label="Notifications"
        open={open}
        onOpenChange={setOpen}
        className="w-80"
        trigger={
          <button
            type="button"
            aria-label={
              count > 0 ? `Notifications (${count} unread)` : "Notifications"
            }
            className="relative hidden h-9 w-9 place-items-center rounded-md border text-muted-foreground transition-colors hover:text-foreground sm:grid"
          >
            <BellGlyph />
            {count > 0 && (
              <span
                aria-hidden
                className="absolute -right-1.5 -top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground"
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        }
      >
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">
            Notifications
          </h2>
          {count > 0 && (
            <button
              type="button"
              onClick={markAll}
              disabled={busy === "__all"}
              className="text-xs font-medium text-primary-ink transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* aria-live so an arriving notification is announced, not just drawn.
            The audit found 3 live regions in ~40,000 lines (F13). */}
        <div
          className="max-h-[22rem] overflow-y-auto"
          aria-live="polite"
          aria-busy={rows === null}
        >
          {rows === null ? (
            <LoadingRow />
          ) : rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {rows.map((n) => (
                <li key={n.notification_id}>
                  <button
                    type="button"
                    onClick={() => !n.read_at && markRead(n.notification_id)}
                    disabled={busy === n.notification_id}
                    className="flex w-full gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-accent/50"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                        n.read_at
                          ? "bg-transparent"
                          : String(n.priority).toUpperCase() === "HIGH"
                            ? "bg-[rgb(var(--bad))]"
                            : "bg-[rgb(var(--primary))]"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      {/* The unread state was conveyed by a coloured dot and bold
                          weight only — both invisible to a screen reader. */}
                      {!n.read_at && <span className="sr-only">Unread. </span>}
                      <span
                        className={`block truncate text-sm ${n.read_at ? "text-muted-foreground" : "font-semibold text-foreground"}`}
                      >
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-0.5 block text-micro text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link
          to="/notifications"
          onClick={() => setOpen(false)}
          className="block border-t px-3 py-2.5 text-center text-sm font-medium text-primary-ink transition-colors hover:bg-accent/50"
        >
          View all notifications
        </Link>
      </Popover>
    </div>
  );
}
