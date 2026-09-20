/**
 * Call engine (PR-1) — the P2P half, against a fake RTCPeerConnection.
 *
 * The fake implements exactly the surface the engine drives: SDP in/out,
 * candidate in/out, and the iceConnectionState transitions. Everything the
 * engine OWNS (phase, the clocks, the mic lifecycle) is asserted here, because
 * a call that cannot hang up at 30:00 is a call that ends mid-sentence.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CallEngine, openMic, MAX_CALL_S, MAX_CALL_WARN_S } from "./call-engine";

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
