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

/** Recovery window after ICE goes `disconnected` mid-call (PR-3). Shorter than
 *  the setup grace because the connection is PROVEN here: if it cannot come
 *  back in ten seconds, the person on the other end is talking to silence and
 *  the honest thing is to say so (§4.7) rather than leave the UI showing a call
 *  that is not happening. */
export const ICE_RECOVERY_MS = 10_000;

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
  | "init_failed";

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
};

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

type PCT = {
  setRemoteDescription(d: { type: "offer" | "answer"; sdp: string }): Promise<void>;
  createOffer(options?: { iceRestart?: boolean }): Promise<{ sdp?: string }>;
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
  /** Optional on purpose: the PR-1 fakes do not implement them, and a browser
   *  without getStats() must still be able to make a call. */
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
  /** Has the callee's answer been applied? (PR-3: the push-accept path needs to
   *  know whether a re-offer is required.) */
  private answered = false;
  /** The offer we put on the wire, kept for the re-offer after a push-cold
   *  accept — by then `localDescription` may have moved on. */
  private lastOfferSdp: string | null = null;
  private warnSent = false;
  private remoteAudio: HTMLAudioElement | null = null;
  /** Injected for tests — the session can swap in a fake connection. */
  connectionFactory?: () => PCT;

  /* ── PR-3: the noise filter, the quality sampler and ICE recovery ─────── */
  /** What the tenant default + the user's preference asked for. Kept even if
   *  the filter failed, so a later retry is possible without re-asking. */
  noiseWanted = false;
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

  /** True once the remote answer has been applied. */
  get hasRemoteAnswer(): boolean {
    return this.answered;
  }

  /** Our current local description, for a re-offer (push-cold accept). */
  get localSdp(): string | null {
    const local = (this.pc as unknown as { localDescription?: { sdp?: string } } | null)
      ?.localDescription;
    return local?.sdp || this.lastOfferSdp;
  }

  /** The noise filter's current state, for the overlay. */
  get noiseFilter(): { status: NoiseFilterStatus; reason: NoiseFilterReason | null } {
    return { status: this.noiseStatus, reason: this.noiseReason };
  }

  /** The track the peer connection is actually sending: the filtered copy when
   *  the filter is on, the raw mic otherwise. The RECORDER (PR-2) taps the raw
   *  one on purpose — see the call site in call-session. */
  get outboundTrack(): MediaStreamTrack | null {
    return this.pc?.getSenders?.()?.[0]?.track ?? this.localStream?.getAudioTracks()[0] ?? null;
  }

  /**
   * Turn the filter on or off mid-call (§7.2's "overlay switch during the
   * call"). Never rejects: the worst outcome is `unavailable`, which the
   * overlay renders as a sentence.
   */
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
   * Open the mic and (caller) start the offer. The callee opens the mic NOW
   * too — a call that rings 40 s and connects should not spend the first
   * second of media negotiating the camera roll.
   */
  async start(ice: IceConfig): Promise<void> {
    this.localStream = await openMic();
    this.originalTrack = this.localStream.getAudioTracks()[0] || null;
    this.pc = this.makeConnection(ice);
    this.localStream.getAudioTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!));

    // PR-3, rule 2: the filter is attached OFF the media path. The unfiltered
    // track is already on the connection and the offer is created below, so the
    // call starts on the baseline stack and upgrades itself a few hundred
    // milliseconds in. On a yard connection that difference is the call.
    if (this.noiseWanted) {
      void this.attachNoise();
    }

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
      this.lastOfferSdp = offer.sdp;
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
    this.answered = true;
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
    this.clearStats();
    this.clearRecovery();
    // The AudioContext goes with the call. A context left open holds the audio
    // session — and, on a phone, the microphone indicator — for a call that is
    // over, which is both a battery cost and a privacy one (§4.8's teardown
    // discipline).
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
      // A recovery that worked, or the first connection. Either way the path is
      // up: clear the recovery window, tell the UI, and only count the call's
      // ONE clock start the first time (a restart must not reset 30:00).
      this.clearRecovery();
      if (this.connectedAt) return;
      this.connectedAt = Date.now();
      this.phase = "in_call";
      this.clearIceGrace();
      this.events.onConnected?.();
      this.startClock();
      this.startStats();
    } else if (state === "disconnected") {
      if (this.connectedAt) {
        // MID-CALL disconnect: the corridor case (wifi → 4G, a lift, a yard
        // dead spot). "disconnected" is transient and the guide says the answer
        // is an ICE restart, not a failure report — so restart and give it the
        // recovery window.
        this.beginRecovery();
      }
      // Before the first connection this is the setup path: the ice-grace timer
      // armed at answer time is already counting, and restarting ICE during
      // setup would re-offer over an offer that has not been answered yet.
    } else if (state === "failed") {
      // A hard failure mid-call still gets ONE restart before the call is
      // declared dead — `failed` is the browser giving up on the current
      // candidate pairs, not proof that no path exists (the TURN relay has not
      // been tried yet on many of these).
      if (this.connectedAt && this.restartAttempts < 2) {
        this.beginRecovery(true);
      } else {
        this.fail("ice_failed");
      }
    }
  }

  /** Media is back, or was never lost: stand the recovery UI down. */
  private clearRecovery() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    if (this.recovering) {
      this.recovering = false;
      this.events.onRecovering?.(false);
    }
    if (this.connectedAt) this.restartAttempts = 0;
  }

  /**
   * The network path died mid-call: try an ICE restart, then fail honestly.
   *
   * `restartIce()` is the browser's own API (Chrome/Safari/Firefox all have it
   * now) and the fallback is the older, universal form: a fresh offer with
   * `iceRestart: true`, sent through the same signaling as the first one. Only
   * the CALLER re-offers — the callee answering a restart would be a second
   * offer racing the first, and the callee's engine gets the new offer through
   * `applyRemoteOffer`, which is why the recovery is asymmetric. A callee whose
   * path died still arms this timer and still fails honestly if nothing arrives.
   */
  private beginRecovery(force = false) {
    if (this.phase === "ended") return;
    if (!this.recovering) {
      this.recovering = true;
      this.events.onRecovering?.(true);
    }
    if (this.isCaller && (force || this.restartAttempts < 2)) {
      this.restartAttempts += 1;
      void this.attemptIceRestart();
    }
    if (!this.recoveryTimer) {
      this.recoveryTimer = setTimeout(() => this.fail("ice_failed"), ICE_RECOVERY_MS);
    }
  }

  private async attemptIceRestart(): Promise<void> {
    if (!this.pc) return;
    try {
      const pc = this.pc as unknown as { restartIce?: () => void };
      if (typeof pc.restartIce === "function") {
        // The browser mints the restart offer itself and fires
        // `negotiationneeded`; our `onSignal` path is not involved.
        pc.restartIce();
        return;
      }
      const offer = await this.pc.createOffer({ iceRestart: true });
      if (!offer.sdp) return;
      await this.pc.setLocalDescription({ type: "offer", sdp: offer.sdp });
      this.events.onSignal?.(offer.sdp, "offer");
    } catch {
      /* @silent:parse — a restart that cannot be minted leaves the recovery
         timer to decide the outcome, which is the same failure the user would
         have seen anyway. There is no second action to take here. */
    }
  }

  /**
   * The quality sampler (§3.4/§4.4): inbound jitter, RTT and loss from
   * getStats(), plus the playoutDelayHint it implies.
   *
   * Never throws: a browser without getStats() (or a fake in a test) leaves
   * the dot where it was rather than taking the call down. The stats call
   * itself is the only cost, and it runs at 2 s.
   */
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
              /* @silent:parse — the property is non-standard; a browser that
                 refuses it keeps its own buffer, which is the default we would
                 have had anyway. */
            }
          }
        }
      } catch {
        /* @silent:parse — a stats read that fails changes nothing the user can
           see; the next tick tries again. */
      }
    };
    this.statsTimer = setInterval(() => void tick(), STATS_INTERVAL_MS);
  }

  private clearStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  /**
   * Build the filtered graph and swap the OUTGOING track onto it.
   *
   * `replaceTrack` rather than a renegotiation: the peer connection never
   * learns the filter arrived, which is exactly right — the SDP is unchanged
   * (same codec, same m-line), so there is no re-offer, no ICE churn and no
   * window in which the call is renegotiating while the user is mid-sentence.
   * The media recorder keeps tapping the RAW stream (see call-session), because
   * a certified transcript should be of what was said, not of what the filter
   * thought was said.
   */
  private async attachNoise(): Promise<NoiseFilterStatus> {
    if (!this.localStream) return "off";
    if (this.noiseStatus === "on") return "on";
    const { applyNoiseSuppression } = await import("./noise-suppression");
    const result = await applyNoiseSuppression(this.localStream);
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
        // The swap failed: keep the unfiltered track rather than a track
        // nothing is sending.
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

  /** Back to the raw mic (the overlay switch, and teardown). */
  private async detachNoise(): Promise<void> {
    this.noiseStop?.();
    this.noiseStop = null;
    const sender = this.pc?.getSenders?.()?.[0];
    if (sender && typeof sender.replaceTrack === "function" && this.originalTrack) {
      try {
        await sender.replaceTrack(this.originalTrack);
      } catch {
        /* @silent:teardown — the connection is going away (or the sender is
           gone); the track it holds stops existing with it. */
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
