/**
 * 1:1 voice call engine — the P2P half. Media is peer-to-peer; this process
 * never sees audio. The engine opens the mic, drives one RTCPeerConnection,
 * reports connection or failure to the session, and runs the client's 29:00
 * warning and 30:00 hang-up (the server sweep is the authority).
 *
 * Signalling is the "perfect negotiation" pattern (calls audit E1–E3): every
 * description goes out from `negotiationneeded`, the callee is polite (it
 * rolls back on glare), the caller is impolite (it ignores a colliding
 * offer), and remote candidates wait until there is a remote description.
 * Only the caller opens the first negotiation. Either side can restart ICE.
 *
 * Signalling transport is not owned here: `onSignal`/`onIce` hand SDP and
 * candidates to the session, which routes them over the comms socket.
 */
import type { IceConfig } from "@/lib/smartcomm-api";

export const RING_TIMEOUT_S = 60;
export const MAX_CALL_S = 1800;
export const MAX_CALL_WARN_S = MAX_CALL_S - 60;

/** The peer connection's configuration from the server's ICE config. The
 *  relay-only policy (audit C13) is passed through as given: when the tenant
 *  asked for it, a call that cannot relay does not fall back to exposing
 *  addresses. */
export function rtcConfiguration(ice: IceConfig): RTCConfiguration {
  return {
    iceServers: ice.iceServers as RTCIceServer[],
    iceTransportPolicy: ice.iceTransportPolicy === "relay" ? "relay" : "all",
  };
}
/** Give the media path this long after the answer before declaring
 *  ice_failed — slow yards and cold NATs are normal, a minute is not. */
export const ICE_GRACE_MS = 30_000;

/** Recovery window after ICE drops mid-call. A Wi-Fi → 4G switch needs the
 *  socket to reconnect (socket.io backs off up to ~5 s) before the restart
 *  offer can even travel, then a fresh ICE check; ten seconds was not enough. */
export const ICE_RECOVERY_MS = 20_000;

/** Refresh the TURN credential before an ICE restart when it expires within
 *  this long (GET /calls/:id/turn). */
export const TURN_REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * How often a browser tells the server its media path is up (field note
 * FN-2). The server's key lives for PRESENCE.mediaBeatS = 75 s, so three
 * beats may be lost — a throttled background tab, a slow request, a retry —
 * before the call looks silent to the liveness sweep.
 */
export const MEDIA_BEAT_MS = 20_000;

/** How often the quality sampler reads getStats(). Two seconds is the web
 *  default for this (the WebRTC samples use 1–2 s), and the dot is a slow
 *  human signal — a faster poll buys nothing but CPU on a phone that is already
 *  encoding Opus. */
export const STATS_INTERVAL_MS = 2000;

/** Where the noise filter ended up. `unavailable` is a first-class outcome,
 *  not an error: the call is fine, the filter is not there, and §4.7 says the
 *  user is told. */
export type NoiseFilterStatus = "on" | "off" | "unavailable";
export type NoiseFilterReason =
  | "no_audio_context"
  | "no_audio_track"
  | "worklet_unsupported"
  | "wasm_load_failed"
  | "init_failed"
  /** The AudioContext would not start (no gesture, or the OS refused). */
  | "suspended"
  /** The filter sent silence while the microphone heard speech (audit E5). */
  | "silent_output";

export type Quality = "good" | "fair" | "poor";

export type QualitySample = {
  state: Quality;
  rttMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
};

/**
 * Good / fair / poor from one getStats() sample (guide §3.4, §4.4).
 *
 * The thresholds are the guide's: >600 ms RTT is "poor connection". Jitter and
 * loss join it because on a corridor 4G link the RTT can look acceptable while
 * the audio is arriving in bursts — the thing the user actually hears — and a
 * dot that only watched RTT would stay green through it.
 *
 * Any single bad dimension decides the verdict: the dot answers "is this call
 * comfortable", and the worst signal is the answer. The boundaries are fixed
 * numbers here rather than a rolling average of this device's history: the dot
 * is a statement about RIGHT NOW, and a slow-moving baseline would keep it
 * green through the ten seconds that matter.
 */
export function qualityFor(sample: {
  rttMs?: number | null;
  jitterMs?: number | null;
  lossPct?: number | null;
}): Quality {
  const rtt = sample.rttMs ?? null;
  const jitter = sample.jitterMs ?? null;
  const loss = sample.lossPct ?? null;
  if ((rtt !== null && rtt > 600) || (jitter !== null && jitter > 100) || (loss !== null && loss > 5)) {
    return "poor";
  }
  // `>=` on the fair boundary on purpose: 300 ms is already the point at which
  // two people start talking over each other, so it is the first half-second of
  // the dot's warning rather than the last millisecond of "good".
  if ((rtt !== null && rtt >= 300) || (jitter !== null && jitter > 50) || (loss !== null && loss > 2)) {
    return "fair";
  }
  return "good";
}

/**
 * `playoutDelayHint` from the measured RTT (§4.4's "ICE & network recovery
 * polish").
 *
 * The jitter buffer trades latency for continuity: too small and a corridor
 * handover turns into chopped syllables, too large and the call feels like a
 * satellite link. The browser's default is tuned for the open internet, so this
 * sets it from what the link is actually doing — half the round trip (the
 * time we cannot avoid) plus a two-jitter allowance for the next packet, floored
 * so a perfect LAN link still buffers something, capped at half a second
 * because beyond that the conversation itself breaks down.
 *
 * Returns SECONDS, which is what the property takes. Null when there is nothing
 * to base it on — the caller then leaves the browser's default alone rather
 * than guessing.
 */
export function playoutDelayForSample(sample: {
  rttMs?: number | null;
  jitterMs?: number | null;
}): number | null {
  // `Number(null)` is 0 and `Number(undefined)` is NaN, and only one of those
  // is a measurement — so the absence check comes first. A dot that read a
  // missing RTT as 0 ms would set the smallest possible buffer on the worst
  // possible sample.
  if (sample.rttMs === null || sample.rttMs === undefined) return null;
  const rtt = Number(sample.rttMs);
  if (!Number.isFinite(rtt) || rtt < 0) return null;
  const jitter = Number.isFinite(Number(sample.jitterMs)) ? Number(sample.jitterMs) : 0;
  const seconds = rtt / 2 / 1000 + (2 * jitter) / 1000;
  return Math.min(0.5, Math.max(0.02, Number(seconds.toFixed(3))));
}

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
  /** A getStats() sample, every STATS_INTERVAL_MS while in_call (PR-3). */
  onQuality?: (sample: QualitySample) => void;
  /** The noise filter's outcome, once the worklet has loaded or failed (PR-3).
   *  Fires for BOTH, because the overlay's sentence depends on it. */
  onNoiseFilter?: (status: NoiseFilterStatus, reason: NoiseFilterReason | null) => void;
  /** The media path dropped and is being recovered (PR-3): the UI may say
   *  "reconnecting…" rather than pretending nothing happened. */
  onRecovering?: (recovering: boolean) => void;
  /** The browser refused to play the remote audio (autoplay rules, audit E4):
   *  the call screen offers "Tap to hear". False once it plays. */
  onAudioBlocked?: (blocked: boolean) => void;
};

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

export type SessionDescription = { type: "offer" | "answer"; sdp: string };

type PCT = {
  setRemoteDescription(d: SessionDescription): Promise<void>;
  createOffer(options?: { iceRestart?: boolean }): Promise<{ sdp?: string }>;
  createAnswer(): Promise<{ sdp?: string }>;
  setLocalDescription(d?: { type: "offer" | "answer" | "rollback"; sdp?: string }): Promise<void>;
  addTrack(track: MediaStreamTrack, stream: MediaStream): unknown;
  addIceCandidate(c?: unknown): Promise<void>;
  close(): void;
  onicecandidate: ((e: { candidate: unknown | null }) => void) | null;
  oniceconnectionstatechange: ((e: Event) => void) | null;
  onnegotiationneeded?: (() => void) | null;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null;
  iceConnectionState?: string;
  signalingState?: string;
  localDescription?: { type: string; sdp: string } | null;
  remoteDescription?: { type: string; sdp: string } | null;
  getConfiguration?: () => RTCConfiguration;
  setConfiguration?: (c: RTCConfiguration) => void;
  getStats?: () => Promise<unknown>;
  getSenders?: () => Array<{ track?: MediaStreamTrack | null; replaceTrack?: (t: MediaStreamTrack | null) => Promise<void> }>;
  getReceivers?: () => Array<{ playoutDelayHint?: number | null }>;
  restartIce?: () => void;
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
  /** Injected for tests — the session can swap in a fake connection. */
  connectionFactory?: () => PCT;

  /* ── Perfect negotiation (audit E1–E3) ─────────────────────────────────── */
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  /** Remote candidates that arrived before a remote description. */
  private pendingCandidates: Array<unknown | null> = [];
  private hasRemoteDescription = false;
  /** Has an answer to one of our offers been applied? */
  private answered = false;
  private ice: IceConfig | null = null;
  /** A fresh ICE config for this call (GET /calls/:id/turn), set by the session. */
  refreshIce?: () => Promise<IceConfig>;

  /* ── Audio out (audit E4) ──────────────────────────────────────────────── */
  /** An <audio> element created and started inside the dial/answer gesture,
   *  so autoplay rules let it play the remote track later. */
  audioElement: HTMLAudioElement | null = null;

  /* ── Noise filter, quality sampler, recovery (PR-3) ────────────────────── */
  /** What the tenant default + the user's preference asked for. */
  noiseWanted = false;
  /** An AudioContext created and resumed inside a gesture, for the filter. */
  noiseContext: AudioContext | null = null;
  private noiseStatus: NoiseFilterStatus = "off";
  private noiseReason: NoiseFilterReason | null = null;
  private noiseStop: (() => void) | null = null;
  private originalTrack: MediaStreamTrack | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private recovering = false;
  quality: QualitySample = { state: "good", rttMs: null, jitterMs: null, lossPct: null };

  constructor(events: EngineEvents, isCaller: boolean) {
    this.events = events;
    this.isCaller = isCaller;
  }

  /** The callee yields on glare; the caller does not. */
  private get polite(): boolean {
    return !this.isCaller;
  }

  /** The local mic stream, so the recorder taps the track the call uses. */
  get stream(): MediaStream | null {
    return this.localStream;
  }

  get localMuted(): boolean {
    const t = this.localStream?.getAudioTracks()[0];
    return t ? !t.enabled : true;
  }

  /** True once an answer to one of our offers has been applied. */
  get hasRemoteAnswer(): boolean {
    return this.answered;
  }

  /** The noise filter's current state, for the overlay. */
  get noiseFilter(): { status: NoiseFilterStatus; reason: NoiseFilterReason | null } {
    return { status: this.noiseStatus, reason: this.noiseReason };
  }

  /** The track the peer connection is actually sending. */
  get outboundTrack(): MediaStreamTrack | null {
    return this.pc?.getSenders?.()?.[0]?.track ?? this.localStream?.getAudioTracks()[0] ?? null;
  }

  /** Turn the filter on or off mid-call. Never rejects. */
  async setNoiseSuppression(enabled: boolean): Promise<NoiseFilterStatus> {
    this.noiseWanted = enabled;
    if (!enabled) {
      await this.detachNoise();
      this.noiseStatus = "off";
      this.noiseReason = null;
      this.events.onNoiseFilter?.("off", null);
      return "off";
    }
    return this.attachNoise();
  }

  setMuted(muted: boolean) {
    const t = this.localStream?.getAudioTracks()[0];
    if (t) {
      t.enabled = !muted;
      this.events.onLocalMuted?.(muted);
    }
  }

  /**
   * Start the connection on an open mic. The session opens the mic before it
   * dials or accepts (audit E6) and passes it in; without one this opens it.
   * The caller's offer goes out from `negotiationneeded` once the track is
   * added; the callee waits for that offer.
   */
  async start(ice: IceConfig, mic?: MediaStream): Promise<void> {
    this.ice = ice;
    this.localStream = mic ?? (await openMic());
    this.originalTrack = this.localStream.getAudioTracks()[0] || null;
    const pc = this.makeConnection(ice);
    this.pc = pc;

    pc.onnegotiationneeded = () => void this.negotiate();
    pc.onicecandidate = (e) => this.events.onIce?.(e.candidate || null);
    pc.ontrack = (e) => {
      // An empty streams array (a mid-call renegotiation) keeps the stream.
      if (e.streams.length > 0) this.remoteStream = e.streams[0];
      if (!this.remoteStream) return;
      this.attachRemoteAudio(this.remoteStream);
      this.events.onRemoteStream?.(this.remoteStream);
    };
    pc.oniceconnectionstatechange = () => this.iceStateChanged();
    this.phase = this.isCaller ? "dialing" : "connecting";
    this.localStream.getAudioTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    // The filter is attached off the media path: the call starts on the raw
    // track and swaps the filtered one in with replaceTrack (no renegotiation).
    if (this.noiseWanted) void this.attachNoise();
  }

  /**
   * A description from the other side — the heart of perfect negotiation.
   * Throws only for a description that could not be applied; a colliding
   * offer the impolite side ignores and a duplicate are not errors.
   */
  async applyRemoteDescription(desc: SessionDescription): Promise<void> {
    const pc = this.pc;
    if (!pc) throw new Error("engine not started");
    // The same offer again (the caller re-sent it after `call:ready`, or the
    // socket delivered it twice): answer it again, do not renegotiate.
    if (desc.type === "offer" && pc.signalingState === "stable" && pc.remoteDescription?.sdp === desc.sdp) {
      const local = pc.localDescription;
      if (local && local.type === "answer") this.events.onSignal?.(local.sdp, "answer");
      return;
    }
    const readyForOffer =
      !this.makingOffer && (pc.signalingState === "stable" || this.isSettingRemoteAnswerPending);
    const offerCollision = desc.type === "offer" && !readyForOffer;
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    this.isSettingRemoteAnswerPending = desc.type === "answer";
    try {
      // The polite side on glare: drop our offer first. Explicit, because
      // older engines do not roll back implicitly.
      if (offerCollision) {
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch {
          /* @silent:parse — our offer was not set after all; nothing to roll back. */
        }
      }
      await pc.setRemoteDescription(desc);
    } finally {
      this.isSettingRemoteAnswerPending = false;
    }
    this.hasRemoteDescription = true;
    if (desc.type === "answer") this.answered = true;
    await this.flushCandidates();

    if (desc.type === "offer") {
      await this.setLocal();
      const answer = pc.localDescription;
      if (answer?.sdp) this.events.onSignal?.(answer.sdp, "answer");
    }
    if (!this.connectedAt) this.armIceGrace();
  }

  /** A remote offer (kept for callers of the pre-PR-4 API). */
  applyRemoteOffer(sdp: string): Promise<void> {
    return this.applyRemoteDescription({ type: "offer", sdp });
  }

  /** A remote answer (kept for callers of the pre-PR-4 API). */
  applyRemoteAnswer(sdp: string): Promise<void> {
    return this.applyRemoteDescription({ type: "answer", sdp });
  }

  /**
   * A remote candidate. Buffered until the remote description is set (audit
   * E2); `null` is end-of-candidates. A candidate for an offer we ignored is
   * dropped.
   */
  async addRemoteIceCandidate(candidate: unknown | null): Promise<void> {
    if (!this.pc || this.phase === "ended") return;
    if (!this.hasRemoteDescription || this.isSettingRemoteAnswerPending) {
      this.pendingCandidates.push(candidate);
      return;
    }
    await this.applyCandidate(candidate);
  }

  /**
   * The callee says it is listening (`call:ready`, sent once its engine is
   * up). If our offer has had no answer — it went out while their app was
   * closed — send the current one again. Nothing else re-offers (audit E3).
   */
  peerReady(): void {
    const pc = this.pc;
    if (!this.isCaller || !pc || this.phase === "ended") return;
    if (pc.signalingState !== "have-local-offer") return;
    const local = pc.localDescription;
    if (local?.type === "offer" && local.sdp) this.events.onSignal?.(local.sdp, "offer");
  }

  /** Play the remote audio after "Tap to hear" (a fresh gesture). */
  async resumeAudio(): Promise<boolean> {
    const el = this.audioElement;
    if (!el) return false;
    try {
      await el.play();
      this.events.onAudioBlocked?.(false);
      return true;
    } catch {
      /* @silent:teardown — still refused; the "Tap to hear" control stays up. */
      this.events.onAudioBlocked?.(true);
      return false;
    }
  }

  /** Tear everything down. Idempotent. */
  stop() {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.clearTimers();
    this.clearStats();
    this.clearRecovery();
    this.clearIceGrace();
    this.pendingCandidates = [];
    this.noiseStop?.();
    this.noiseStop = null;
    try {
      this.pc?.close();
    } catch {
      // @silent:teardown — a connection already closed closes nothing.
    }
    this.pc = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.audioElement) {
      try {
        this.audioElement.pause();
      } catch {
        // @silent:teardown — a detached element may refuse pause; it is being dropped.
      }
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }
    if (this.noiseContext && this.noiseContext.state !== "closed") {
      void this.noiseContext.close().catch(() => {
        /* @silent:teardown — closing a context that is already closing. */
      });
    }
    this.noiseContext = null;
    this.remoteStream = null;
  }

  private makeConnection(ice: IceConfig): PCT {
    if (this.connectionFactory) return this.connectionFactory();
    return new RTCPeerConnection(rtcConfiguration(ice)) as unknown as PCT;
  }

  /** `negotiationneeded`: make our offer and send it. */
  private async negotiate(): Promise<void> {
    const pc = this.pc;
    if (!pc || this.phase === "ended") return;
    // The callee answers the caller's offer; it only offers itself once a
    // negotiation exists (an ICE restart), never to open the call.
    if (!this.isCaller && !this.hasRemoteDescription) return;
    try {
      this.makingOffer = true;
      await this.setLocal();
      const offer = pc.localDescription;
      if (offer?.type === "offer" && offer.sdp) {
        this.events.onSignal?.(offer.sdp, "offer");
        if (this.isCaller && this.phase === "dialing") this.phase = "connecting";
      }
    } catch {
      /* @silent:parse — the state moved under us (a remote offer arrived
         mid-offer, or the call ended); the other side's description or the
         ICE timers decide what happens next. */
    } finally {
      this.makingOffer = false;
    }
  }

  /** setLocalDescription() with no argument, or the explicit form for an
   *  engine that does not have the implicit one. */
  private async setLocal(): Promise<void> {
    const pc = this.pc!;
    try {
      await pc.setLocalDescription();
      return;
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
    }
    const made = pc.signalingState === "have-remote-offer" ? await pc.createAnswer() : await pc.createOffer();
    if (!made.sdp) throw new Error("no local SDP");
    await pc.setLocalDescription({
      type: pc.signalingState === "have-remote-offer" ? "answer" : "offer",
      sdp: made.sdp,
    });
  }

  private async flushCandidates(): Promise<void> {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of queued) await this.applyCandidate(c);
  }

  private async applyCandidate(candidate: unknown | null): Promise<void> {
    try {
      // No argument = end-of-candidates.
      await (candidate === null ? this.pc!.addIceCandidate() : this.pc!.addIceCandidate(candidate));
    } catch {
      /* @silent:parse — a candidate for an offer we ignored, or one for an ICE
         generation that has moved on, cannot be applied and changes nothing;
         a real failure surfaces through the ICE state. */
    }
  }

  private attachRemoteAudio(stream: MediaStream) {
    const el = this.audioElement ?? (typeof Audio !== "undefined" ? new Audio() : null);
    if (!el) return;
    this.audioElement = el;
    el.autoplay = true;
    el.srcObject = stream;
    let playing: Promise<void> | undefined;
    try {
      playing = el.play();
    } catch {
      playing = Promise.reject(new Error("play refused"));
    }
    void Promise.resolve(playing)
      .then(() => this.events.onAudioBlocked?.(false))
      .catch(() => {
        /* @silent:teardown — autoplay refused: reported, and the call screen
           offers "Tap to hear" (audit E4). */
        if (this.audioElement === el) this.events.onAudioBlocked?.(true);
      });
  }

  private iceStateChanged() {
    const state = String(this.pc?.iceConnectionState || "");
    if (state === "connected" || state === "completed") {
      // The first connection, or a recovery that worked. The call's clock
      // starts once; a restart must not reset 30:00.
      this.clearRecovery();
      if (this.connectedAt) return;
      this.connectedAt = Date.now();
      this.phase = "in_call";
      this.clearIceGrace();
      this.events.onConnected?.();
      this.startClock();
      this.startStats();
    } else if (state === "disconnected") {
      // Mid-call: restart ICE (a network change). Before the first connection
      // the setup grace timer is already counting.
      if (this.connectedAt) this.beginRecovery();
    } else if (state === "failed") {
      if (this.connectedAt && this.restartAttempts < 2) this.beginRecovery(true);
      else this.fail("ice_failed");
    }
  }

  private clearRecovery() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    if (this.recovering) {
      this.recovering = false;
      this.events.onRecovering?.(false);
    }
    if (this.connectedAt) this.restartAttempts = 0;
  }

  /** The path died mid-call: restart ICE, and fail honestly if it does not
   *  come back within ICE_RECOVERY_MS. Either side may restart; glare is
   *  settled by the polite/impolite roles. */
  private beginRecovery(force = false) {
    if (this.phase === "ended") return;
    if (!this.recovering) {
      this.recovering = true;
      this.events.onRecovering?.(true);
    }
    if (force || this.restartAttempts < 2) {
      this.restartAttempts += 1;
      void this.restartIce();
    }
    if (!this.recoveryTimer) {
      this.recoveryTimer = setTimeout(() => this.fail("ice_failed"), ICE_RECOVERY_MS);
    }
  }

  /** Refresh the TURN credential if it is close to expiry, then restart. */
  private async restartIce(): Promise<void> {
    await this.refreshIceIfStale();
    const pc = this.pc;
    if (!pc || this.phase === "ended") return;
    try {
      if (typeof pc.restartIce === "function") {
        // `negotiationneeded` fires and negotiate() sends the offer.
        pc.restartIce();
        return;
      }
      if (pc.signalingState !== "stable") return;
      this.makingOffer = true;
      const offer = await pc.createOffer({ iceRestart: true });
      if (!offer.sdp) return;
      await pc.setLocalDescription({ type: "offer", sdp: offer.sdp });
      this.events.onSignal?.(offer.sdp, "offer");
    } catch {
      /* @silent:parse — a restart that cannot be minted leaves the recovery
         timer to decide; there is no second action to take here. */
    } finally {
      this.makingOffer = false;
    }
  }

  private async refreshIceIfStale(): Promise<void> {
    const expiresAt = this.ice?.expiresAt ? Date.parse(this.ice.expiresAt) : NaN;
    if (!this.refreshIce || !Number.isFinite(expiresAt)) return;
    if (expiresAt - Date.now() > TURN_REFRESH_MARGIN_MS) return;
    try {
      const fresh = await this.refreshIce();
      const pc = this.pc;
      if (!pc || this.phase === "ended") return;
      this.ice = fresh;
      pc.setConfiguration?.({ ...(pc.getConfiguration?.() ?? {}), ...rtcConfiguration(fresh) });
    } catch {
      /* @silent:parse — the refresh failed (rate limit, network); the restart
         still runs on the credential we have. */
    }
  }

  /** The quality sampler: jitter, RTT and loss from getStats(). Never throws. */
  private startStats() {
    if (this.statsTimer || !this.pc?.getStats) return;
    const tick = async () => {
      try {
        const report = await this.pc!.getStats!();
        const sample = readStats(report);
        this.quality = sample;
        this.events.onQuality?.(sample);
        const hint = playoutDelayForSample(sample);
        if (hint !== null) {
          for (const receiver of this.pc?.getReceivers?.() || []) {
            try {
              receiver.playoutDelayHint = hint;
            } catch {
              /* @silent:parse — a non-standard property the browser refuses;
                 its own buffer stays. */
            }
          }
        }
      } catch {
        /* @silent:parse — a failed stats read changes nothing visible; the
           next tick tries again. */
      }
    };
    this.statsTimer = setInterval(() => void tick(), STATS_INTERVAL_MS);
  }

  private clearStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  /**
   * Build the filtered graph and swap the outgoing track onto it with
   * replaceTrack (no renegotiation). The recorder keeps tapping the raw
   * stream. If the filter turns out to send silence, fall back (audit E5).
   */
  private async attachNoise(): Promise<NoiseFilterStatus> {
    const stream = this.localStream;
    if (!stream) return "off";
    if (this.noiseStatus === "on") return "on";
    const { applyNoiseSuppression } = await import("./noise-suppression");
    // stop() can run during either await (dial → immediate hang-up).
    if (this.localStream !== stream) return "off";
    const context = this.noiseContext;
    const result = await applyNoiseSuppression(stream, context ? { createContext: () => context } : {}, {
      onSilent: () => void this.silentFilter(),
    });
    if (this.localStream !== stream) {
      result.stop();
      return "off";
    }
    if (result.status !== "on") {
      this.noiseStatus = "unavailable";
      this.noiseReason = result.reason;
      this.events.onNoiseFilter?.("unavailable", result.reason);
      return "unavailable";
    }
    this.noiseStop = result.stop;
    const filteredTrack = result.stream.getAudioTracks()[0];
    const sender = this.pc?.getSenders?.()?.[0];
    if (sender && filteredTrack && typeof sender.replaceTrack === "function") {
      try {
        await sender.replaceTrack(filteredTrack);
      } catch {
        // Keep the raw track rather than a track nothing is sending.
        result.stop();
        this.noiseStop = null;
        this.noiseStatus = "unavailable";
        this.noiseReason = "init_failed";
        this.events.onNoiseFilter?.("unavailable", "init_failed");
        return "unavailable";
      }
    }
    this.noiseStatus = "on";
    this.noiseReason = null;
    this.events.onNoiseFilter?.("on", null);
    return "on";
  }

  /** The filter sent silence over speech: back to the raw microphone. */
  private async silentFilter(): Promise<void> {
    if (this.noiseStatus !== "on") return;
    await this.detachNoise();
    this.noiseStatus = "unavailable";
    this.noiseReason = "silent_output";
    this.events.onNoiseFilter?.("unavailable", "silent_output");
  }

  /** Back to the raw mic (the overlay switch, a silent filter, teardown). */
  private async detachNoise(): Promise<void> {
    this.noiseStop?.();
    this.noiseStop = null;
    const sender = this.pc?.getSenders?.()?.[0];
    if (sender && typeof sender.replaceTrack === "function" && this.originalTrack) {
      try {
        await sender.replaceTrack(this.originalTrack);
      } catch {
        /* @silent:teardown — the connection or sender is going away. */
      }
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

/**
 * An <audio> element for the remote voice, created and started inside the
 * dial/answer click (audit E4). Autoplay rules (iOS above all) let an element
 * play later only if the person started it; there is nothing to play yet, so
 * it plays an empty stream. Null where there is no Audio (tests, SSR).
 */
export function primeRemoteAudio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  try {
    const el = new Audio();
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    if (typeof MediaStream !== "undefined") el.srcObject = new MediaStream();
    const started = el.play();
    if (started && typeof started.catch === "function") {
      started.catch(() => {
        /* @silent:teardown — nothing to play yet; the element is primed either way. */
      });
    }
    return el;
  } catch {
    /* @silent:teardown — no audio element here; the engine makes its own. */
    return null;
  }
}

/**
 * The noise filter's AudioContext, created at 48 kHz (RNNoise's rate) and
 * resumed inside the gesture (audit E5). A context made later, after an
 * await, starts suspended on most browsers and sends silence.
 */
export function primeNoiseContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ sampleRate: 48_000 });
  } catch {
    try {
      ctx = new Ctor();
    } catch {
      /* @silent:teardown — no context: the filter reports "unavailable". */
      return null;
    }
  }
  void ctx.resume().catch(() => {
    /* @silent:teardown — the filter checks the state and reports "suspended". */
  });
  return ctx;
}

/**
 * Read one RTCStatsReport into the three numbers the dot and the buffer want.
 *
 * Written defensively because the report is a browser-shaped object whose
 * members vary by version: `candidate-pair` carries the RTT in SECONDS,
 * `inbound-rtp` the jitter in seconds and the packet counters as integers, and
 * any of them may be absent on the first samples of a call. A missing number
 * stays null — the dot then falls back on the ones it has rather than reading a
 * zero, which would render a dead link as perfect.
 */
export function readStats(report: unknown): QualitySample {
  const entries: Array<Record<string, unknown>> = [];
  const anyReport = report as { forEach?: (cb: (v: unknown) => void) => void } | null;
  if (anyReport && typeof anyReport.forEach === "function") {
    anyReport.forEach((v) => entries.push(v as Record<string, unknown>));
  } else if (Array.isArray(report)) {
    entries.push(...(report as Array<Record<string, unknown>>));
  }

  let rttMs: number | null = null;
  let jitterMs: number | null = null;
  let lossPct: number | null = null;

  for (const e of entries) {
    const type = String(e.type || "");
    if (type === "candidate-pair") {
      const candidateRtt = Number(e.currentRoundTripTime);
      // Prefer the nominated/succeeded pair; fall back to any pair that
      // reports one, since some browsers do not set `nominated`.
      const usable = e.nominated === true || e.state === "succeeded" || rttMs === null;
      if (usable && Number.isFinite(candidateRtt) && candidateRtt > 0) {
        rttMs = Math.round(candidateRtt * 1000);
      }
    } else if (type === "inbound-rtp" && String(e.kind || "audio") === "audio") {
      const jitter = Number(e.jitter);
      if (Number.isFinite(jitter)) jitterMs = Math.round(jitter * 1000);
      const lost = Number(e.packetsLost);
      const received = Number(e.packetsReceived);
      if (Number.isFinite(lost) && Number.isFinite(received) && lost + received > 0) {
        lossPct = Number(((Math.max(0, lost) / (lost + received)) * 100).toFixed(2));
      }
    }
  }

  return { state: qualityFor({ rttMs, jitterMs, lossPct }), rttMs, jitterMs, lossPct };
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
