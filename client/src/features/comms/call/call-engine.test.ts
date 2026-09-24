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
  CallEngine, openMic, MAX_CALL_S, MAX_CALL_WARN_S,
  qualityFor, playoutDelayForSample, readStats, rtcConfiguration,
} from "./call-engine";

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
}));
vi.mock("./noise-suppression", () => ({
  applyNoiseSuppression: (stream: unknown) => W.apply(stream),
}));

type FakeCtor = () => ReturnType<typeof makeFakePC>;

function makeFakePC() {
  const pc: {
    local: { type: string; sdp: string } | null;
    remote: { type: string; sdp: string } | null;
    candidates: unknown[];
    iceConnectionState: string;
    closed: boolean;
    onicecandidate: ((e: { candidate: unknown | null }) => void) | null;
    ontrack: ((e: { streams: MediaStream[] }) => void) | null;
    oniceconnectionstatechange: ((e: Event) => void) | null;
    setRemoteDescription: (d: { type: string; sdp: string }) => Promise<void>;
    createOffer: () => Promise<{ sdp: string }>;
    createAnswer: () => Promise<{ sdp: string }>;
    setLocalDescription: (d: { type: string; sdp: string }) => Promise<void>;
    addTrack: (track: unknown, stream: unknown) => { track: unknown };
    addIceCandidate: (c: unknown) => Promise<void>;
    close: () => void;
  } = {
    local: null,
    remote: null,
    candidates: [],
    iceConnectionState: "new",
    closed: false,
    onicecandidate: null,
    ontrack: null,
    oniceconnectionstatechange: null,
    setRemoteDescription: async (d) => {
      pc.remote = d;
    },
    createOffer: async () => ({ sdp: "OFFER-SDP" }),
    createAnswer: async () => ({ sdp: "ANSWER-SDP" }),
    setLocalDescription: async (d) => {
      pc.local = d;
      // A trickle candidate arrives after the local description, like the
      // real thing: host, then gathering complete (null).
      queueMicrotask(() => {
        pc.onicecandidate?.({ candidate: { candidate: "host" } });
        pc.onicecandidate?.({ candidate: null });
      });
    },
    addTrack: (track) => ({ track }),
    addIceCandidate: async (c) => {
      pc.candidates.push(c);
    },
    close: () => {
      pc.closed = true;
    },
  };
  return pc;
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

describe("CallEngine", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("the caller mints the offer on start and trickles a candidate", async () => {
    const pc = makeFakePC();
    const factory = vi.fn(() => pc) as unknown as FakeCtor;
    const signals: string[] = [];
    const ice: unknown[] = [];
    const e = new CallEngine(
      { onSignal: (sdp, kind) => signals.push(`${kind}:${sdp}`), onIce: (c) => ice.push(c) },
      true,
    );
    e.connectionFactory = factory;
    fakeMic();
    await e.start(ICE);

    expect(e.phase).toBe("connecting");
    expect(pc.local?.sdp).toBe("OFFER-SDP");
    await new Promise((r) => setTimeout(r, 0));
    expect(signals).toEqual(["offer:OFFER-SDP"]);
    expect(ice).toContainEqual({ candidate: "host" });
    expect(ice).toContainEqual(null);
    e.stop();
    expect(pc.closed).toBe(true);
    expect(fakeTrack.stop).toHaveBeenCalled();
  });

  it("answer → connect: onConnected fires once, phase is in_call", async () => {
    const pc = makeFakePC();
    const factory = vi.fn(() => pc) as unknown as FakeCtor;
    const onConnected = vi.fn();
    const onSignal = vi.fn();
    const e = new CallEngine({ onConnected, onSignal }, false);
    e.connectionFactory = factory;
    fakeMic();
    await e.start(ICE);

    await e.applyRemoteOffer("OFFER-SDP");
    expect(pc.remote?.sdp).toBe("OFFER-SDP");
    expect(onSignal).toHaveBeenCalledWith("ANSWER-SDP", "answer");

    pc.iceConnectionState = "connected";
    pc.oniceconnectionstatechange?.({} as Event);
    expect(e.phase).toBe("in_call");
    expect(onConnected).toHaveBeenCalledTimes(1);

    // A second "connected" (completed) must not re-fire — the clock is one.
    pc.iceConnectionState = "completed";
    pc.oniceconnectionstatechange?.({} as Event);
    expect(onConnected).toHaveBeenCalledTimes(1);
    e.stop();
  });

  it("a hard ICE failure reports exactly once", async () => {
    const pc = makeFakePC();
    const onFailed = vi.fn();
    const e = new CallEngine({ onFailed }, true);
    e.connectionFactory = () => pc;
    fakeMic();
    await e.start(ICE);
    pc.iceConnectionState = "failed";
    pc.oniceconnectionstatechange?.({} as Event);
    pc.oniceconnectionstatechange?.({} as Event);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith("ice_failed");
    e.stop();
  });

  it("the 30-minute clock warns at 29:00 and hangs up at 30:00", async () => {
    vi.useFakeTimers();
    const pc = makeFakePC();
    const onWarn = vi.fn();
    const onMax = vi.fn();
    const onTick = vi.fn();
    const e = new CallEngine({ onWarnMaxDuration: onWarn, onMaxDuration: onMax, onTick }, true);
    e.connectionFactory = () => pc;
    fakeMic();
    await e.start(ICE);
    pc.iceConnectionState = "connected";
    pc.oniceconnectionstatechange?.({} as Event);

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
    e.connectionFactory = () => makeFakePC();
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
    const pc = makeFakePC();
    const e = new CallEngine({}, true);
    e.connectionFactory = () => pc;
    await e.addRemoteIceCandidate({ candidate: "early" });
    expect(pc.candidates).toEqual([]);
    e.stop();
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
    e.connectionFactory = (() => pc) as unknown as FakeCtor;
    fakeMic();
    W.apply = async () => result;
    e.noiseWanted = true;
    await e.start(ICE);
    // attachNoise is deliberately NOT awaited by start() (the call must not
    // wait for a wasm fetch before it rings), so let its chain settle here.
    await new Promise((r) => setTimeout(r, 0));
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
    expect(signals.filter((s) => s.startsWith("offer:"))).toEqual(["offer:OFFER-SDP"]);

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
