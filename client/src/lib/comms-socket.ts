/**
 * Smart Comms real-time client (MOD-64). A thin wrapper around a single shared
 * socket.io connection, authenticated with the same access token + env as the
 * REST client (see lib/api-client). The server resolves the tenant from the
 * connection Host and re-checks channel membership on every join, so this layer
 * only has to connect, join the open channel, and surface events.
 *
 * Usage (in the channel thread component):
 *
 *   const { onEvent, setTyping } = useCommsChannel(channelId, {
 *     "comms:message":         ({ message }) => appendMessage(message),
 *     "comms:message_edited":  ({ message }) => replaceMessage(message),
 *     "comms:message_deleted": ({ message_id }) => markDeleted(message_id),
 *     "comms:reaction":        ({ message_id, reactions }) => setReactions(message_id, reactions),
 *     "comms:read":            ({ user_id }) => markPresenceRead(user_id),
 *     "channel:typing":        ({ user_id }) => showTyping(user_id),
 *   });
 *
 * In production (single-origin) the socket connects to the same host as the app,
 * so the tenant resolves automatically. In dev, pass `host`/`url` overrides.
 */
import * as React from "react";
import { io, type Socket } from "socket.io-client";
import { tokenStore } from "./token-store";

let socket: Socket | null = null;

/** Lazily create (or reuse) the shared authenticated socket. */
export function getCommsSocket(opts?: { url?: string; host?: string }): Socket {
  if (socket && socket.connected) return socket;
  if (!socket) {
    socket = io(opts?.url || "/", {
      autoConnect: true,
      transports: ["websocket"],
      auth: {
        token: tokenStore.getAccess(),
        env: tokenStore.getEnv(),
        host: opts?.host || window.location.hostname,
      },
    });
  }
  return socket;
}

export function disconnectCommsSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

type Handlers = Record<string, (payload: any) => void>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Subscribe to a channel's live events for the lifetime of the mounted
 * component. Joins on mount / channel change, leaves on cleanup, and returns a
 * `setTyping()` to broadcast the ephemeral typing indicator.
 */
export function useCommsChannel(channelId: string | null | undefined, handlers: Handlers) {
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    if (!channelId) return;
    const s = getCommsSocket();

    // Bind every handler through a stable wrapper so re-renders don't re-bind.
    const bound: Handlers = {};
    for (const event of Object.keys(handlersRef.current)) {
      bound[event] = (payload: unknown) => handlersRef.current[event]?.(payload);
      s.on(event, bound[event]);
    }

    const join = () => s.emit("channel:join", channelId);
    if (s.connected) join();
    s.on("connect", join);

    return () => {
      s.emit("channel:leave", channelId);
      s.off("connect", join);
      for (const event of Object.keys(bound)) s.off(event, bound[event]);
    };
  }, [channelId]);

  const setTyping = React.useCallback(() => {
    if (channelId) getCommsSocket().emit("channel:typing", channelId);
  }, [channelId]);

  return { setTyping };
}
