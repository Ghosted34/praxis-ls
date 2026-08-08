/**
 * The bell — spec §3.3's in-house channel, receiving end.
 *
 * This is the surface that made escalation's `action_inhouse` mean something.
 * Before it existed, an escalation emitted a socket event to whoever had the
 * console open at that instant and wrote a row to error_escalation_log that
 * nothing rendered. For a rule whose entire purpose is to catch a 3am outage,
 * "whoever is currently looking" is nobody.
 *
 * TWO SOURCES, ONE LIST
 *
 *   Poll and socket, deliberately both. The socket gives an instant badge for
 *   anyone already watching; the poll is what makes a notification survive a
 *   closed laptop, a redeploy, or the WebSocket being blocked by a corporate
 *   proxy. Neither is sufficient — the poll alone feels dead, the socket alone
 *   IS the bug this component was written to close.
 *
 *   The poll is a COUNT, not a list. The dropdown fetches rows only when it is
 *   opened, so an idle console costs one integer a minute rather than thirty
 *   rows of error text.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorsApi, ago, type Notification } from "@/lib/errors-api";
import { session } from "@/lib/api";

/** Slow enough to be free, fast enough that the badge is not stale on arrival. */
const POLL_MS = 60_000;

export function NotificationBell() {
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const { unread: n } = await errorsApi.unreadCount();
      setUnread(n);
    } catch {
      // A failed count must not surface as an error toast on every page. The
      // bell simply keeps its last known value.
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      setItems(await errorsApi.notifications({ limit: 20 }));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const t = window.setInterval(() => void refreshCount(), POLL_MS);
    return () => window.clearInterval(t);
  }, [refreshCount]);

  /**
   * Live push. Reuses the console's existing /platform socket and its per-user
   * room rather than opening a second connection — the same handshake already
   * carries the token and the capability check.
   *
   * Dynamically imported for the same reason useErrorStream does it: the bell
   * must degrade to polling, not disappear, if the realtime chunk fails to load.
   */
  useEffect(() => {
    if (!session.token) return undefined;
    let socket: { on: (e: string, f: (...a: unknown[]) => void) => void; disconnect: () => void } | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const mod = await import("socket.io-client");
        const origin = new URL(session.base, window.location.origin).origin;
        const s = mod.io(`${origin}/platform`, {
          auth: { token: session.token },
          transports: ["websocket", "polling"],
          tryAllTransports: true,
          reconnection: true,
        });
        if (cancelled) return s.disconnect();

        s.on("notification", (msg: unknown) => {
          const payload = (msg as { payload?: Notification })?.payload;
          if (!payload) return;
          setUnread((n) => n + 1);
          // Prepend only when the panel is already open; otherwise the next
          // open fetches fresh and this would just be a second source of truth.
          setItems((cur) => (cur ? [payload, ...cur].slice(0, 20) : cur));
        });

        socket = s as unknown as typeof socket;
        return undefined;
      } catch {
        return undefined; // polling covers it
      }
    })();

    return () => {
      cancelled = true;
      try {
        socket?.disconnect();
      } catch {
        /* already gone */
      }
    };
  }, []);

  // Click-outside close. Without it the panel stays open behind a route change
  // and looks like a rendering bug.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    setOpen((o) => {
      if (!o) void loadItems();
      return !o;
    });
  };

  /**
   * Opening a notification marks it read and navigates to the error it is
   * about. Marking read on CLICK rather than on panel-open is the difference
   * between "I have seen this" and "I have dismissed twelve things I did not
   * read" — the second makes the unread count worthless within a week.
   */
  const openNotification = async (n: Notification) => {
    setOpen(false);
    if (!n.read_at) {
      setUnread((c) => Math.max(0, c - 1));
      try {
        await errorsApi.markNotificationRead(n.id);
      } catch {
        void refreshCount(); // put the true number back
      }
    }
    const errorId = n.metadata && (n.metadata.error_id as string | undefined);
    if (errorId) nav(`/error-center?id=${encodeURIComponent(errorId)}`);
  };

  const markAll = async () => {
    try {
      await errorsApi.markAllNotificationsRead();
      setUnread(0);
      setItems((cur) => cur?.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })) ?? cur);
    } catch {
      void refreshCount();
    }
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn ghost sm"
        onClick={toggle}
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        style={{ position: "relative", fontSize: 15, lineHeight: 1, padding: "6px 9px" }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, padding: "0 4px",
              borderRadius: 9, background: "#991B1B", color: "#fff",
              fontSize: 10, fontWeight: 700, lineHeight: "17px", textAlign: "center",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, width: 340,
            background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,.4)", overflow: "hidden",
          }}
        >
          <div className="row between" style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)" }}>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>Notifications</div>
            {unread > 0 && (
              <button type="button" className="btn ghost sm" onClick={() => void markAll()} style={{ fontSize: 11 }}>
                Mark all read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {items === null ? (
              <div className="muted" style={{ padding: 16, fontSize: 12 }}>Loading…</div>
            ) : items.length === 0 ? (
              <div className="muted" style={{ padding: 16, fontSize: 12 }}>
                Nothing yet. Escalation rules and shared errors land here.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void openNotification(n)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
                    background: n.read_at ? "transparent" : "rgba(153,27,27,.10)",
                    border: 0, borderBottom: "1px solid var(--line-2)", cursor: "pointer", color: "inherit",
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: n.read_at ? 500 : 650, marginBottom: 2 }}>
                    {n.title}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {n.body.length > 160 ? `${n.body.slice(0, 159)}…` : n.body}
                  </div>
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
                    {n.from_name ? `${n.from_name} · ` : ""}{ago(n.created_at)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
