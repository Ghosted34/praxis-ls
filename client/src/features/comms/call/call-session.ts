/**
 * 1:1 call session (Smart Comms PR-1) — the ONE call this tab is in.
 *
 * Module-level by necessity: a ring can arrive while the user is on ANY screen
 * (/finance, /wms, anywhere), so the state cannot live in a chat component.
 * The shape is a small external store — `useCall()` (useSyncExternalStore) —
 * written by socket events and by the three user actions (dial, answer,
 * hang-up), rendered by the overlays in comms-live.tsx.
 *
 * Division of labour, kept strict:
 *   - the SERVER row is the truth (state machine + both timers; the sweep
 *     ends calls this tab forgets about),
 *   - this module routes user intent to REST and server signals to the UI,
 *   - the ENGINE (call-engine.ts) owns one RTCPeerConnection and the mic.
 * A client that lies about state changes nothing: every transition it
 * requests is a guarded UPDATE the server may refuse with 409, and the
 * socket then re-syncs this store to the row.
 */
import * as React from "react";
import { CallEngine, RING_TIMEOUT_S } from "./call-engine";
import {
  dialCall, acceptCall, declineCall, hangupCall, reportCallFailure, getCall,
  type Call, type CallStatus,
} from "@/lib/smartcomm-api";
import { getCommsSocket } from "@/lib/comms-socket";
import { ApiError } from "@/lib/api-client";
import { tr } from "@/lib/i18n";

export type Phase = "idle" | "outgoing" | "incoming" | "connecting" | "in_call" | "ended";

export type SessionState = {
  phase: Phase;
  call: Call | null;
  peerName: string | null;
  /** Local 60 s ring countdown — UX only; the server sweep is the truth. */
  ringSecondsLeft: number;
  /** Seconds since media connected — the UI clock. */
  elapsedS: number;
  muted: boolean;
  /** True from 29:00 (the one-minute warning). */
  warning: boolean;
  /** Terminal reason for the toast; cleared when the session returns to idle. */
  endedReason: string | null;
  /** Transient error (dial failed) for the caller's screen. */
  lastError: string | null;
};

const INITIAL: SessionState = {
  phase: "idle", call: null, peerName: null, ringSecondsLeft: 0,
  elapsedS: 0, muted: false, warning: false, endedReason: null, lastError: null,
};

let state: SessionState = INITIAL;
let engine: CallEngine | null = null;
let engineReady = false;
let ringTimer: ReturnType<typeof setInterval> | null = null;
let endTimer: ReturnType<typeof setTimeout> | null = null;
/** The caller's offer, received before we have an engine to give it to. */
let pendingOffer: { callId: string; sdp: string } | null = null;
const subs = new Set<() => void>();

function set(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  for (const fn of subs) fn();
}
function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function useCall(): SessionState {
  return React.useSyncExternalStore(subscribe, () => state, () => state);
}

/** The logged-in user's id, read the same way auth-context persists it. */
export function myUserId(): string | null {
  try {
    const raw = localStorage.getItem("praxis.user");
    if (!raw) return null;
    const u = JSON.parse(raw) as { user_id?: string };
    return u.user_id ?? null;
  } catch {
    return null;
  }
}
const currentUserId = myUserId;

/** The server's error text, translated for the two cases it can be. */
function errText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "CALLER_BUSY") return tr("You are already on a call");
    if (err.code === "CALLEE_BUSY") return tr("That person is already on a call");
    if (err.message) return err.message;
  }
  return tr("Could not connect the call");
}

function clearRing() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
}
function clearEndTimer() {
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
}
/** A 409 on a transition means the SERVER already ended the call (sweep,
 *  other end); the socket event carries the row. Nothing else to do. */
function swallowServerEnded(_err: unknown): void {
  /* @silent:teardown — the terminal socket event re-syncs this store; a
     second transition for a call the row already closed is exactly the
     race the guarded UPDATE exists to lose. */
}

/** Local ring countdown; at zero the server's sweep owns the outcome, so we
 *  just re-read the row. */
function startRingCountdown(onZero: () => void) {
  clearRing();
  ringTimer = setInterval(() => {
    const left = state.ringSecondsLeft - 1;
    if (left <= 0) {
      clearRing();
      set({ ringSecondsLeft: 0 });
      onZero();
    } else {
      set({ ringSecondsLeft: left });
    }
  }, 1000);
}

function toIdleIfEnded(callId: string) {
  clearEndTimer();
  endTimer = setTimeout(() => {
    if (state.phase === "ended" && state.call?.call_id === callId) {
      set({ phase: "idle", endedReason: null });
    }
  }, 4000);
}

function stopEngine() {
  engine?.stop();
  engine = null;
  engineReady = false;
  clearRing();
}

/** Re-read the row after a locally-expired ring — the sweep has had 15 s to
 *  act at most, and the row says which way it went. */
async function syncFromRow(callId: string) {
  try {
    const row = await getCall(callId);
    if (state.call?.call_id !== callId) return;
    if (row.status === "RINGING") {
      // We lost the race against the sweep's clock by a few seconds — keep
      // ringing until the row really moves; the next beat will see it.
      return;
    }
    stopEngine();
    set({
      phase: "ended",
      call: row,
      endedReason: row.end_reason ?? "no_answer",
    });
    toIdleIfEnded(callId);
  } catch {
    /* @silent:parse — a 404/403 here means the row is gone or we never had
       it; idle is the honest state, and the row is never re-created. */
  }
}

/* ── Actions ─────────────────────────────────────────────────────────────── */

export async function dial(groupId: string, peerName: string | null): Promise<void> {
  if (state.phase !== "idle") return;
  set({ ...INITIAL });
  try {
    const call = await dialCall(groupId);
    set({
      phase: "outgoing", call, peerName,
      ringSecondsLeft: RING_TIMEOUT_S,
    });
    startRingCountdown(() => void syncFromRow(call.call_id));
    const e = makeEngine(true, call.call_id);
    engine = e;
    try {
      await e.start(call.ice);
      engineReady = true;
    } catch (err) {
      stopEngine();
      set({ phase: "idle", lastError: errText(err) });
    }
  } catch (err) {
    set({ phase: "idle", lastError: errText(err) });
  }
}

export async function answer(): Promise<void> {
  const call = state.call;
  if (!call || state.phase !== "incoming") return;
  set({ phase: "connecting" });
  try {
    const row = await acceptCall(call.call_id);
    set({ call: row, phase: "connecting" });
    const e = makeEngine(false, row.call_id);
    engine = e;
    try {
      await e.start(row.ice);
      engineReady = true;
      // The offer almost certainly already arrived (the caller sends it the
      // moment the ring does) — hand it over now that the connection exists.
      if (pendingOffer && pendingOffer.callId === row.call_id) {
        const sdp = pendingOffer.sdp;
        pendingOffer = null;
        await e.applyRemoteOffer(sdp);
      }
    } catch (err) {
      stopEngine();
      set({ phase: "idle", lastError: errText(err) });
    }
  } catch (err) {
    stopEngine();
    set({ phase: "idle", lastError: errText(err) });
  }
}

export async function decline(): Promise<void> {
  const call = state.call;
  if (!call) return;
  const id = call.call_id;
  stopEngine();
  try {
    const row = await declineCall(id);
    if (state.call?.call_id === id) {
      set({ phase: "ended", call: row, endedReason: row.end_reason ?? "declined" });
    }
  } catch (err) {
    swallowServerEnded(err);
  }
  toIdleIfEnded(id);
}

export async function hangup(): Promise<void> {
  const call = state.call;
  if (!call) return;
  const id = call.call_id;
  stopEngine();
  try {
    const row = await hangupCall(id);
    if (state.call?.call_id === id) {
      set({ phase: "ended", call: row, endedReason: row.end_reason ?? "hangup" });
    }
  } catch (err) {
    swallowServerEnded(err);
  }
  toIdleIfEnded(id);
}

function setMuted(muted: boolean): void {
  // Exported below — comms-live wires the overlay mute button to it.

  engine?.setMuted(muted);
}

/* ── Engine construction (both roles share the wiring) ──────────────────── */

function makeEngine(isCaller: boolean, callId: string) {
  const socket = getCommsSocket();
  return new CallEngine(
    {
      onSignal: (sdp, kind) => {
        if (kind === "offer") socket.emit("call:offer", { callId, sdp });
        else socket.emit("call:answer", { callId, sdp });
      },
      onIce: (candidate) => socket.emit("call:ice", { callId, candidate }),
      onConnected: () => {
        if (state.call?.call_id === callId) set({ phase: "in_call" });
      },
      onFailed: () => {
        void (async () => {
          if (state.call?.call_id !== callId) return;
          stopEngine();
          try {
            const row = await reportCallFailure(callId);
            set({ phase: "ended", call: row, endedReason: row.end_reason ?? "ice_failed" });
          } catch (err) {
            swallowServerEnded(err);
            set({ phase: "ended", endedReason: "ice_failed" });
          }
          toIdleIfEnded(callId);
        })();
      },
      onTick: (s) => set({ elapsedS: s }),
      onWarnMaxDuration: () => set({ warning: true }),
      onMaxDuration: () => void hangup(),
      onLocalMuted: (m) => set({ muted: m }),
    },
    isCaller,
  );
}

/* ── Server → this tab (wired once, app lifetime) ───────────────────────── */

let wired = false;
export function wireCallSocket(): void {
  if (wired) return;
  wired = true;
  const s = getCommsSocket();

  s.on("call:ringing", (p: { call_id: string; from: { user_id: string; name?: string | null }; ring_timeout_s?: number }) => {
    // A ring we are already in a call for: the server would have refused the
    // dialer with 409, and if that check raced us the row resolves it — but
    // this tab physically has one call at a time, so the honest answer is to
    // stay in the one we are in. The dialer sees the busy end.
    if (state.phase !== "idle" && state.phase !== "ended") return;
    set({
      phase: "incoming",
      call: {
        call_id: p.call_id,
        group_id: "",
        caller_id: p.from.user_id,
        callee_id: currentUserId() || "",
        status: "RINGING",
        started_at: new Date().toISOString(),
      },
      peerName: p.from.name || null,
      ringSecondsLeft: p.ring_timeout_s ?? RING_TIMEOUT_S,
    });
    startRingCountdown(() => void syncFromRow(p.call_id));
  });

  s.on("call:offer", (p: { call_id: string; sdp: string }) => {
    if (state.call?.call_id !== p.call_id) return;
    if (engineReady && engine) {
      engine.applyRemoteOffer(p.sdp).catch(() => {
        /* @silent:parse — a remote SDP that does not apply (duplicated
           event, or the call already closed) changes nothing we can act
           on; the engine's own ICE path reports a real failure. */
      });
    } else {
      pendingOffer = { callId: p.call_id, sdp: p.sdp };
    }
  });

  s.on("call:answer", (p: { call_id: string; sdp: string }) => {
    if (!engineReady || !engine || state.call?.call_id !== p.call_id) return;
    engine.applyRemoteAnswer(p.sdp).catch(() => {
      /* @silent:parse — same as the offer path: a late/duplicated SDP is a
         no-op, a real media failure surfaces through ICE state. */
    });
  });

  s.on("call:ice", (p: { call_id: string; candidate: unknown | null }) => {
    if (!engine || state.call?.call_id !== p.call_id) return;
    void engine.addRemoteIceCandidate(p.candidate);
  });

  s.on("call:accepted", () => {
    // The callee's answer to the ROW (the media path is forming). The UI's
    // "connecting" → "in_call" move happens on the engine's onConnected;
    // this event only ever corrects a tab that missed it.
    if (state.phase === "outgoing" && state.call) {
      set({ phase: "connecting" });
    }
  });

  const onTerminal = (p: { call_id: string; status?: string; reason?: string; duration_seconds?: number | null; ended_at?: string | null }) => {
    if (state.call?.call_id !== p.call_id) return;
    stopEngine();
    const row: Call | null = state.call
      ? {
          ...state.call,
          status: (p.status as CallStatus) || state.call.status,
          end_reason: (p.reason as Call["end_reason"]) ?? state.call.end_reason,
          duration_seconds: p.duration_seconds ?? state.call.duration_seconds ?? null,
          ended_at: p.ended_at ?? state.call.ended_at ?? null,
        }
      : null;
    set({ phase: "ended", call: row, endedReason: p.reason ?? "hangup" });
    toIdleIfEnded(p.call_id);
  };
  // Every terminal path publishes one of these (call:ended covers ENDED and
  // FAILED; the named ones are the pre-connect outcomes).
  s.on("call:ended", onTerminal);
  s.on("call:cancelled", onTerminal);
  s.on("call:declined", onTerminal);
  s.on("call:no_answer", onTerminal);
}

export { setMuted };
