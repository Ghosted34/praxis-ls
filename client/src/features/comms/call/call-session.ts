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
import {
  CallEngine, RING_TIMEOUT_S,
  type NoiseFilterReason, type NoiseFilterStatus, type QualitySample,
} from "./call-engine";
import { presentRing, dismissRingNotification, parseCallLink, type RingChannel } from "./ring-surface";
import { fetchCallPrefs, saveCallPrefs } from "@/lib/preferences";
import {
  dialCall, acceptCall, declineCall, hangupCall, reportCallFailure, getCall,
  uploadCallPart, uploadCallLiveLog,
  type Call, type CallStatus,
} from "@/lib/smartcomm-api";
import { CallRecorder } from "./call-recorder";
import { LiveTranscript } from "./live-transcript";
import i18n from "@/lib/i18n";
import { getCommsSocket } from "@/lib/comms-socket";
import { ApiError } from "@/lib/api-client";
import { tr } from "@/lib/i18n";
import { tokenStore } from "@/lib/token-store";

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
  /** The tenant's recording switch, from the call row (PR-2). False means the
   *  consent banner does not render — there is nothing to consent to. */
  recordingEnabled: boolean;
  /** Parts of this side's audio that never uploaded. Surfaced in the overlay;
   *  the server's own state covers the other half of the same fact. */
  recordingLost: number;
  /** The call whose summary draft is waiting for the caller's review. Set by
   *  the `call:summary_ready` socket event, cleared when the panel closes. */
  draftCallId: string | null;
  /** Set when a side fell back to the browser capture: the call record says so
   *  and so does the person's screen, because a transcript nobody flagged is a
   *  transcript everybody trusts. */
  transcriptionIssue: { call_id: string; reason: string } | null;
  /** The outbound noise filter on THIS call (PR-3, §4.4): what the user asked
   *  for (`enabled` — the effective tenant-default-or-override), and what the
   *  worklet actually did (`status`, `reason`). */
  noise: { enabled: boolean; status: NoiseFilterStatus; reason: NoiseFilterReason | null };
  /** The quality dot's latest getStats() sample (§3.4). */
  quality: QualitySample;
  /** Media dropped mid-call and is being recovered — the overlay says
   *  "reconnecting…" instead of pretending nothing happened (§4.7). */
  recovering: boolean;
  /** An expired push opened a call that is already over: the one-tap redial
   *  path (§4.6), cleared by dialing again or dismissing it. */
  redial: { groupId: string; name: string | null } | null;
};

const INITIAL: SessionState = {
  phase: "idle", call: null, peerName: null, ringSecondsLeft: 0,
  elapsedS: 0, muted: false, warning: false, endedReason: null, lastError: null,
  recordingEnabled: false, recordingLost: 0, draftCallId: null, transcriptionIssue: null,
  noise: { enabled: true, status: "off", reason: null },
  quality: { state: "good", rttMs: null, jitterMs: null, lossPct: null },
  recovering: false, redial: null,
};

let state: SessionState = INITIAL;
let engine: CallEngine | null = null;
let engineReady = false;
let ringTimer: ReturnType<typeof setInterval> | null = null;
let endTimer: ReturnType<typeof setTimeout> | null = null;
/** The caller's offer, received before we have an engine to give it to. */
let pendingOffer: { callId: string; sdp: string } | null = null;
/** The record half (PR-2): one recorder and one live capture for the call this
 *  tab is in, both owned here so they survive any component unmounting. */
let recorder: CallRecorder | null = null;
let liveCapture: LiveTranscript | null = null;
/** undefined = this tab has not asked yet; null = the user has no opinion and
 *  follows the tenant default (the same absent-≠-null contract the server
 *  keeps — see preference.service.js). */
let userNoisePref: boolean | null | undefined;
/** The tenant's default for the yard, from the call row (createCall and
 *  acceptCall both carry `noise_suppression`). True until a row says otherwise:
 *  the guide's default is ON because the corridor has forklifts. */
let tenantNoiseDefault = true;
/** A call deep link from a push tap, kept until the ring resolves. */
let pendingLink: { callId: string; action: "accept" | "decline" | null } | null = null;

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

function applyRow(row: Call) {
  if (row.recording_enabled !== undefined) set({ recordingEnabled: row.recording_enabled });
  if (row.noise_suppression !== undefined) tenantNoiseDefault = row.noise_suppression !== false;
}

/** The effective filter setting: the person's override, else the tenant's. */
function resolveNoiseEnabled(): boolean {
  return userNoisePref === undefined || userNoisePref === null
    ? tenantNoiseDefault
    : userNoisePref;
}

/** Load the per-user override once per tab. A failure leaves it `undefined`,
 *  which resolves to the tenant default — a settings blip must not silence the
 *  yard filter, and it must not block a ring either. */
function ensureNoisePref(): void {
  if (userNoisePref !== undefined) return;
  fetchCallPrefs()
    .then((p) => {
      userNoisePref = p.noiseSuppression;
    })
    .catch(() => {
      /* @silent:parse — the default above is the honest fallback; there is no
         second action to take on a preference read that failed. */
    });
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

/** The caller's app language, which is also the draft language (§4.10) and the
 *  language the live recogniser runs in. */
function appLanguage(): "en" | "fr" {
  return String(i18n.language || "en").startsWith("fr") ? "fr" : "en";
}

/* ── The record half (PR-2) ──────────────────────────────────────────────── */

/**
 * Arm the recorder and the live capture, once media is actually up.
 *
 * Called from the engine's `onConnected`, so the record starts when the call
 * does — the ring is not part of it, and a call that never connects has nothing
 * to store. Both halves are best-effort and independent:
 *
 *   - no MediaRecorder (or a device that hands us no stream) → the live capture
 *     still runs, and the flagged transcript is exactly what §4.5 step 3 is for;
 *   - no SpeechRecognition → the audio still goes up, and the provider is the
 *     only reader, which is the normal path anyway;
 *   - neither → the call is a call, and the record says TRANSCRIPTION_FAILED
 *     out loud rather than pretending it has words.
 */
function armRecording(call: Call, side: "caller" | "callee"): void {
  // The kill switch. Off means no recorder AND no live capture: a tenant that
  // has switched recording off must not have words captured either, which is
  // the whole point of it being a separate flag from `calls`.
  if (call.recording_enabled === false) return;
  if (recorder || liveCapture) return;
  const language = appLanguage();
  const stream = engine?.stream || null;
  const live = new LiveTranscript(language, {
    flush: async (segments) => {
      await uploadCallLiveLog(call.call_id, { side, language, live_segments: segments });
    },
  });
  if (live.available) {
    live.start();
    liveCapture = live;
  }
  if (!stream) return;
  const rec = new CallRecorder({
    callId: call.call_id,
    side,
    language,
    deps: {
      upload: async (part, total) => {
        const file = new File([part.blob], `${side}-${part.index}.webm`, {
          type: part.blob.type || "audio/webm",
        });
        await uploadCallPart(call.call_id, file, {
          side,
          part_index: part.index,
          part_count: total,
          duration_ms: part.durationMs,
          language,
        });
      },
    },
  });
  try {
    rec.arm(stream);
    recorder = rec;
  } catch {
    /* @silent:teardown — this browser will not record (no MediaRecorder, a
       device that refuses a second consumer of the track). The call is
       unaffected: the live capture, where it exists, is the fallback, and the
       server records TRANSCRIPTION_FAILED where it does not. */
  }
}

/**
 * Stop and upload. FIRE AND FORGET from every caller's point of view.
 *
 * Synchronously it stops the MediaRecorder and the recogniser — it must run
 * while the mic is still open, since `stopEngine` is about to close the tracks —
 * and the uploads then proceed on their own. PR-1's hang-up path is a REST call
 * and a state change, and making it wait for twenty uploads on a corridor
 * connection is exactly the flakiness this feature must not add.
 */
function finishRecording(): void {
  const rec = recorder;
  const live = liveCapture;
  recorder = null;
  liveCapture = null;
  if (!rec && !live) return;
  const finished = rec ? rec.finish() : Promise.resolve({ parts: 0, lost: 0 });
  void Promise.all([finished, live ? live.stop() : Promise.resolve([])])
    .then(([out]) => {
      if (out && out.lost) set({ recordingLost: out.lost });
    })
    .catch(() => {
      /* @silent:storage — the uploads already report their own failures per
         part; a rejection here is the tail of the same fact, and the hang-up
         has long since completed. */
    });
}

/** Re-read the row after a locally-expired ring — the sweep has had 15 s to
 *  act at most, and the row says which way it went. */
async function syncFromRow(callId: string) {
  try {
    const row = await getCall(callId);
    applyRow(row);
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
  ensureNoisePref();
  set({ ...INITIAL });
  try {
    const call = await dialCall(groupId);
    applyRow(call);
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
  ensureNoisePref();
  void dismissRingNotification(call.call_id);
  set({ phase: "connecting" });
  try {
    const row = await acceptCall(call.call_id);
    applyRow(row);
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
  finishRecording();
  stopEngine();
  void dismissRingNotification(id);
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
  // BEFORE stopEngine: the recorder's final chunk must be produced while the
  // mic track is still open. Neither of these waits for an upload.
  finishRecording();
  stopEngine();
  void dismissRingNotification(id);
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

/**
 * Tell the server when THIS tab goes away mid-call (field note FN-1).
 *
 * The server row ends by a client report, by the 60 s ring deadline, by the
 * 30-minute cap, or by the liveness sweep (both devices gone). The report is
 * the only one that ends a call at once — and a page that is closing or
 * reloading is a page that still gets a chance to make it. So it does:
 * `pagehide` (it fires on close, on reload and on mobile bfcache, where
 * `beforeunload` cannot be trusted) sends a `keepalive: true` hang-up, the
 * one network call the browser owes a dying page.
 *
 * Best-effort by construction: if the network refuses, the row is still owned
 * — the liveness sweep (both devices gone) or the cap ends it — and the other
 * side gets a plain sentence instead of a frozen call and a busy trap.
 */
function keepaliveHangup(): void {
  const call = state.call;
  const { phase } = state;
  if (!call) return;
  if (phase !== "in_call" && phase !== "connecting" && phase !== "outgoing" && phase !== "incoming") return;
  try {
    const h = new Headers();
    h.set("Content-Type", "application/json");
    h.set("X-Praxis-Env", tokenStore.getEnv());
    const t = tokenStore.getAccess();
    if (t) h.set("Authorization", `Bearer ${t}`);
    void fetch(`/api/tenant/comms/calls/${call.call_id}/hangup`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ reason: "hangup" }),
      keepalive: true,
    }).catch(() => {
      /* @silent:teardown — a dying page owes the network nothing; the sweep owns the row. */
    });
  } catch {
    /* @silent:teardown — see above. */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", keepaliveHangup);
}

function setMuted(muted: boolean): void {
  // Exported below — comms-live wires the overlay mute button to it.

  engine?.setMuted(muted);
}

/* ── Engine construction (both roles share the wiring) ──────────────────── */

function makeEngine(isCaller: boolean, callId: string) {
  const socket = getCommsSocket();
  const e = new CallEngine(
    {
      onSignal: (sdp, kind) => {
        if (kind === "offer") socket.emit("call:offer", { callId, sdp });
        else socket.emit("call:answer", { callId, sdp });
      },
      onIce: (candidate) => socket.emit("call:ice", { callId, candidate }),
      onConnected: () => {
        if (state.call?.call_id !== callId) return;
        set({ phase: "in_call" });
        // Media is up: this is the moment the record starts (PR-2).
        if (state.call) armRecording(state.call, isCaller ? "caller" : "callee");
      },
      onFailed: () => {
        void (async () => {
          if (state.call?.call_id !== callId) return;
          finishRecording();
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
      // ── PR-3: quality dot, noise filter state, media recovery ──────────
      onQuality: (sample) => set({ quality: sample }),
      onNoiseFilter: (status, reason) =>
        set({ noise: { enabled: e.noiseWanted, status, reason } }),
      onRecovering: (recovering) => set({ recovering }),
      onWarnMaxDuration: () => set({ warning: true }),
      onMaxDuration: () => void hangup(),
      onLocalMuted: (m) => set({ muted: m }),
    },
    isCaller,
  );
  // BEFORE start() — the engine reads this when it decides whether to build the
  // worklet graph on the outbound track (§4.4).
  e.noiseWanted = resolveNoiseEnabled();
  set({ noise: { enabled: e.noiseWanted, status: "off", reason: null } });
  return e;
}

/* ── Server → this tab (wired once, app lifetime) ───────────────────────── */

let wired = false;
export function wireCallSocket(): void {
  if (wired) return;
  wired = true;
  const s = getCommsSocket();

  s.on("call:ringing", (p: { call_id: string; from: { user_id: string; name?: string | null }; ring_timeout_s?: number; recording_enabled?: boolean; noise_suppression?: boolean }) => {
    // A ring we are already in a call for: the server would have refused the
    // dialer with 409, and if that check raced us the row resolves it — but
    // this tab physically has one call at a time, so the honest answer is to
    // stay in the one we are in. The dialer sees the busy end.
    if (state.phase !== "idle" && state.phase !== "ended") return;
    set({ recordingEnabled: p.recording_enabled === true });
    set({
      phase: "incoming",
      call: {
        call_id: p.call_id,
        group_id: "",
        caller_id: p.from.user_id,
        callee_id: currentUserId() || "",
        status: "RINGING",
        started_at: new Date().toISOString(),
        recording_enabled: p.recording_enabled === true,
      },
      peerName: p.from.name || null,
      ringSecondsLeft: p.ring_timeout_s ?? RING_TIMEOUT_S,
    });
    if (p.noise_suppression !== undefined) tenantNoiseDefault = p.noise_suppression !== false;
    startRingCountdown(() => void syncFromRow(p.call_id));

    // §4.6: say which channel actually reached this device, and do it fast —
    // the server's push escalation fires at t≈5 s and stands down on the ack.
    // A ring the person was already looking at is `socket`; a hidden tab that
    // got a real system notification is `notification`; an app that was opened
    // BY the push deep link is `push` (the ring is being shown because the tap
    // woke this tab, and the ack says so).
    const viaPush = pendingLink?.callId === p.call_id;
    void (async () => {
      const channel: RingChannel | null = viaPush
        ? "push"
        : await presentRing({
            callId: p.call_id,
            peerName: p.from.name || null,
            recordingEnabled: p.recording_enabled === true,
          });
      // null = nothing was presented on this device (hidden tab, notifications
      // not permitted). NO ACK: the escalation at t=5 s is then still live, and
      // the push is the tier that can actually reach them.
      if (channel) s.emit("call:ring_ack", { callId: p.call_id, channel });
      if (viaPush) pendingLink = null;
    })();
  });

  // The same user's OTHER device heard the bell first (§4.6 "stops all
  // channels"): take this tab's notification down, so the desk tab and the
  // phone are never both ringing for a call one of them has already answered.
  s.on("call:ring_ack", (p: { call_id: string; channel?: string }) => {
    if (p && p.call_id) void dismissRingNotification(p.call_id);
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
    // §4.6, the case that only exists with push: a callee who accepted from a
    // COLD app never received our offer — the socket message that carried it
    // was published while their phone had no page open. Accept is the signal
    // that they are there now, so we re-send the local description. One extra
    // message, and it is the difference between "push accept works" and "it
    // connects to silence".
    const sdp = engine?.localSdp;
    if (sdp && engine && !engine.hasRemoteAnswer) {
      getCommsSocket().emit("call:offer", { callId: state.call?.call_id, sdp });
    }
  });

  const onTerminal = (p: { call_id: string; status?: string; reason?: string; duration_seconds?: number | null; ended_at?: string | null }) => {
    if (state.call?.call_id !== p.call_id) return;
    // The other end hung up, or the sweep ended the call: the recorder stops
    // here too, and its tail is uploaded exactly as if we had pressed hang-up.
    finishRecording();
    stopEngine();
    void dismissRingNotification(p.call_id);
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
  // ── The record half (PR-2) ──
  //
  // A draft landed for the caller: open the review panel. Nothing is posted by
  // this event — it opens an editor, which is the only way a summary reaches a
  // conversation (decision row 3).
  s.on("call:summary_ready", (p: { call_id: string; status?: string }) => {
    if (p && p.call_id) set({ draftCallId: p.call_id });
  });

  // A side fell back to the browser capture. The record says so, and so does
  // this screen: a flagged transcript that only the database knows about is the
  // silent degradation §4.5 exists to forbid.
  s.on("call:transcription_failed", (p: { call_id: string; reason?: string }) => {
    if (p && p.call_id) set({ transcriptionIssue: { call_id: p.call_id, reason: p.reason || "" } });
  });

  // Every terminal path publishes one of these (call:ended covers ENDED and
  // FAILED; the named ones are the pre-connect outcomes).
  s.on("call:ended", onTerminal);
  s.on("call:cancelled", onTerminal);
  s.on("call:declined", onTerminal);
  s.on("call:no_answer", onTerminal);
}

/* ── PR-3: the noise switch, the push deep link, the redial path ────────── */

/**
 * The overlay's noise switch (§4.4/§7.2: "off-switch in the call overlay").
 *
 * Live: the worklet is swapped onto the outbound track through `replaceTrack`,
 * so the peer connection never renegotiates. Persisted: the same value goes to
 * `/me/preferences/calls`, so the next call starts where this one was left —
 * and `false` is a choice, not a return to the tenant default. Sending `null`
 * (the reset) is a settings-screen action, not something a mid-call tap does.
 */
export async function setNoise(enabled: boolean): Promise<void> {
  ensureNoisePref();
  userNoisePref = enabled;
  // `enabled` is what the person asked for; `status` is what the audio graph is
  // ACTUALLY doing, and the engine announces that through `onNoiseFilter` (the
  // sink wired in `connectEvents`) once the worklet has loaded — or failed to.
  // So this write only keeps the two
  // honest: turning the filter OFF is instant and final — the graph is torn down
  // before the promise settles — while turning it ON is not, because the module
  // still has to load and can come back "unavailable" instead.
  set({
    noise: {
      enabled,
      status: enabled ? state.noise.status : "off",
      reason: enabled ? state.noise.reason : null,
    },
  });
  void saveCallPrefs({ noiseSuppression: enabled }).catch(() => {
    /* @silent:storage — the switch took effect for THIS call either way; the
       persistence is a convenience, and re-prompting mid-call would be worse. */
  });
  await engine?.setNoiseSuppression(enabled);
}

/** Dismiss the redial banner without dialing. */
export function dismissRedial(): void {
  set({ redial: null });
}

/** One-tap redial after an expired push opened a call that is already over. */
export async function redial(): Promise<void> {
  const r = state.redial;
  if (!r) return;
  set({ redial: null });
  await dial(r.groupId, r.name);
}

/** How much of the 60-second window is left on a row we are ringing from. */
function remainingRingSeconds(row: Call): number {
  const started = Date.parse(row.started_at || "");
  if (!Number.isFinite(started)) return RING_TIMEOUT_S;
  const used = Math.floor((Date.now() - started) / 1000);
  return Math.max(1, Math.min(RING_TIMEOUT_S, RING_TIMEOUT_S - used));
}

/**
 * A call deep link (`/comms?call=<id>&act=accept|decline`) — §4.6.
 *
 * Two situations produce one of these, and they need different handling:
 *
 *   1. THE APP WAS CLOSED and the push woke it. The socket ring that went out
 *      60 seconds ago is long gone, so the ROW is the only source of truth:
 *      still RINGING → rebuild the ring locally (this is the ring the person
 *      tapped, and it must be answerable); already terminal → the honest redial
 *      path rather than a screen for a call that cannot happen.
 *   2. THE APP WAS OPEN and the notification action carried the link. The
 *      socket ring is already in the store; nothing to rebuild.
 *
 * Never throws: called during boot, where an exception would take the app down
 * over a stale link.
 */
export function initCallDeepLink(search: string): void {
  const link = parseCallLink(search);
  if (!link) return;
  pendingLink = link;
  void hydrateFromLink(link);
}

async function hydrateFromLink(link: { callId: string; action: "accept" | "decline" | null }): Promise<void> {
  // The socket beat us to it (the ordinary open-app case): the handler above
  // has the ring, and the pending link only decides the ack channel.
  if (state.call?.call_id === link.callId) {
    if (link.action === "accept") await answer();
    if (link.action === "decline") await decline();
    return;
  }
  if (state.phase !== "idle" && state.phase !== "ended") return;

  let row: Call | null = null;
  try {
    row = await getCall(link.callId);
  } catch {
    /* @silent:parse — an unknown/forbidden call id is the same outcome as an
       expired one: nothing to answer. */
  }
  // The socket may have delivered the ring while we were reading the row.
  if (state.call?.call_id === link.callId) return;

  if (row && row.status === "RINGING" && row.callee_id === (currentUserId() || "")) {
    set({
      phase: "incoming",
      call: row,
      peerName: row.caller_name || null,
      ringSecondsLeft: remainingRingSeconds(row),
    });
    startRingCountdown(() => void syncFromRow(link.callId));
    getCommsSocket().emit("call:ring_ack", { callId: link.callId, channel: "push" });
    // The ring is only worth rebuilding if it can still be answered: the count
    // left is whatever the server's own clock says, not a fresh 60 s.
    if (link.action === "accept") await answer();
    if (link.action === "decline") await decline();
    return;
  }

  // Expired (or never ours). The one-tap redial path, and an honest line about
  // what happened — never a ring for a call that is over.
  void dismissRingNotification(link.callId);
  const groupId = row?.group_id || null;
  if (groupId) {
    set({ redial: { groupId, name: row?.caller_name || null } });
  } else {
    set({ lastError: tr("That call has already ended") });
  }
}

export { setMuted };

/** Close the summary panel (after sending, discarding, or a deliberate
 *  dismissal). The draft itself is untouched — this only closes a panel. */
export function closeSummaryDraft(): void {
  set({ draftCallId: null });
}

