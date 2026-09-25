/**
 * 1:1 call session — the ONE call this tab is in.
 *
 * Module-level by necessity: a ring can arrive while the user is on any
 * screen, so the state cannot live in a chat component. `useCall()` reads a
 * small external store written by socket events, the service worker and the
 * user's actions (dial, answer, decline, hang-up); comms-live renders it.
 *
 * The server row is the truth (state machine and timers); this module routes
 * user intent to REST and server signals to the UI; the engine owns the
 * RTCPeerConnection and the mic. A transition the server refuses (409) is
 * re-synced from the row or the terminal socket event.
 */
import * as React from "react";
import {
  CallEngine, RING_TIMEOUT_S, MEDIA_BEAT_MS, openMic, primeRemoteAudio, primeNoiseContext,
  type NoiseFilterReason, type NoiseFilterStatus, type QualitySample,
} from "./call-engine";
import { presentRing, dismissRingNotification, parseCallLink, type RingChannel } from "./ring-surface";
import { takeCallIntent } from "./call-intent";
import { fetchCallPrefs, saveCallPrefs } from "@/lib/preferences";
import {
  dialCall, acceptCall, declineCall, hangupCall, reportCallFailure, reportCallAlive, getCall, getCallTurn,
  getRingingCalls, uploadCallPart, completeCallRecording, callHangupUrl,
  type Call, type CallStatus, type RingingCall,
} from "@/lib/smartcomm-api";
import { CallRecorder } from "./call-recorder";
import { UploadOutbox, indexedDbStore, itemId, type OutboxItem } from "./call-upload-outbox";
import i18n from "@/lib/i18n";
import { getCommsSocket } from "@/lib/comms-socket";
import { ApiError } from "@/lib/api-client";
import { tr } from "@/lib/i18n";
import { tokenStore } from "@/lib/token-store";

/** `dialing` is the moment between the tap and the server's answer: set
 *  synchronously, so a double tap cannot dial twice (audit E7). */
export type Phase = "idle" | "dialing" | "outgoing" | "incoming" | "connecting" | "in_call" | "ended";

/** Why a call ended, as the toast says it. The server's reasons, plus
 *  `answered_elsewhere` for a ring picked up on another device (audit E8). */
export type EndedReason = string;

export type SessionState = {
  phase: Phase;
  call: Call | null;
  peerName: string | null;
  /** Local ring countdown — UX only; the server sweep is the truth. */
  ringSecondsLeft: number;
  /** Seconds since media connected — the UI clock. */
  elapsedS: number;
  muted: boolean;
  /** True from 29:00 (the one-minute warning). */
  warning: boolean;
  /** Terminal reason for the toast; cleared when the session returns to idle. */
  endedReason: EndedReason | null;
  /** Transient error (dial failed, no microphone) for the caller's screen. */
  lastError: string | null;
  /** The tenant's recording switch, from the call row (PR-2). */
  recordingEnabled: boolean;
  /** Parts of this side's audio that never uploaded. */
  recordingLost: number;
  /** A summary just became ready (or gained an update), for the shell's toast. */
  summaryNotice: { call_id: string; status: string } | null;
  /** Bumped on every `call:summary_ready`, so an open conversation re-reads
   *  its pinned draft (owner decision O3). */
  summaryTick: number;
  /** A transcription failure on a call, by reason code (rendered by PR-6). */
  transcriptionIssue: { call_id: string; reason: string } | null;
  /** The outbound noise filter: what the user asked for and what happened. */
  noise: { enabled: boolean; status: NoiseFilterStatus; reason: NoiseFilterReason | null };
  /** The quality dot's latest getStats() sample. */
  quality: QualitySample;
  /** Media dropped mid-call and is being recovered. */
  recovering: boolean;
  /** The browser refused to play the other side's voice (audit E4): the call
   *  screen shows "Tap to hear". */
  audioBlocked: boolean;
  /** An expired ring link opened a call that is already over: one-tap redial. */
  redial: { groupId: string; name: string | null } | null;
  /** A call this user is making or taking on ANOTHER device
   *  (`call:ringing_sent`, `call:accepted`), so this tab can say so. */
  elsewhere: { callId: string; peerName: string | null; status: "ringing" | "in_call" } | null;
  /** This person can take calls here (the ringing read answered); null until
   *  it has been asked, false when calls are off or not theirs to use. */
  callsAvailable: boolean | null;
};

const INITIAL: SessionState = {
  phase: "idle", call: null, peerName: null, ringSecondsLeft: 0,
  elapsedS: 0, muted: false, warning: false, endedReason: null, lastError: null,
  recordingEnabled: false, recordingLost: 0, summaryNotice: null, summaryTick: 0, transcriptionIssue: null,
  noise: { enabled: false, status: "off", reason: null },
  quality: { state: "good", rttMs: null, jitterMs: null, lossPct: null },
  recovering: false, audioBlocked: false, redial: null, elsewhere: null, callsAvailable: null,
};

/** After the local countdown reaches zero, how long a still-RINGING row is
 *  believed before this tab ends the ring itself (one sweep interval): a
 *  ring can never stick (audit A13). */
export const RING_EXPIRY_GRACE_MS = 15_000;
/** The ringing read is not repeated more often than this. */
const RECONCILE_MIN_MS = 2_000;
/** A local ring younger than this is kept even if the ringing read (which
 *  may have raced it) does not list it. */
const RECONCILE_GRACE_MS = 4_000;

let state: SessionState = INITIAL;
let engine: CallEngine | null = null;
let engineReady = false;
let ringTimer: ReturnType<typeof setInterval> | null = null;
let ringExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let endTimer: ReturnType<typeof setTimeout> | null = null;
/** When this tab started ringing for the current call (reconcile's grace). */
let ringStartedAt = 0;
/** The caller's offer, received before we have an engine to give it to. */
let pendingOffer: { callId: string; sdp: string } | null = null;
/** The caller's candidates, received while the phone was still ringing. */
let pendingIce: { callId: string; candidates: Array<unknown | null> } | null = null;
/** Rings this tab has answered, declined or seen end: never presented again,
 *  even while the row still says RINGING for a moment. */
const handledRings = new Set<string>();
/** The recorder for the call this tab is in. */
let mediaBeatTimer: ReturnType<typeof setInterval> | null = null;
let recorder: CallRecorder | null = null;
/** The call and side this tab is recording, set when media connects. */
let recording: { callId: string; side: "caller" | "callee" } | null = null;
/** undefined = not asked yet; null = follows the tenant default. */
let userNoisePref: boolean | null | undefined;
/** The tenant's default for the yard filter, from the call row. Off until a
 *  row says otherwise (audit E5: off until verified on devices). */
let tenantNoiseDefault = false;
/** A ring deep link or notification action, kept until the ring resolves. */
let pendingLink: { callId: string; action: "accept" | "decline" | null } | null = null;

const subs = new Set<() => void>();

/** The phase now. Read through a call after an await: TypeScript keeps a
 *  narrowing of `state.phase` across awaits that the world does not. */
function phaseNow(): Phase {
  return state.phase;
}

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

/** The server's error text, translated for the cases it can be. */
function errText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "CALLER_BUSY") return tr("You are already on a call");
    if (err.code === "CALLEE_BUSY") return tr("That person is already on a call");
    if (err.message) return err.message;
  }
  return tr("Could not connect the call");
}

/** Why the microphone could not be opened, in words a person can act on. */
function micErrText(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return tr("Microphone blocked — allow it for this site to make and take calls");
  }
  if (name === "NotFoundError" || (err instanceof Error && err.message === "no-media-device")) {
    return tr("No microphone found on this device");
  }
  return tr("The microphone could not be opened");
}

function clearRing() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  if (ringExpiryTimer) clearTimeout(ringExpiryTimer);
  ringExpiryTimer = null;
}
function clearEndTimer() {
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
}
/** A 409 on a transition means the server already ended the call; the
 *  socket event carries the row. */
function swallowServerEnded(_err: unknown): void {
  /* @silent:teardown — the terminal socket event re-syncs this store; a
     second transition for a call the row already closed is the race the
     guarded UPDATE exists to lose. */
}

/** Local ring countdown; at zero the row is re-read. */
function startRingCountdown(onZero: () => void) {
  clearRing();
  ringTimer = setInterval(() => {
    const left = state.ringSecondsLeft - 1;
    if (left <= 0) {
      if (ringTimer) clearInterval(ringTimer);
      ringTimer = null;
      set({ ringSecondsLeft: 0 });
      onZero();
    } else {
      set({ ringSecondsLeft: left });
    }
  }, 1000);
}

function applyRow(row: Call) {
  if (row.recording_enabled !== undefined) set({ recordingEnabled: row.recording_enabled });
  if (row.noise_suppression !== undefined) tenantNoiseDefault = row.noise_suppression === true;
}

/** The effective filter setting: the person's override, else the tenant's. */
function resolveNoiseEnabled(): boolean {
  return userNoisePref === undefined || userNoisePref === null
    ? tenantNoiseDefault
    : userNoisePref;
}

/** Load the per-user override once per tab; a failure follows the tenant. */
function ensureNoisePref(): void {
  if (userNoisePref !== undefined) return;
  fetchCallPrefs()
    .then((p) => {
      userNoisePref = p.noiseSuppression;
    })
    .catch(() => {
      /* @silent:parse — the tenant default is the honest fallback. */
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

/**
 * Tell the server our media is up, every MEDIA_BEAT_MS, for as long as it is
 * (field note FN-2).
 *
 * The server's liveness sweep reads SOCKET presence, and a socket is not the
 * call: the audio is peer-to-peer and the server never sees it. A 4G handover
 * in the corridor drops the socket for tens of seconds with the conversation
 * still going, and the sweep used to end those calls. This beat is the only
 * thing that can tell it otherwise, so it goes over HTTP — the socket is the
 * transport that may be down.
 *
 * It stops while the engine is recovering, because then the media really is
 * not up and a beat would be a lie that keeps a dead call alive to the cap.
 */
function startMediaBeat(callId: string) {
  stopMediaBeat();
  const beat = () => {
    if (state.call?.call_id !== callId || state.phase !== "in_call" || state.recovering) return;
    void reportCallAlive(callId).catch(() => {
      /* @silent:parse — the beat did not land (offline, a rate limit, a 404
         on a call the server has already closed). The defined fallback is the
         server's own liveness window, which tolerates three missed beats, and
         the 30-minute cap behind it. There is no second action to take. */
    });
  };
  beat();
  mediaBeatTimer = setInterval(beat, MEDIA_BEAT_MS);
}

function stopMediaBeat() {
  if (mediaBeatTimer) clearInterval(mediaBeatTimer);
  mediaBeatTimer = null;
}

function stopEngine() {
  engine?.stop();
  engine = null;
  engineReady = false;
  pendingOffer = null;
  pendingIce = null;
  stopMediaBeat();
  clearRing();
}

/** Things primed inside the tap that no engine took over: release them. */
function releasePrimed(audio: HTMLAudioElement | null, noise: AudioContext | null) {
  if (audio) audio.srcObject = null;
  if (noise) {
    void noise.close().catch(() => {
      /* @silent:teardown — a context that never started. */
    });
  }
}

/** The caller's app language, which is also the draft language. */
function appLanguage(): "en" | "fr" {
  return String(i18n.language || "en").startsWith("fr") ? "fr" : "en";
}

/* ── The record half ─────────────────────────────────────────────────────── */

/** Where a queued part or declaration goes. */
async function sendRecordingItem(item: OutboxItem): Promise<void> {
  if (item.kind === "complete") {
    await completeCallRecording(item.callId, { side: item.side, parts: item.parts });
    return;
  }
  const ext = item.mimeType.includes("mp4") ? "mp4" : item.mimeType.includes("ogg") ? "ogg" : "webm";
  const file = new File([item.blob], `${item.side}-${item.index}.${ext}`, {
    type: item.mimeType || "audio/webm",
  });
  await uploadCallPart(item.callId, file, {
    side: item.side,
    part_index: item.index,
    part_count: item.index,
    duration_ms: Math.min(125_000, Math.round(item.durationMs)),
    language: item.language,
  });
}

let outbox: UploadOutbox | null = null;
/** The upload queue, created on first use (IndexedDB is opened lazily). */
export function callUploads(): UploadOutbox {
  if (!outbox) {
    outbox = new UploadOutbox({
      store: indexedDbStore(),
      send: sendRecordingItem,
      onLost: (item) => {
        if (item.kind === "part" && state.call?.call_id === item.callId) {
          set({ recordingLost: state.recordingLost + 1 });
        }
      },
    });
  }
  return outbox;
}

/** On app load: upload what a closed tab left behind (audit E11). */
export function resumeCallUploads(): void {
  void callUploads().resume().catch(() => {
    /* @silent:storage — nothing stored, or storage refused: nothing to resume. */
  });
}

/**
 * Arm the recorder once media is up, so a call that never connects stores
 * nothing. Each part is a complete file (audit A3) and goes to the outbox as
 * soon as it closes, so it is transcribed during the call.
 */
function armRecording(call: Call, side: "caller" | "callee"): void {
  if (call.recording_enabled === false) return;
  if (recorder || recording) return;
  recording = { callId: call.call_id, side };
  const language = appLanguage();
  const stream = engine?.stream || null;
  if (!stream) return;
  const rec = new CallRecorder({
    callId: call.call_id,
    side,
    language,
    deps: {
      onPart: (part) => callUploads().add({
        id: itemId({ kind: "part", callId: call.call_id, side, index: part.index }),
        kind: "part",
        callId: call.call_id,
        side,
        index: part.index,
        blob: part.blob,
        durationMs: part.durationMs,
        mimeType: part.mimeType,
        language,
        createdAt: Date.now(),
        attempts: 0,
      }),
      onLost: () => set({ recordingLost: state.recordingLost + 1 }),
    },
  });
  recorder = rec;
  rec.arm(stream).catch(() => {
    /* @silent:teardown — this browser will not record (no MediaRecorder, or a
       device that refuses a second consumer of the track). The call is
       unaffected; the side declares zero parts when it ends. */
    if (recorder === rec) recorder = null;
  });
}

/**
 * Stop recording and declare the side, fire and forget. It must run while the
 * mic is still open (`stopEngine` is about to close the tracks); the last part
 * and the declaration then go through the outbox on their own.
 */
function finishRecording(): void {
  const rec = recorder;
  const target = recording;
  recorder = null;
  recording = null;
  if (!target) return;
  const declare = (parts: number) => callUploads().add({
    id: itemId({ kind: "complete", callId: target.callId, side: target.side }),
    kind: "complete",
    callId: target.callId,
    side: target.side,
    parts,
    createdAt: Date.now(),
    attempts: 0,
  });
  void (rec ? rec.finish() : Promise.resolve({ parts: 0, lost: 0 }))
    .then((out) => declare(out.parts))
    .catch(() => {
      /* @silent:storage — the outbox keeps what it could not send, and the
         server's deadline finalises a side that never declared. */
    });
}

/** A ring this tab is showing ended without this tab acting: say how. */
function endRingLocally(callId: string, reason: EndedReason) {
  if (state.call?.call_id !== callId || state.phase !== "incoming") return;
  handledRings.add(callId);
  stopEngine();
  void dismissRingNotification(callId);
  set({ phase: "ended", endedReason: reason });
  toIdleIfEnded(callId);
}

/** Re-read the row after the local countdown reached zero. A row that still
 *  says RINGING is believed for one sweep interval more, then the ring ends
 *  here regardless (audit A13: a ring can never stick). */
async function syncFromRow(callId: string) {
  let row: Call | null = null;
  try {
    row = await getCall(callId);
  } catch {
    /* @silent:parse — a 404/403 means the row is gone or never ours; the
       expiry below ends the ring. */
  }
  if (state.call?.call_id !== callId) return;
  if (row) applyRow(row);
  if (row && row.status === "RINGING") {
    if (!ringExpiryTimer) {
      ringExpiryTimer = setTimeout(() => {
        ringExpiryTimer = null;
        if (state.call?.call_id !== callId) return;
        if (state.phase === "incoming") endRingLocally(callId, "no_answer");
        else if (state.phase === "outgoing") {
          stopEngine();
          set({ phase: "ended", endedReason: "no_answer" });
          toIdleIfEnded(callId);
        }
      }, RING_EXPIRY_GRACE_MS);
    }
    return;
  }
  handledRings.add(callId);
  stopEngine();
  set({
    phase: "ended",
    call: row ?? state.call,
    endedReason: row?.end_reason ?? "no_answer",
  });
  toIdleIfEnded(callId);
}

/** How much of the 60-second window is left on a row we are ringing from. */
function remainingRingSeconds(row: Call): number {
  const started = Date.parse(row.started_at || "");
  if (!Number.isFinite(started)) return RING_TIMEOUT_S;
  const used = Math.floor((Date.now() - started) / 1000);
  return Math.max(1, Math.min(RING_TIMEOUT_S, RING_TIMEOUT_S - used));
}

type IncomingRing = {
  call: Call;
  peerName: string | null;
  secondsLeft: number;
  noiseSuppression?: boolean;
};

/**
 * Show a ring on this tab: from the socket, from the ringing read, from a
 * push the service worker handed over, or from a deep link. Returns false
 * when this tab is busy or has already dealt with that call.
 */
function presentIncoming(ring: IncomingRing): boolean {
  const id = ring.call.call_id;
  if (handledRings.has(id)) return false;
  if (state.call?.call_id === id && state.phase !== "ended") return false;
  if (state.phase !== "idle" && state.phase !== "ended") return false;
  if (ring.secondsLeft <= 0) return false;
  if (ring.noiseSuppression !== undefined) tenantNoiseDefault = ring.noiseSuppression === true;
  clearEndTimer();
  ringStartedAt = Date.now();
  // Candidates for an earlier ring are not this call's.
  if (pendingIce && pendingIce.callId !== id) pendingIce = null;
  set({
    ...INITIAL,
    summaryTick: state.summaryTick,
    elsewhere: state.elsewhere,
    callsAvailable: state.callsAvailable,
    phase: "incoming",
    call: ring.call,
    peerName: ring.peerName,
    ringSecondsLeft: ring.secondsLeft,
    recordingEnabled: ring.call.recording_enabled === true,
    noise: { enabled: resolveNoiseEnabled(), status: "off", reason: null },
  });
  startRingCountdown(() => void syncFromRow(id));
  return true;
}

/** Tell the server which channel this ring landed on (the ring-channel
 *  metric only; it stops nothing on any other device — audit A12). */
function ackRing(callId: string, channel: RingChannel) {
  getCommsSocket().emit("call:ring_ack", { callId, channel });
}

/* ── Actions ─────────────────────────────────────────────────────────────── */

/**
 * Dial. Runs from the tap: the audio element and the noise filter's context
 * are primed synchronously (autoplay rules, audit E4/E5), the phase moves to
 * `dialing` before the first await (a double tap is one call, E7), and the
 * mic is opened BEFORE the server rings anyone (E6). If the engine then
 * fails, the call is hung up rather than left ringing.
 */
export async function dial(groupId: string, peerName: string | null): Promise<void> {
  if (state.phase !== "idle" && state.phase !== "ended") return;
  ensureNoisePref();
  const wantNoise = resolveNoiseEnabled();
  const audio = primeRemoteAudio();
  const noiseCtx = wantNoise ? primeNoiseContext() : null;
  clearEndTimer();
  set({
    ...INITIAL,
    summaryTick: state.summaryTick,
    elsewhere: state.elsewhere,
    callsAvailable: state.callsAvailable,
    phase: "dialing",
    peerName,
    noise: { enabled: wantNoise, status: "off", reason: null },
  });

  let mic: MediaStream;
  try {
    mic = await openMic();
  } catch (err) {
    releasePrimed(audio, noiseCtx);
    if (phaseNow() === "dialing") set({ phase: "idle", lastError: micErrText(err) });
    return;
  }

  let call: Call & { ice: import("@/lib/smartcomm-api").IceConfig };
  try {
    call = await dialCall(groupId);
  } catch (err) {
    mic.getTracks().forEach((t) => t.stop());
    releasePrimed(audio, noiseCtx);
    if (phaseNow() === "dialing") set({ phase: "idle", lastError: errText(err) });
    return;
  }

  // Hung up while the server was creating the ring: cancel it.
  if (phaseNow() !== "dialing") {
    mic.getTracks().forEach((t) => t.stop());
    releasePrimed(audio, noiseCtx);
    void hangupCall(call.call_id).catch(swallowServerEnded);
    return;
  }

  applyRow(call);
  set({ phase: "outgoing", call, ringSecondsLeft: RING_TIMEOUT_S });
  startRingCountdown(() => void syncFromRow(call.call_id));
  const e = makeEngine(true, call.call_id, { audio, noiseCtx });
  engine = e;
  try {
    await e.start(call.ice, mic);
    engineReady = true;
  } catch (err) {
    stopEngine();
    void hangupCall(call.call_id).catch(swallowServerEnded);
    set({ phase: "idle", lastError: errText(err) });
  }
}

/**
 * Answer. Same order as dial: prime in the tap, `connecting` at once, the
 * mic before the server hears "accepted" (E6). A mic that will not open
 * leaves the call ringing for the person's other devices; an engine that
 * fails after the accept reports the failure, so nobody is left IN_CALL.
 */
/** Answer the ringing call. `record: false` answers without recording
 *  (PR-6, audit G5): the server stores the choice and neither side records. */
export async function answer(opts: { record?: boolean } = {}): Promise<void> {
  const call = state.call;
  if (!call || state.phase !== "incoming") return;
  const id = call.call_id;
  ensureNoisePref();
  const wantNoise = resolveNoiseEnabled();
  const audio = primeRemoteAudio();
  const noiseCtx = wantNoise ? primeNoiseContext() : null;
  handledRings.add(id);
  clearRing();
  set({ phase: "connecting", noise: { enabled: wantNoise, status: "off", reason: null } });
  void dismissRingNotification(id);

  let mic: MediaStream;
  try {
    mic = await openMic();
  } catch (err) {
    releasePrimed(audio, noiseCtx);
    set({ phase: "idle", lastError: micErrText(err) });
    return;
  }

  let row: Call & { ice: import("@/lib/smartcomm-api").IceConfig };
  try {
    row = await acceptCall(id, { record: opts.record });
  } catch (err) {
    mic.getTracks().forEach((t) => t.stop());
    releasePrimed(audio, noiseCtx);
    stopEngine();
    set({ phase: "idle", lastError: errText(err) });
    return;
  }
  if (state.call?.call_id !== id || phaseNow() !== "connecting") {
    // Ended while the accept was in flight (a terminal event won).
    mic.getTracks().forEach((t) => t.stop());
    releasePrimed(audio, noiseCtx);
    return;
  }
  applyRow(row);
  set({ call: row });
  const e = makeEngine(false, id, { audio, noiseCtx });
  engine = e;
  try {
    await e.start(row.ice, mic);
    engineReady = true;
    const buffered = pendingIce && pendingIce.callId === id ? pendingIce.candidates : [];
    pendingIce = null;
    for (const c of buffered) void e.addRemoteIceCandidate(c);
    if (pendingOffer && pendingOffer.callId === id) {
      const sdp = pendingOffer.sdp;
      pendingOffer = null;
      await e.applyRemoteDescription({ type: "offer", sdp });
    }
    // Listening now: the caller re-sends its offer if we never got it (E3).
    getCommsSocket().emit("call:ready", { callId: id });
  } catch {
    stopEngine();
    try {
      const failed = await reportCallFailure(id);
      set({ phase: "ended", call: failed, endedReason: failed.end_reason ?? "ice_failed" });
    } catch (err) {
      swallowServerEnded(err);
      set({ phase: "ended", endedReason: "ice_failed" });
    }
    toIdleIfEnded(id);
  }
}

export async function decline(): Promise<void> {
  const call = state.call;
  if (!call) return;
  const id = call.call_id;
  handledRings.add(id);
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
    if (state.call?.call_id === id && state.phase === "incoming") {
      set({ phase: "ended", endedReason: "declined" });
    }
  }
  toIdleIfEnded(id);
}

export async function hangup(): Promise<void> {
  // Before the server has answered the dial there is no call to end: going
  // idle is the cancel, and dial() hangs up the call when it arrives.
  if (state.phase === "dialing") {
    set({ phase: "idle" });
    return;
  }
  const call = state.call;
  if (!call) return;
  const id = call.call_id;
  handledRings.add(id);
  // BEFORE stopEngine: the recorder's final chunk needs the open mic.
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

/** "Tap to hear": play the other side's voice from a fresh gesture (E4). */
export async function resumeAudio(): Promise<void> {
  const ok = await engine?.resumeAudio();
  if (ok) set({ audioBlocked: false });
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
  // Not a ring this tab is only showing: the server reads a callee's
  // hang-up while ringing as a decline, and the person's other devices are
  // still ringing (audit A12).
  if (phase !== "in_call" && phase !== "connecting" && phase !== "outgoing") return;
  try {
    const h = new Headers();
    h.set("Content-Type", "application/json");
    h.set("X-Praxis-Env", tokenStore.getEnv());
    const t = tokenStore.getAccess();
    if (t) h.set("Authorization", `Bearer ${t}`);
    void fetch(callHangupUrl(call.call_id), {
      method: "POST",
      headers: h,
      // No reason: the server decides how a call ended (audit B9).
      body: "{}",
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
  engine?.setMuted(muted);
}

/* ── Engine construction (both roles share the wiring) ──────────────────── */

function makeEngine(
  isCaller: boolean,
  callId: string,
  primed: { audio: HTMLAudioElement | null; noiseCtx: AudioContext | null },
) {
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
        // Media is up: this is the moment the record starts (PR-2)...
        if (state.call) armRecording(state.call, isCaller ? "caller" : "callee");
        // ...and the moment the server can be told so (FN-2).
        startMediaBeat(callId);
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
      onQuality: (sample) => set({ quality: sample }),
      onNoiseFilter: (status, reason) =>
        set({ noise: { enabled: e.noiseWanted, status, reason } }),
      onRecovering: (recovering) => set({ recovering }),
      onAudioBlocked: (blocked) => set({ audioBlocked: blocked }),
      onWarnMaxDuration: () => set({ warning: true }),
      onMaxDuration: () => void hangup(),
      onLocalMuted: (m) => set({ muted: m }),
    },
    isCaller,
  );
  e.noiseWanted = resolveNoiseEnabled();
  e.audioElement = primed.audio;
  e.noiseContext = primed.noiseCtx;
  // A fresh TURN credential before an ICE restart (PR-3's GET /calls/:id/turn).
  e.refreshIce = () => getCallTurn(callId);
  set({ noise: { enabled: e.noiseWanted, status: "off", reason: null } });
  return e;
}

/* ── Rings the socket did not deliver (audit A13) ───────────────────────── */

let lastReconcile = 0;
let reconciling: Promise<void> | null = null;

function ringFromRow(r: RingingCall): IncomingRing {
  return {
    call: {
      call_id: r.call_id,
      group_id: r.group_id,
      caller_id: r.caller_id,
      callee_id: r.callee_id,
      status: "RINGING",
      started_at: r.started_at,
      caller_name: r.caller_name ?? null,
      recording_enabled: r.recording_enabled === true,
    },
    peerName: r.caller_name ?? null,
    secondsLeft: Math.max(0, Math.min(RING_TIMEOUT_S, Math.floor(r.ring_seconds_left))),
    noiseSuppression: r.noise_suppression,
  };
}

/**
 * Ask the server what is ringing for me, and merge it with what this tab
 * shows: a ring the socket never delivered (the app opened because the phone
 * buzzed) appears; a ring the server no longer lists ends. Runs on socket
 * connect and reconnect, on return to the foreground, and when the service
 * worker hands over a push.
 */
export function reconcileRinging(force = false): Promise<void> {
  if (reconciling) return reconciling;
  const now = Date.now();
  if (!force && now - lastReconcile < RECONCILE_MIN_MS) return Promise.resolve();
  lastReconcile = now;
  reconciling = (async () => {
    let rows: RingingCall[];
    try {
      rows = await getRingingCalls();
    } catch (err) {
      // 403: calls are off for this tenant, or not this person's to use.
      if (err instanceof ApiError && err.status === 403) set({ callsAvailable: false });
      /* @silent:parse — offline or signed out: the socket and the next
         foreground try again. */
      return;
    }
    if (state.callsAvailable !== true) set({ callsAvailable: true });
    const current = state.call?.call_id;
    if (state.phase === "incoming" && current && !rows.some((r) => r.call_id === current)
        && Date.now() - ringStartedAt > RECONCILE_GRACE_MS) {
      void syncFromRow(current);
    }
    for (const r of rows) {
      if (presentIncoming(ringFromRow(r))) {
        const viaPush = pendingLink?.callId === r.call_id;
        ackRing(r.call_id, viaPush ? "push" : "socket");
        break;
      }
    }
  })().finally(() => {
    reconciling = null;
  });
  return reconciling;
}

/* ── The service worker's half (audit A8, A14, PR-4 steps 5–7) ──────────── */

type WorkerMessage =
  | { type: "praxis:call-ring"; data?: { call_id?: string } }
  | { type: "praxis:call-cancel"; data?: { call_id?: string; outcome?: string } }
  | { type: "praxis:call-action"; call_id?: string; act?: string };

/** Why a ring ended, from a cancel push's outcome. */
function reasonForOutcome(outcome: string | undefined): EndedReason {
  if (outcome === "answered") return "answered_elsewhere";
  if (outcome === "declined") return "declined";
  if (outcome === "missed") return "no_answer";
  return "ended";
}

function onWorkerMessage(msg: WorkerMessage) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "praxis:call-ring") {
    // A push reached a visible app: ring in-app from the server's truth.
    void reconcileRinging(true);
  } else if (msg.type === "praxis:call-cancel") {
    const id = msg.data?.call_id;
    if (id) endRingLocally(id, reasonForOutcome(msg.data?.outcome));
  } else if (msg.type === "praxis:call-action") {
    const id = msg.call_id;
    const act = msg.act === "accept" || msg.act === "decline" ? msg.act : null;
    if (id) actOnCallIntent({ callId: id, action: act });
  }
}

/* ── Server → this tab (wired once, app lifetime) ───────────────────────── */

let wired = false;
export function wireCallSocket(): void {
  if (wired) return;
  wired = true;
  const s = getCommsSocket();
  resumeCallUploads();

  s.on("call:ringing", (p: { call_id: string; group_id?: string; from: { user_id: string; name?: string | null }; ring_timeout_s?: number; recording_enabled?: boolean; noise_suppression?: boolean }) => {
    const shown = presentIncoming({
      call: {
        call_id: p.call_id,
        group_id: p.group_id || "",
        caller_id: p.from.user_id,
        callee_id: currentUserId() || "",
        status: "RINGING",
        started_at: new Date().toISOString(),
        recording_enabled: p.recording_enabled === true,
      },
      peerName: p.from.name || null,
      secondsLeft: p.ring_timeout_s ?? RING_TIMEOUT_S,
      noiseSuppression: p.noise_suppression,
    });
    if (!shown) return;
    // Which channel reached this device, for the ring-channel metric: a
    // visible tab is `socket`, a hidden one that showed a notification is
    // `notification`, an app opened from the push is `push`.
    const viaPush = pendingLink?.callId === p.call_id;
    void (async () => {
      const channel: RingChannel | null = viaPush
        ? "push"
        : await presentRing({
            callId: p.call_id,
            peerName: p.from.name || null,
            recordingEnabled: p.recording_enabled === true,
          });
      if (channel) ackRing(p.call_id, channel);
      if (viaPush) pendingLink = null;
    })();
  });

  // The caller's other tabs: this user is calling from another device.
  s.on("call:ringing_sent", (p: { call_id: string; to?: { user_id: string; name?: string | null } }) => {
    if (!p || !p.call_id || state.call?.call_id === p.call_id) return;
    set({ elsewhere: { callId: p.call_id, peerName: p.to?.name ?? null, status: "ringing" } });
  });

  s.on("call:offer", (p: { call_id: string; sdp: string }) => {
    if (state.call?.call_id !== p.call_id) return;
    if (engineReady && engine) {
      engine.applyRemoteDescription({ type: "offer", sdp: p.sdp }).catch(() => {
        /* @silent:parse — a description that does not apply (the call closed,
           a stale glare); the ICE timers report a real failure. */
      });
    } else {
      pendingOffer = { callId: p.call_id, sdp: p.sdp };
    }
  });

  s.on("call:answer", (p: { call_id: string; sdp: string }) => {
    if (!engineReady || !engine || state.call?.call_id !== p.call_id) return;
    engine.applyRemoteDescription({ type: "answer", sdp: p.sdp }).catch(() => {
      /* @silent:parse — a late or duplicated answer is a no-op. */
    });
  });

  s.on("call:ice", (p: { call_id: string; candidate: unknown | null }) => {
    if (state.call?.call_id !== p.call_id) return;
    if (engine) {
      void engine.addRemoteIceCandidate(p.candidate);
      return;
    }
    // Still ringing here: keep them for the engine the answer creates (E2).
    if (!pendingIce || pendingIce.callId !== p.call_id) pendingIce = { callId: p.call_id, candidates: [] };
    pendingIce.candidates.push(p.candidate);
  });

  // The callee's engine is listening (E3).
  s.on("call:ready", (p: { call_id: string }) => {
    if (!p || state.call?.call_id !== p.call_id) return;
    engine?.peerReady();
  });

  s.on("call:accepted", (p: { call_id: string; recording_enabled?: boolean }) => {
    const id = p && p.call_id;
    if (!id) return;
    // The callee may have answered without recording (PR-6, audit G5): the
    // caller must neither arm the recorder nor show the recorded banner.
    if (state.call?.call_id === id && p.recording_enabled === false) {
      set({ call: { ...state.call, recording_enabled: false }, recordingEnabled: false });
    }
    if (state.call?.call_id !== id) {
      if (state.elsewhere?.callId === id) set({ elsewhere: { ...state.elsewhere, status: "in_call" } });
      return;
    }
    // This device was ringing and another device of mine answered (E8).
    if (state.phase === "incoming") {
      endRingLocally(id, "answered_elsewhere");
      return;
    }
    if (state.phase === "outgoing") set({ phase: "connecting" });
  });

  const onTerminal = (p: { call_id: string; status?: string; reason?: string; duration_seconds?: number | null; ended_at?: string | null }) => {
    if (state.elsewhere?.callId === p.call_id) set({ elsewhere: null });
    if (state.call?.call_id !== p.call_id) return;
    handledRings.add(p.call_id);
    // The other end hung up, or the sweep ended the call: the recorder's
    // tail is uploaded exactly as if we had pressed hang-up.
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
  s.on("call:summary_ready", (p: { call_id: string; status?: string; redraft?: boolean }) => {
    if (!p || !p.call_id) return;
    set({ summaryTick: state.summaryTick + 1 });
    if (!p.redraft) set({ summaryNotice: { call_id: p.call_id, status: p.status || "PENDING_REVIEW" } });
  });
  s.on("call:transcription_failed", (p: { call_id: string; reason?: string }) => {
    if (p && p.call_id) set({ transcriptionIssue: { call_id: p.call_id, reason: p.reason || "" } });
  });
  s.on("call:ended", onTerminal);
  s.on("call:cancelled", onTerminal);
  s.on("call:declined", onTerminal);
  s.on("call:no_answer", onTerminal);

  // A13: every moment this tab may have missed a `call:ringing` — now (the
  // socket may have connected before these handlers existed), each
  // (re)connect, the return to the foreground, and the network coming back.
  s.on("connect", () => void reconcileRinging(true));
  void reconcileRinging(true);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void reconcileRinging();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => void reconcileRinging());
    window.addEventListener("online", () => void reconcileRinging(true));
  }
  if (typeof navigator !== "undefined" && navigator.serviceWorker?.addEventListener) {
    navigator.serviceWorker.addEventListener("message", (ev: MessageEvent) => onWorkerMessage(ev.data as WorkerMessage));
  }
}

/* ── The noise switch, the redial path ──────────────────────────────────── */

/**
 * The overlay's noise switch: live (replaceTrack, no renegotiation) and
 * persisted to `/me/preferences/calls`. Called from the tap, so turning it on
 * mid-call can start a fresh AudioContext in the gesture.
 */
export async function setNoise(enabled: boolean): Promise<void> {
  ensureNoisePref();
  userNoisePref = enabled;
  if (enabled && engine && (!engine.noiseContext || engine.noiseContext.state === "closed")) {
    engine.noiseContext = primeNoiseContext();
  }
  // `enabled` is what the person asked for; `status` is what the audio graph
  // is doing, which the engine reports once the worklet has loaded or failed.
  set({
    noise: {
      enabled,
      status: enabled ? state.noise.status : "off",
      reason: enabled ? state.noise.reason : null,
    },
  });
  void saveCallPrefs({ noiseSuppression: enabled }).catch(() => {
    /* @silent:storage — the switch took effect for this call either way. */
  });
  await engine?.setNoiseSuppression(enabled);
}

/** Dismiss the redial banner without dialing. */
export function dismissRedial(): void {
  set({ redial: null });
}

/** One-tap redial after an expired ring link opened a call that is over. */
export async function redial(): Promise<void> {
  const r = state.redial;
  if (!r) return;
  set({ redial: null });
  await dial(r.groupId, r.name);
}

/* ── Ring links and notification actions (audit A8, PR-4 step 7) ────────── */

/**
 * The app's boot, signed in: act on a ring link (`/comms?ring=<id>&act=…`)
 * in the URL, or on one kept across a login redirect (call-intent.ts). The
 * old `?call=` summary link never reaches here (audit A6). Never throws.
 */
export function initCallDeepLink(search: string): void {
  const link = parseCallLink(search) ?? takeCallIntent();
  if (!link) return;
  actOnCallIntent({ callId: link.callId, action: link.action });
}

/**
 * A ring link, or a notification's Answer/Decline handed over by the service
 * worker without a reload. The row decides: still ringing for me → ring
 * (and answer or decline if asked); over → the redial offer, never a ring.
 */
export function actOnCallIntent(link: { callId: string; action: "accept" | "decline" | null }): void {
  pendingLink = link;
  void hydrateFromLink(link);
}

async function hydrateFromLink(link: { callId: string; action: "accept" | "decline" | null }): Promise<void> {
  // The socket (or the ringing read) already has this ring.
  if (state.call?.call_id === link.callId && state.phase === "incoming") {
    if (link.action === "accept") await answer();
    if (link.action === "decline") await decline();
    pendingLink = null;
    return;
  }
  if (state.call?.call_id === link.callId && state.phase !== "ended") return;
  if (state.phase !== "idle" && state.phase !== "ended") return;

  let row: Call | null = null;
  try {
    row = await getCall(link.callId);
  } catch {
    /* @silent:parse — an unknown or forbidden id is the same as an expired
       one: nothing to answer. */
  }
  if (state.call?.call_id === link.callId && phaseNow() === "incoming") {
    if (link.action === "accept") await answer();
    if (link.action === "decline") await decline();
    pendingLink = null;
    return;
  }

  if (row && row.status === "RINGING" && row.callee_id === (currentUserId() || "")) {
    if (link.action === "decline") {
      // Decline from the notification: no ring screen on the way.
      pendingLink = null;
      handledRings.add(link.callId);
      void dismissRingNotification(link.callId);
      try {
        const declined = await declineCall(link.callId);
        set({ phase: "ended", call: declined, peerName: row.caller_name || null, endedReason: declined.end_reason ?? "declined" });
        toIdleIfEnded(link.callId);
      } catch (err) {
        swallowServerEnded(err);
      }
      return;
    }
    handledRings.delete(link.callId);
    const shown = presentIncoming({ call: row, peerName: row.caller_name || null, secondsLeft: remainingRingSeconds(row) });
    if (shown) ackRing(link.callId, "push");
    pendingLink = null;
    if (shown && link.action === "accept") await answer();
    return;
  }

  // Over (or never ours): the one-tap redial path, never a ring.
  pendingLink = null;
  void dismissRingNotification(link.callId);
  const groupId = row?.group_id || null;
  if (groupId) {
    set({ redial: { groupId, name: row?.caller_name || null } });
  } else {
    set({ lastError: tr("That call has already ended") });
  }
}

export { setMuted };

/** The shell has shown the summary notice. */
/** The "transcription failed" line has been shown (audit N4). */
export function clearTranscriptionIssue(): void {
  set({ transcriptionIssue: null });
}

export function clearSummaryNotice(): void {
  set({ summaryNotice: null });
}

/** The shell has shown the "on another device" status. */
export function clearElsewhere(): void {
  set({ elsewhere: null });
}
