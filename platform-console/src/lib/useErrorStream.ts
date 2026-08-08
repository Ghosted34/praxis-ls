/**
 * Live error feed transport — spec §2.1's hybrid, and acceptance criterion #8.
 *
 * WebSocket primary, short-polling fallback, automatic recovery in both
 * directions. The connection mode is surfaced so the UI can be honest about it
 * ("🔴 Live" vs "📡 Polling"), because a dashboard that claims to be live while
 * silently failing is worse than one that admits it is polling.
 *
 * WHY socket.io-client IS LOADED DYNAMICALLY
 *
 *   The console is deliberately a four-dependency app. Making the realtime
 *   client a hard static import would mean the entire Error Center — feed,
 *   KPIs, drawer, everything — fails to render if that package is missing or
 *   fails to load, when polling would have served every one of those views
 *   perfectly well. A dynamic import that falls back on rejection means the
 *   worst realtime outcome is a 10-second delay, not a blank page.
 *
 * POLLING IS WATERMARKED
 *
 *   `/errors/recent?since=<last server_time>` returns only what changed. Naive
 *   polling would re-fetch the same twenty rows every ten seconds forever and
 *   make dedupe the client's problem. The watermark is the server's clock, not
 *   the browser's — client clocks are wrong often enough to silently skip
 *   errors, and this is the one feature where that is unacceptable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { session } from "./api";
import { errorsApi, type ErrorRow } from "./errors-api";

export type ConnMode = "connecting" | "live" | "polling" | "offline";

/** §2.1 — 10-second poll, reconnect attempt every 30s. */
const POLL_MS = 10_000;
const RECONNECT_MS = 30_000;

type Options = {
  /** Slug, "platform", or "all". Re-subscribes when it changes. */
  scope?: string;
  /** Called for each error the server pushes or a poll discovers. */
  onError?: (row: ErrorRow) => void;
  /** Called when someone else resolves an error. */
  onResolved?: (p: { id: string; signature: string; resolved_at: string }) => void;
  enabled?: boolean;
};

type SocketLike = {
  on: (ev: string, fn: (...a: unknown[]) => void) => void;
  emit: (ev: string, ...a: unknown[]) => void;
  disconnect: () => void;
  connected: boolean;
};

export function useErrorStream({ scope = "all", onError, onResolved, enabled = true }: Options) {
  const [mode, setMode] = useState<ConnMode>("connecting");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  // Handlers live in refs so reconnect logic never re-runs just because the
  // parent re-rendered and handed us a new closure.
  const onErrorRef = useRef(onError);
  const onResolvedRef = useRef(onResolved);
  onErrorRef.current = onError;
  onResolvedRef.current = onResolved;

  const socketRef = useRef<SocketLike | null>(null);
  const watermark = useRef<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Kept in a ref so `poll` stays stable — rebuilding it on every scope change
  // would tear down and recreate the interval.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const poll = useCallback(async () => {
    try {
      const res = await errorsApi.recent(watermark.current || undefined, scopeRef.current);
      watermark.current = res.server_time;
      setMode((m) => (m === "live" ? m : "polling"));
      for (const row of res.items) {
        onErrorRef.current?.(row);
        setLastEventAt(row.last_seen);
      }
    } catch {
      // A failed poll is not fatal — the next tick may succeed. Only report
      // offline so the badge stops claiming data is flowing.
      setMode("offline");
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimer.current !== null) return;
    setMode((m) => (m === "live" ? "polling" : m === "connecting" ? "polling" : m));
    void poll();
    pollTimer.current = window.setInterval(() => void poll(), POLL_MS);
  }, [poll]);

  /** Try the socket. Resolves true if it connected. */
  const connectSocket = useCallback(async (): Promise<boolean> => {
    if (!session.token) return false;
    try {
      const mod = await import("socket.io-client");
      // Same origin the REST client uses. When `session.base` is relative — the
      // default, `window.location.origin + "/api/platform"` — this resolves to
      // the page origin, which in dev is Vite. That is correct ONLY because
      // vite.config.ts proxies /socket.io with ws:true; without that entry the
      // handshake is refused and the badge sits on "📡 Polling" forever while
      // everything else looks fine. See the comment there.
      const origin = new URL(session.base, window.location.origin).origin;
      const socket = mod.io(`${origin}/platform`, {
        auth: { token: session.token },
        transports: ["websocket", "polling"],
        // socket.io-client v4.8 stopped falling through the transport list on
        // its own. Listing both without this means a blocked WebSocket — a
        // corporate proxy, a TLS terminator that will not upgrade — reports
        // `connect_error` and degrades to our 10-second poll, when long-polling
        // over the same socket.io session would have kept the feed live.
        tryAllTransports: true,
        // Reconnection is handled here rather than by socket.io's own retry, so
        // that a failure flips the UI to polling instead of leaving it on a
        // "Live" badge that is quietly retrying behind the user's back.
        reconnection: false,
        timeout: 8000,
      }) as unknown as SocketLike;

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };

        socket.on("connect", () => {
          socketRef.current = socket;
          stopPolling();
          setMode("live");
          socket.emit("subscribe", { tenant_id: scope });
          done(true);
        });

        socket.on("new_error", (msg: unknown) => {
          const payload = (msg as { payload?: ErrorRow })?.payload;
          if (payload) {
            onErrorRef.current?.(payload);
            setLastEventAt(payload.last_seen);
          }
        });

        socket.on("error_resolved", (msg: unknown) => {
          const p = (msg as { payload?: { id: string; signature: string; resolved_at: string } })?.payload;
          if (p) onResolvedRef.current?.(p);
        });

        const fail = () => {
          socketRef.current = null;
          try {
            socket.disconnect();
          } catch {
            /* already gone */
          }
          startPolling();
          done(false);
        };
        socket.on("connect_error", fail);
        socket.on("disconnect", fail);

        window.setTimeout(() => done(false), 8000);
      });
    } catch {
      // Package absent or chunk failed to load — polling covers it.
      return false;
    }
  }, [scope, startPolling, stopPolling]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    void (async () => {
      const ok = await connectSocket();
      if (cancelled) return;
      if (!ok) startPolling();
    })();

    // §2.1: keep trying to get back onto the socket while degraded.
    reconnectTimer.current = window.setInterval(() => {
      if (socketRef.current?.connected) return;
      void connectSocket();
    }, RECONNECT_MS);

    return () => {
      cancelled = true;
      stopPolling();
      if (reconnectTimer.current !== null) window.clearInterval(reconnectTimer.current);
      reconnectTimer.current = null;
      try {
        socketRef.current?.disconnect();
      } catch {
        /* nothing to do */
      }
      socketRef.current = null;
    };
  }, [enabled, connectSocket, startPolling, stopPolling]);

  // Scope changes re-subscribe in place rather than tearing the socket down.
  useEffect(() => {
    if (socketRef.current?.connected) socketRef.current.emit("subscribe", { tenant_id: scope });
    watermark.current = null;
  }, [scope]);

  return { mode, lastEventAt };
}
