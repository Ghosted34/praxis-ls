/**
 * 1:1 voice call engine (Smart Comms PR-1) — the P2P half.
 *
 * Media goes peer-to-peer (Opus over the WebRTC data path); this process never
 * sees audio. The engine's jobs are exactly four:
 *
 *   1. open the mic with the house constraints (echoCancellation +
 *      noiseSuppression + autoGainControl — the WhatsApp-parity baseline for
 *      an office floor),
 *   2. drive one RTCPeerConnection per side (caller creates the offer, callee
 *      answers, both trickle ICE),
 *   3. report connection/failure UP to the server row (`call:connected` is
 *      the accept path, `ice_failed` closes a call that never connected),
 *   4. run the two CLIENT-side UX clocks: the 29:00 "one minute left" warning
 *      and the 30:00 hang-up. The SERVER sweep is the authority (a closed tab
 *      still gets its call ended by the row); these timers are for the tabs
 *      that are still open, which deserve the warning before the floor.
 *
 * Signaling is not owned here: `onSignal`/`onIce` hand the SDP and candidates
 * to the session (use-call), which routes them over the comms socket. That
 * keeps this file testable without a socket and the socket code free of
 * WebRTC.
 */
import type { IceConfig } from "@/lib/smartcomm-api";

export const RING_TIMEOUT_S = 60;
export const MAX_CALL_S = 1800;
export const MAX_CALL_WARN_S = MAX_CALL_S - 60;
/** Give the media path this long after the answer before declaring
 *  ice_failed — slow yards and cold NATs are normal, a minute is not. */
export const ICE_GRACE_MS = 30_000;

export type EnginePhase =
  | "idle"
  | "dialing" // caller: ring sent, waiting for the answer
  | "connecting" // offer/answer in flight either way
  | "in_call"
  | "ended";

export type EngineEvents = {
  /** Local SDP ready to send to the other participant (offer, then answer). */
  onSignal?: (sdp: string, kind: "offer" | "answer") => void;
  /** Local ICE candidate ready to trickle. `null` = gathering finished. */
  onIce?: (candidate: unknown | null) => void;
  /** Media path is up. The session calls the server's accept from here. */
  onConnected?: () => void;
  /** ICE failed or the grace window closed with no connection. */
  onFailed?: (reason: string) => void;
  /** 29:00 — the UI shows the countdown; 30:00 is followed by hangup(). */
  onWarnMaxDuration?: () => void;
  onMaxDuration?: () => void;
  /** Once per second while in_call, for the UI clock. */
  onTick?: (elapsedSeconds: number) => void;
  /** The remote audio track arrived — attach it to an <audio> element. */
  onRemoteStream?: (stream: MediaStream) => void;
  /** Local mic state (permission denied, device lost, user muted). */
  onLocalMuted?: (muted: boolean) => void;
};

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

type PCT = {
  setRemoteDescription(d: { type: "offer" | "answer"; sdp: string }): Promise<void>;
  createOffer(): Promise<{ sdp?: string }>;
  createAnswer(): Promise<{ sdp?: string }>;
  setLocalDescription(d: { type: "offer" | "answer"; sdp: string }): Promise<void>;
  addTrack(track: MediaStreamTrack, stream: MediaStream): unknown;
  addIceCandidate(c: unknown): Promise<void>;
  close(): void;
  onicecandidate: ((e: { candidate: unknown | null }) => void) | null;
  oniceconnectionstatechange: ((e: Event) => void) | null;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null;
  addEventListener?: (type: string, fn: () => void) => void;
  iceConnectionState?: string;
  [k: string]: unknown;
};

export class CallEngine {
  phase: EnginePhase = "idle";
  private pc: PCT | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private events: EngineEvents;
  private isCaller: boolean;
  private connectedAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private iceGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private warnSent = false;
  private remoteAudio: HTMLAudioElement | null = null;
  /** Injected for tests — the session can swap in a fake connection. */
  connectionFactory?: () => PCT;

  constructor(events: EngineEvents, isCaller: boolean) {
    this.events = events;
    this.isCaller = isCaller;
  }

  /** The local mic stream, so the RECORDER (PR-2) can tap the same track the
   *  call is using. A second getUserMedia would be a second permission prompt
   *  and, on some devices, a second device open. Null once stopped. */
  get stream(): MediaStream | null {
    return this.localStream;
  }

  get localMuted(): boolean {
    const t = this.localStream?.getAudioTracks()[0];
    return t ? !t.enabled : true;
  }

  setMuted(muted: boolean) {
    const t = this.localStream?.getAudioTracks()[0];
    if (t) {
      t.enabled = !muted;
      this.events.onLocalMuted?.(muted);
    }
  }

  /**
   * Open the mic and (caller) start the offer. The callee opens the mic NOW
   * too — a call that rings 40 s and connects should not spend the first
   * second of media negotiating the camera roll.
   */
  async start(ice: IceConfig): Promise<void> {
    this.localStream = await openMic();
    this.pc = this.makeConnection(ice);
    this.localStream.getAudioTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!));

    this.pc.onicecandidate = (e) => this.events.onIce?.(e.candidate || null);
    this.pc.ontrack = (e) => {
      // The event's streams array carries the remote track(s); an empty one
      // (a mid-call renegotiation) leaves the existing stream untouched.
      if (e.streams.length > 0) this.remoteStream = e.streams[0];
      if (!this.remoteStream) return;
      this.attachRemoteAudio(this.remoteStream);
      this.events.onRemoteStream?.(this.remoteStream);
    };
    this.pc.oniceconnectionstatechange = () => this.iceStateChanged();

    if (this.isCaller) {
      this.phase = "dialing";
      const offer = await this.pc.createOffer();
      if (!offer.sdp) throw new Error("no offer SDP");
      await this.pc.setLocalDescription({ type: "offer", sdp: offer.sdp });
      this.events.onSignal?.(offer.sdp, "offer");
      this.phase = "connecting";
    } else {
      this.phase = "connecting";
    }
  }

  /** A remote offer (callee side): answer it. */
  async applyRemoteOffer(sdp: string): Promise<void> {
    if (!this.pc) throw new Error("engine not started");
    await this.pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await this.pc.createAnswer();
    if (!answer.sdp) throw new Error("no answer SDP");
    await this.pc.setLocalDescription({ type: "answer", sdp: answer.sdp });
    this.events.onSignal?.(answer.sdp, "answer");
    this.armIceGrace();
  }

  /** A remote answer (caller side): the other end is in. */
  async applyRemoteAnswer(sdp: string): Promise<void> {
    if (!this.pc) throw new Error("engine not started");
    await this.pc.setRemoteDescription({ type: "answer", sdp });
    this.armIceGrace();
  }

  async addRemoteIceCandidate(candidate: unknown | null): Promise<void> {
    if (!this.pc || candidate === null) return;
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      /* @silent:parse — an out-of-order or post-close ICE candidate is not
         data we can act on: the candidates that matter (host, srflx) were
         already applied, and the spec-correct answer to "too late" is to drop
         it. Throwing would take a live call down for a race nobody can fix
         from the UI. */
    }
  }

  /** Tear everything down. Idempotent — the UI may call it on hang-up, on
   *  failure and on unmount of the overlay, and all three must be safe. */
  stop() {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.clearTimers();
    try {
      this.pc?.close();
    } catch {
      // @silent:teardown — a connection already closed closes nothing.
    }
    this.pc = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
    this.remoteStream = null;
  }

  private makeConnection(ice: IceConfig): PCT {
    if (this.connectionFactory) return this.connectionFactory();
    return new RTCPeerConnection({ iceServers: ice.iceServers as any }) as unknown as PCT;
  }

  private attachRemoteAudio(stream: MediaStream) {
    // The <audio> element is created here, not in a component: the element
    // must outlive React re-renders, and autoplay policy is satisfied because
    // the user gesture (dial / answer) is still in the page's gesture chain
    // on the connecting side.
    const el = new Audio();
    el.srcObject = stream;
    el.autoplay = true;
    this.remoteAudio = el;
  }

  private iceStateChanged() {
    const state = String((this.pc as unknown as { iceConnectionState?: string })?.iceConnectionState || "");
    if (state === "connected" || state === "completed") {
      if (this.connectedAt) return;
      this.connectedAt = Date.now();
      this.phase = "in_call";
      this.clearIceGrace();
      this.events.onConnected?.();
      this.startClock();
    } else if (state === "failed" || state === "disconnected") {
      // "disconnected" is transient (wifi handover) — give the ICE grace
      // window to recover before "failed" closes the call. Only a hard
      // "failed" reports immediately.
      if (state === "failed") this.fail("ice_failed");
    }
  }

  private fail(reason: string) {
    if (this.failed) return;
    this.failed = true;
    this.events.onFailed?.(reason);
  }

  private armIceGrace() {
    this.clearIceGrace();
    this.iceGraceTimer = setTimeout(() => this.fail("ice_timeout"), ICE_GRACE_MS);
  }
  private clearIceGrace() {
    if (this.iceGraceTimer) clearTimeout(this.iceGraceTimer);
    this.iceGraceTimer = null;
  }

  private startClock() {
    this.clearTimers();
    let elapsed = 0;
    this.tickTimer = setInterval(() => {
      elapsed += 1;
      this.events.onTick?.(elapsed);
      if (!this.warnSent && elapsed >= MAX_CALL_WARN_S) {
        this.warnSent = true;
        this.events.onWarnMaxDuration?.();
      }
      if (elapsed >= MAX_CALL_S) {
        this.events.onMaxDuration?.();
        this.stop();
      }
    }, 1000);
  }

  private clearTimers() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.warnTimer) clearTimeout(this.warnTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.tickTimer = this.warnTimer = this.endTimer = null;
  }
}

/** The mic, once. The constraints are the baseline (guide §4.3): a call on
 *  an open floor without echoCancellation is feedback, and feedback is how
 *  "better than WhatsApp" dies in the first five minutes of a trial. */
export async function openMic(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("no-media-device");
  }
  return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
}
