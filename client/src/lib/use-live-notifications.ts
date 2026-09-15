/**
 * Notifications, the moment they are written.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * The bell's badge is a 60-second poll that pauses while the tab is hidden
 * (app-shell.tsx, PERF S15). Pausing it was right — it was 33 req/s of polling
 * nobody was looking at — but it left the in-app answer to "has anything
 * happened" up to a minute stale on a screen somebody IS looking at, with no
 * sound and no toast to cover the gap. For a cash request awaiting approval,
 * that minute is a truck not loading.
 *
 * The server now announces each row on the recipient's own socket room the
 * instant it is committed (notification.service `announce`). This subscribes to
 * that. The poll stays exactly as it was and becomes the RECONCILER: it catches
 * anything written while the socket was down, the tab was asleep, or the user
 * was on another device.
 *
 * It rides the SHARED Smart Comms socket rather than opening a second
 * connection — same authenticated socket, same tenant resolution. The room is
 * joined server-side from the authenticated user id, so there is nothing to
 * subscribe to here and nothing a client could ask for that isn't theirs.
 */
import * as React from "react";
import { getCommsSocket } from "./comms-socket";

export type LiveNotification = {
  notification_id: string;
  title: string;
  body?: string | null;
  priority?: string | null;
  category?: string | null;
  link_url?: string | null;
  /** Resolved per-recipient on the server from their INTERRUPT preference —
   *  never re-derived here, or two people in one channel would disagree. */
  interrupt?: boolean | null;
  created_at?: string | null;
};

/**
 * Call `onArrive` for every notification addressed to this user.
 *
 * The handler is held in a ref so a caller may pass an inline closure without
 * tearing the socket listener down and rebuilding it on every render — which,
 * on a component that re-renders whenever the badge count changes, would mean
 * unsubscribing and resubscribing on the very event it just handled.
 */
export function useLiveNotifications(
  onArrive: (n: LiveNotification) => void,
  enabled = true,
): void {
  const ref = React.useRef(onArrive);
  React.useEffect(() => {
    ref.current = onArrive;
  }, [onArrive]);

  React.useEffect(() => {
    if (!enabled) return;
    let socket: ReturnType<typeof getCommsSocket>;
    try {
      socket = getCommsSocket();
    } catch {
      /* @silent:teardown — no token yet, or sockets unavailable here. The badge
         poll is still running, so this degrades to the pre-socket behaviour. */
      return;
    }
    const handler = (payload: LiveNotification) => {
      if (!payload || !payload.notification_id) return;
      try {
        ref.current(payload);
      } catch {
        /* @silent:teardown — a throw here would detach the socket handler and
           lose every LATER notification, not just this one. */
      }
    };
    socket.on("notification:new", handler);
    return () => {
      socket.off("notification:new", handler);
    };
  }, [enabled]);
}
