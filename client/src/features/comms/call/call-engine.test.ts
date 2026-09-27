/**
 * Call engine (PR-1) — the P2P half, against a fake RTCPeerConnection.
 *
 * The fake implements exactly the surface the engine drives: SDP in/out,
 * candidate in/out, and the iceConnectionState transitions. Everything the
 * engine OWNS (phase, the clocks, the mic lifecycle) is asserted here, because
 * a call that cannot hang up at 30:00 is a call that ends mid-sentence.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CallEngine, openMic, MAX_CALL_S, MAX_CALL_WARN_S, ICE_RECOVERY_MS,
  qualityFor, playoutDelayForSample, readStats, rtcConfiguration, primeRemoteAudio,
} from "./call-engine";
import { FakePeerConnection, settle } from "@/test/fake-peer-connection";

/**
 * The worklet, faked (PR-3). `applyNoiseSuppression` is the ONLY thing between
 * the engine and a real audio graph, so the toggle tests replace it instead of
 * pretending jsdom has WebAudio. Everything downstream — the replaceTrack swap,
 * the status the overlay renders, the teardown — is the engine's own code.
 */
const W = vi.hoisted(() => ({
  apply: (async (stream: unknown) => ({ status: "unavailable", stream, reason: "no_audio_context", stop: () => {} })) as (
    stream: unknown,
  ) => Promise<unknown>,
  onSilent: null as null | (() => void),
}));
vi.mock("./noise-suppression", () => ({
  applyNoiseSuppression: (stream: unknown, _deps: unknown, opts?: { onSilent?: () => void }) => {
    W.onSilent = opts?.onSilent ?? null;
    return W.apply(stream);
  },
}));

/** A connection with only the parts the noise-filter tests touch. */
function makeFakePC() {
  return new FakePeerConnection();
}

const fakeTrack = { enabled: true, stop: vi.fn() };
const fakeStream = {
  getAudioTracks: () => [fakeTrack],
  getTracks: () => [fakeTrack],
} as unknown as MediaStream;

function fakeMic() {
  vi.stubGlobal(
    "navigator",
    { mediaDevices: { getUserMedia: vi.fn(async () => fakeStream) } },
  );
}

const ICE = { iceServers: [{ urls: ["stun:stun.example.com:3478"] }], turnConfigured: false };

type Wire = { sdp: string; kind: "offer" | "answer" };

/**
 * Two engines on fake connections, joined by a fake signalling channel that
 * delivers each message one macrotask later — the caller impolite, the
 * callee polite.
 */
function pair() {
  const toCallee: Array<Wire | { candidate: unknown }> = [];
  const toCaller: Array<Wire | { candidate: unknown }> = [];
  const events = { callerConnected: vi.fn(), calleeConnected: vi.fn() };
  const caller = new CallEngine(
    {
      onSignal: (sdp, kind) => deliver(callee, { sdp, kind }, toCallee),
      onIce: (candidate) => deliver(callee, { candidate }, toCallee),
      onConnected: events.callerConnected,
    },
    true,
  );
  const callee = new CallEngine(
    {
      onSignal: (sdp, kind) => deliver(caller, { sdp, kind }, toCaller),
      onIce: (candidate) => deliver(caller, { candidate }, toCaller),
      onConnected: events.calleeConnected,
    },
    false,
  );
  let paused = false;
  const held: Array<() => void> = [];
  function deliver(to: CallEngine, msg: Wire | { candidate: unknown }, log: unknown[]) {
    log.push(msg);
    const run = () => {
      if ("candidate" in msg) void to.addRemoteIceCandidate(msg.candidate);
      else {
        void to.applyRemoteDescription({ type: msg.kind, sdp: msg.sdp }).catch(() => {
          /* @silent:parse — a stale answer the test means to be refused. */
        });
      }
    };
    if (paused) held.push(run);
    else setTimeout(run, 0);
  }
  const pcs = { caller: new FakePeerConnection(), callee: new FakePeerConnection() };
  caller.connectionFactory = () => pcs.caller as never;
  callee.connectionFactory = () => pcs.callee as never;
  return {
    caller,
    callee,
    pcs,
    toCallee,
    toCaller,
    events,
    /** Hold messages (a slow network) until release(). */
    pause: () => {
      paused = true;
    },
    release: () => {
      paused = false;
      for (const run of held.splice(0)) setTimeout(run, 0);
    },
  };
}

const offersIn = (log: Array<Wire | { candidate: unknown }>) =>
  log.filter((m): m is Wire => "kind" in m && m.kind === "offer").map((m) => m.sdp);

describe("CallEngine", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakePeerConnection.implicitSld = true;
  });

  it("the caller's offer goes out from negotiationneeded, then candidates trickle", async () => {
    const pc = new FakePeerConnection();
    const signals: string[] = [];
    const ice: unknown[] = [];
    const e = new CallEngine(
      { onSignal: (sdp, kind) => signals.push(`${kind}:${sdp}`), onIce: (c) => ice.push(c) },
      true,
    );
    e.connectionFactory = () => pc as never;
    await e.start(ICE, fakeStream);
    await settle();

    expect(e.phase).toBe("connecting");
    expect(pc.signalingState).toBe("have-local-offer");
    expect(signals).toEqual([`offer:${pc.offers[0]}`]);
    expect(ice).toContainEqual({ candidate: `host-${pc.id}` });
    e.stop();
    expect(pc.closed).toBe(true);
    expect(fakeTrack.stop).toHaveBeenCalled();
  });

  it("the callee never opens the negotiation: it waits for the caller's offer", async () => {
    const pc = new FakePeerConnection();
    const onSignal = vi.fn();
    const e = new CallEngine({ onSignal }, false);
    e.connectionFactory = () => pc as never;
    await e.start(ICE, fakeStream);
    await settle();
    expect(pc.offers).toEqual([]);
    expect(onSignal).not.toHaveBeenCalled();
    e.stop();
  });

  it("the mic the session opened is the one used — no second getUserMedia (E6)", async () => {
    fakeMic();
    const e = new CallEngine({}, true);
    e.connectionFactory = () => new FakePeerConnection() as never;
    await e.start(ICE, fakeStream);
    expect((navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(e.stream).toBe(fakeStream);
    e.stop();
  });

  it("a pair connects: one offer, one answer, both sides stable", async () => {
    const p = pair();
    await p.caller.start(ICE, fakeStream);
    await p.callee.start(ICE, fakeStream);
    await settle();

    expect(offersIn(p.toCallee)).toHaveLength(1);
    expect(offersIn(p.toCaller)).toHaveLength(0);
    expect(p.pcs.caller.signalingState).toBe("stable");
    expect(p.pcs.callee.signalingState).toBe("stable");
    expect(p.caller.hasRemoteAnswer).toBe(true);

    p.pcs.caller.setIceState("connected");
    p.pcs.callee.setIceState("connected");
    expect(p.caller.phase).toBe("in_call");
    expect(p.events.callerConnected).toHaveBeenCalledTimes(1);
    // "completed" after "connected" is the same connection: the clock is one.
    p.pcs.caller.setIceState("completed");
    expect(p.events.callerConnected).toHaveBeenCalledTimes(1);
    p.caller.stop();
    p.callee.stop();
  });

  it("works on an engine without implicit setLocalDescription()", async () => {
    FakePeerConnection.implicitSld = false;
    const p = pair();
    await p.caller.start(ICE, fakeStream);
    await p.callee.start(ICE, fakeStream);
    await settle();
    expect(p.pcs.caller.signalingState).toBe("stable");
    expect(p.pcs.callee.signalingState).toBe("stable");
    p.caller.stop();
    p.callee.stop();
  });

  it("glare: both sides restart at once; the polite callee rolls back, one negotiation wins (E1)", async () => {
    const p = pair();
    await p.caller.start(ICE, fakeStream);
    await p.callee.start(ICE, fakeStream);
    await settle();
    p.pcs.caller.setIceState("connected");
    p.pcs.callee.setIceState("connected");

    // Both networks change at once: both restart before either offer lands.
    p.pause();
    p.pcs.caller.setIceState("disconnected");
    p.pcs.callee.setIceState("disconnected");
    await settle();
    expect(p.pcs.caller.signalingState).toBe("have-local-offer");
    expect(p.pcs.callee.signalingState).toBe("have-local-offer");
    const callerRestart = p.pcs.caller.offers.at(-1)!;
    p.release();
    await settle(40);

    expect(p.pcs.caller.signalingState).toBe("stable");
    expect(p.pcs.callee.signalingState).toBe("stable");
    // The caller's restart was taken; every remote offer the callee holds is
    // one the caller sent.
    expect(callerRestart).toContain("ice-restart");
    expect(p.pcs.caller.offers).toContain(p.pcs.callee.remoteDescription!.sdp);
    p.caller.stop();
    p.callee.stop();
  });

  it("buffers remote candidates until the remote description, then applies them in order, end-of-candidates too (E2)", async () => {
    const pc = new FakePeerConnection();
    const e = new CallEngine({ onSignal: () => {} }, false);
    e.connectionFactory = () => pc as never;
    await e.start(ICE, fakeStream);

    // The caller trickled while the phone was still ringing.
    await e.addRemoteIceCandidate({ candidate: "c1" });
    await e.addRemoteIceCandidate({ candidate: "c2" });
    await e.addRemoteIceCandidate(null);
    expect(pc.candidates).toEqual([]);

    await e.applyRemoteDescription({ type: "offer", sdp: "offer-remote-1" });
    expect(pc.candidates).toEqual([{ candidate: "c1" }, { candidate: "c2" }, null]);

    // After that, straight through.
    await e.addRemoteIceCandidate({ candidate: "c3" });
    expect(pc.candidates.at(-1)).toEqual({ candidate: "c3" });
    e.stop();
  });

  it("the same offer twice is answered again, not renegotiated (E3)", async () => {
    const pc = new FakePeerConnection();
    const answers: string[] = [];
    const e = new CallEngine({ onSignal: (sdp, kind) => kind === "answer" && answers.push(sdp) }, false);
    e.connectionFactory = () => pc as never;
    await e.start(ICE, fakeStream);
    await e.applyRemoteDescription({ type: "offer", sdp: "offer-remote-1" });
    await e.applyRemoteDescription({ type: "offer", sdp: "offer-remote-1" });
    expect(answers).toHaveLength(2);
    expect(answers[0]).toBe(answers[1]);
    expect(pc.signalingState).toBe("stable");
    e.stop();
  });

  it("peerReady re-sends the caller's offer only while it has no answer (E3)", async () => {
    const p = pair();
    const resent: string[] = [];
    await p.caller.start(ICE, fakeStream);
    p.pause(); // the callee's app was closed when the offer went out
    await settle();
    const first = p.pcs.caller.offers[0];

    const e = p.caller as unknown as { events: { onSignal: (s: string, k: string) => void } };
    const original = e.events.onSignal;
    e.events.onSignal = (sdp, kind) => {
      resent.push(`${kind}:${sdp}`);
      original(sdp, kind);
    };
    p.caller.peerReady();
    expect(resent).toEqual([`offer:${first}`]);

    await p.callee.start(ICE, fakeStream);
    p.release();
    await settle(40);
    expect(p.pcs.caller.signalingState).toBe("stable");
    // Answered now: ready again is a no-op.
    p.caller.peerReady();
    expect(resent).toHaveLength(1);
    p.caller.stop();
    p.callee.stop();
  });

  it("a stale answer is ignored without failing the call", async () => {
    const onFailed = vi.fn();
    const p = pair();
    await p.caller.start(ICE, fakeStream);
    await p.callee.start(ICE, fakeStream);
    await settle();
    await expect(
      p.caller.applyRemoteDescription({ type: "answer", sdp: "answer-late" }),
    ).rejects.toThrow();
    expect(onFailed).not.toHaveBeenCalled();
    expect(p.pcs.caller.signalingState).toBe("stable");
    p.caller.stop();
    p.callee.stop();
  });

  it("a mid-call disconnect sends an ICE-restart offer and says it is recovering (E1)", async () => {
    const recovering: boolean[] = [];
    const p = pair();
    (p.callee as unknown as { events: { onRecovering: (r: boolean) => void } }).events.onRecovering = (r) =>
      recovering.push(r);
    await p.caller.start(ICE, fakeStream);
    await p.callee.start(ICE, fakeStream);
    await settle();
    p.pcs.caller.setIceState("connected");
    p.pcs.callee.setIceState("connected");

    // Only the callee's network changed: the callee restarts.
    p.pcs.callee.setIceState("disconnected");
    await settle(40);
    expect(recovering).toEqual([true]);
    expect(offersIn(p.toCaller).some((sdp) => sdp.includes("ice-restart"))).toBe(true);
    expect(p.pcs.caller.signalingState).toBe("stable");
    expect(p.pcs.callee.signalingState).toBe("stable");

    p.pcs.callee.setIceState("connected");
    expect(recovering).toEqual([true, false]);
    p.caller.stop();
    p.callee.stop();
  });

  it("the restart refreshes TURN credentials when they are close to expiry, and only then", async () => {
    const soon = { ...ICE, turnConfigured: true, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const fresh = {
      iceServers: [{ urls: ["turn:turn.example.com:3478?transport=udp"], username: "new", credential: "x" }],
      turnConfigured: true,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const p = pair();
    const refresh = vi.fn(async () => fresh);
    p.caller.refreshIce = refresh;
    await p.caller.start(soon, fakeStream);
    await p.callee.start(ICE, fakeStream);
    await settle();
    p.pcs.caller.setIceState("connected");
    p.pcs.caller.setIceState("disconnected");
    await settle(40);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(p.pcs.caller.configHistory.at(-1)!.iceServers).toEqual(fresh.iceServers);
    expect(p.pcs.caller.offers.at(-1)).toContain("ice-restart");

    // The fresh credential is far from expiry: the next restart does not ask.
    p.pcs.caller.setIceState("connected");
    p.pcs.caller.setIceState("disconnected");
    await settle(40);
    expect(refresh).toHaveBeenCalledTimes(1);
    p.caller.stop();
    p.callee.stop();
  });

  it("a restart that does not recover fails honestly after the window", async () => {
    vi.useFakeTimers();
    const onFailed = vi.fn();
    const pc = new FakePeerConnection();
    const e = new CallEngine({ onFailed, onSignal: () => {} }, true);
    e.connectionFactory = () => pc as never;
    await e.start(ICE, fakeStream);
    pc.setIceState("connected");
    pc.setIceState("disconnected");
    vi.advanceTimersByTime(ICE_RECOVERY_MS - 1);
    expect(onFailed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFailed).toHaveBeenCalledWith("ice_failed");
    e.stop();
  });

  it("a hard ICE failure before connecting reports exactly once", async () => {
    const pc = new FakePeerConnection();
    const onFailed = vi.fn();
    const e = new CallEngine({ onFailed }, true);
    e.connectionFactory = () => pc as never;
    await e.start(ICE, fakeStream);
    pc.setIceState("failed");
    pc.setIceState("failed");
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith("ice_failed");
    e.stop();
  });

  it("the 30-minute clock warns at 29:00 and hangs up at 30:00", async () => {
    vi.useFakeTimers();
    const pc = new FakePeerConnection();
    const onWarn = vi.fn();
    const onMax = vi.fn();
    const onTick = vi.fn();
    const e = new CallEngine({ onWarnMaxDuration: onWarn, onMaxDuration: onMax, onTick }, true);
    e.connectionFactory = () => pc as never;
    await e.start(ICE, fakeStream);
    pc.setIceState("connected");

    vi.advanceTimersByTime(MAX_CALL_WARN_S * 1000);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onMax).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60 * 1000);
    expect(onMax).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledTimes(MAX_CALL_S);
    expect(e.phase).toBe("ended");
  });

  it("mute flips the local track, not the call", () => {
    const e = new CallEngine({}, true);
    (e as unknown as { localStream: MediaStream }).localStream = fakeStream;
    e.setMuted(true);
    expect(fakeTrack.enabled).toBe(false);
    e.setMuted(false);
    expect(fakeTrack.enabled).toBe(true);
  });

  it("openMic names the failure when the platform has no media", async () => {
    vi.stubGlobal("navigator", {});
    await expect(openMic()).rejects.toThrow("no-media-device");
  });

  it("a candidate before the engine started is ignored, not fatal", async () => {
    const pc = new FakePeerConnection();
    const e = new CallEngine({}, true);
    e.connectionFactory = () => pc as never;
    await e.addRemoteIceCandidate({ candidate: "early" });
    expect(pc.candidates).toEqual([]);
    e.stop();
  });
});

/* ── Audit E4: remote audio that autoplay rules may block ───────────────── */

describe("remote audio (E4)", () => {
  function fakeAudio(play: () => Promise<void>) {
    return {
      autoplay: false,
      srcObject: null as unknown,
      play: vi.fn(play),
      pause: vi.fn(),
      setAttribute: vi.fn(),
    } as unknown as HTMLAudioElement & { play: ReturnType<typeof vi.fn> };
  }

  async function engineWithTrack(el: HTMLAudioElement) {
    const blocked: boolean[] = [];
    const pc = new FakePeerConnection();
    const e = new CallEngine({ onAudioBlocked: (b) => blocked.push(b) }, true);
    e.connectionFactory = () => pc as never;
    e.audioElement = el;
    await e.start(ICE, fakeStream);
    const remote = { id: "remote" } as unknown as MediaStream;
    pc.ontrack?.({ streams: [remote] });
    await settle();
    return { e, blocked, remote };
  }

  it("plays the remote track through the element primed in the gesture", async () => {
    const el = fakeAudio(async () => {});
    const { e, blocked, remote } = await engineWithTrack(el);
    expect(el.srcObject).toBe(remote);
    expect(el.play).toHaveBeenCalled();
    expect(blocked).toEqual([false]);
    e.stop();
  });

  it("a refused play() is reported, and resumeAudio() in a new tap clears it", async () => {
    let allow = false;
    const el = fakeAudio(async () => {
      if (!allow) throw new DOMException("not allowed", "NotAllowedError");
    });
    const { e, blocked } = await engineWithTrack(el);
    expect(blocked).toEqual([true]);
    allow = true;
    expect(await e.resumeAudio()).toBe(true);
    expect(blocked).toEqual([true, false]);
    e.stop();
  });

  it("primeRemoteAudio starts an element inside the gesture", () => {
    const played = vi.fn(async () => {});
    vi.stubGlobal("MediaStream", class {});
    vi.stubGlobal("Audio", class {
      autoplay = false;
      srcObject: unknown = null;
      setAttribute = vi.fn();
      play = played;
    });
    const el = primeRemoteAudio();
    expect(el).not.toBeNull();
    expect(el!.autoplay).toBe(true);
    expect(played).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

/**
 * PR-3's additions: the quality dot's verdict, the playout buffer it implies,
 * and the stats reader those two sit on.
 *
 * The report is a browser-shaped object, so the reader is written defensively
 * and tested that way: a missing `nominated` flag, a first sample with no
 * packets yet, a video entry that must not be counted as audio.
 */
describe("qualityFor", () => {
  it("grades on the worst signal, because that is the one the person hears", () => {
    expect(qualityFor({ rttMs: 80, jitterMs: 5, lossPct: 0 })).toBe("good");
    expect(qualityFor({ rttMs: 400, jitterMs: 5, lossPct: 0 })).toBe("fair");
    expect(qualityFor({ rttMs: 80, jitterMs: 120, lossPct: 0 })).toBe("poor");
    expect(qualityFor({ rttMs: 80, jitterMs: 5, lossPct: 6 })).toBe("poor");
    expect(qualityFor({ rttMs: null, jitterMs: null, lossPct: null })).toBe("good");
  });
});

describe("playoutDelayForSample", () => {
  it("is half the RTT plus two jitters, in seconds", () => {
    // 400 ms RTT and 20 ms jitter → 0.2 + 0.04 = 0.24 s.
    expect(playoutDelayForSample({ rttMs: 400, jitterMs: 20 })).toBeCloseTo(0.24, 3);
  });

  it("never goes below the floor or above the cap", () => {
    expect(playoutDelayForSample({ rttMs: 5, jitterMs: 0 })).toBe(0.02);
    expect(playoutDelayForSample({ rttMs: 4000, jitterMs: 90 })).toBe(0.5);
  });

  it("leaves the browser's default alone when there is nothing to go on", () => {
    expect(playoutDelayForSample({ rttMs: null })).toBeNull();
    expect(playoutDelayForSample({ rttMs: Number.NaN })).toBeNull();
  });
});

describe("readStats", () => {
  const report = (entries: unknown[]) => ({
    forEach: (cb: (v: unknown) => void) => entries.forEach(cb),
  });

  it("reads an audio inbound stream and a nominated candidate pair", () => {
    const sample = readStats(
      report([
        { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.12 },
        { type: "inbound-rtp", kind: "audio", jitter: 0.02, packetsLost: 3, packetsReceived: 297 },
        { type: "inbound-rtp", kind: "video", jitter: 0.9, packetsLost: 90, packetsReceived: 10 },
      ]),
    );
    expect(sample.rttMs).toBe(120);
    expect(sample.jitterMs).toBe(20);
    expect(sample.lossPct).toBe(1);
    expect(sample.state).toBe("good");
  });

  it("falls back to an un-nominated pair when the browser does not flag one", () => {
    const sample = readStats(
      report([{ type: "candidate-pair", state: "in-progress", currentRoundTripTime: 0.3 }]),
    );
    expect(sample.rttMs).toBe(300);
    expect(sample.state).toBe("fair");
  });

  it("a first sample with no packets yet reports no loss rather than 0/0", () => {
    const sample = readStats(report([{ type: "inbound-rtp", kind: "audio", packetsLost: 0, packetsReceived: 0 }]));
    expect(sample.lossPct).toBeNull();
  });

  it("an empty or nonsense report is not a crash", () => {
    for (const r of [report([]), null, undefined, {}, []]) {
      expect(() => readStats(r)).not.toThrow();
    }
    expect(readStats(null).state).toBe("good");
  });
});

/* ── PR-3: the noise filter on the OUTBOUND track (§4.4) ─────────────────── */

describe("the noise filter (PR-3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** An engine mid-call, with a sender whose replaceTrack we can watch. */
  async function withFilter(result: unknown, replaceTrack = vi.fn(async () => {})) {
    const pc = makeFakePC();
    const sender = { track: fakeTrack as unknown, replaceTrack };
    (pc as unknown as { getSenders: () => unknown[] }).getSenders = () => [sender];
    const signals: string[] = [];
    const statuses: string[] = [];
    const reasons: Array<string | null> = [];
    const e = new CallEngine(
      {
        onSignal: (sdp, kind) => signals.push(`${kind}:${sdp}`),
        onNoiseFilter: (status, reason) => {
          statuses.push(status);
          reasons.push(reason);
        },
      },
      true,
    );
    e.connectionFactory = (() => pc) as never;
    fakeMic();
    W.apply = async () => result;
    e.noiseWanted = true;
    await e.start(ICE);
    // attachNoise is deliberately NOT awaited by start() (the call must not
    // wait for a wasm fetch before it rings), so let its chain settle here.
    await settle();
    return { e, pc, sender, replaceTrack, signals, statuses, reasons };
  }

  it("swaps the outbound track in place — no new SDP, so no renegotiation", async () => {
    const filtered = { enabled: true, stop: vi.fn() };
    const filteredStream = {
      getAudioTracks: () => [filtered],
      getTracks: () => [filtered],
    } as unknown as MediaStream;
    const stopFilter = vi.fn();
    const { e, replaceTrack, signals, statuses } = await withFilter({
      status: "on",
      stream: filteredStream,
      reason: null,
      stop: stopFilter,
    });

    expect(replaceTrack).toHaveBeenCalledTimes(1);
    expect(replaceTrack).toHaveBeenCalledWith(filtered);
    expect(e.noiseFilter).toEqual({ status: "on", reason: null });
    expect(statuses).toEqual(["on"]);
    // The whole point of replaceTrack: one offer, minted before the filter
    // existed. A second one would be a renegotiation mid-sentence.
    expect(signals.filter((s) => s.startsWith("offer:"))).toHaveLength(1);

    // And the switch back is the raw mic on the same sender, filter torn down.
    await e.setNoiseSuppression(false);
    expect(replaceTrack).toHaveBeenLastCalledWith(fakeTrack);
    expect(stopFilter).toHaveBeenCalled();
    expect(e.noiseFilter).toEqual({ status: "off", reason: null });
    e.stop();
  });

  it("a browser that cannot run the worklet says unavailable — the call keeps the raw track", async () => {
    const raw = { getAudioTracks: () => [fakeTrack], getTracks: () => [fakeTrack] } as unknown as MediaStream;
    const { e, replaceTrack, statuses, reasons } = await withFilter({
      status: "unavailable",
      stream: raw,
      reason: "worklet_unsupported",
      stop: () => {},
    });

    expect(e.noiseFilter).toEqual({ status: "unavailable", reason: "worklet_unsupported" });
    // Nothing was swapped: the unfiltered mic is what the peer is receiving.
    expect(replaceTrack).not.toHaveBeenCalled();
    expect(statuses).toEqual(["unavailable"]);
    expect(reasons).toEqual(["worklet_unsupported"]);
    e.stop();
  });

  it("a filter that sends silence over speech falls back to the raw track (E5)", async () => {
    const filtered = { enabled: true, stop: vi.fn() };
    const filteredStream = {
      getAudioTracks: () => [filtered],
      getTracks: () => [filtered],
    } as unknown as MediaStream;
    const stopFilter = vi.fn();
    const { e, replaceTrack, statuses, reasons } = await withFilter({
      status: "on", stream: filteredStream, reason: null, stop: stopFilter,
    });
    expect(W.onSilent).toBeTypeOf("function");
    W.onSilent!();
    await settle();
    expect(replaceTrack).toHaveBeenLastCalledWith(fakeTrack);
    expect(stopFilter).toHaveBeenCalled();
    expect(e.noiseFilter).toEqual({ status: "unavailable", reason: "silent_output" });
    expect(statuses).toEqual(["on", "unavailable"]);
    expect(reasons.at(-1)).toBe("silent_output");
    e.stop();
  });

  it("the call's teardown closes the filter's audio context with it", async () => {
    const filtered = { enabled: true, stop: vi.fn() };
    const filteredStream = {
      getAudioTracks: () => [filtered],
      getTracks: () => [filtered],
    } as unknown as MediaStream;
    const stopFilter = vi.fn();
    const { e } = await withFilter({ status: "on", stream: filteredStream, reason: null, stop: stopFilter });
    e.stop();
    // The mic indicator on a phone follows the AudioContext: leaving one open
    // after the call is a battery and privacy cost (§4.8).
    expect(stopFilter).toHaveBeenCalledTimes(1);
  });
});

describe("rtcConfiguration (audit C13)", () => {
  it("passes the tenant's relay-only policy to the peer connection", () => {
    expect(rtcConfiguration({ ...ICE, iceTransportPolicy: "relay" }).iceTransportPolicy).toBe("relay");
  });
  it("defaults to every candidate when the server says nothing", () => {
    expect(rtcConfiguration(ICE)).toEqual({ iceServers: ICE.iceServers, iceTransportPolicy: "all" });
  });
});
