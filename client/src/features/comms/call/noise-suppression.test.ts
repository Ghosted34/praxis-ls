/**
 * RNNoise on the outbound track (PR-3, §4.4) — every failure path, because the
 * fallback IS the feature.
 *
 * A noise filter that takes the call down with it when its wasm fetch fails is
 * worse than no filter at all: the corridor connection that needs the filter is
 * exactly the one where the fetch is most likely to fail. So the assertions
 * here are less about "does it filter" (that is a listening test on the manual
 * matrix, and jsdom has no audio graph to prove it with) and more about
 * "what does the call get when any of the four things go wrong".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyNoiseSuppression, reasonFor, watchForSilentOutput, defaultCreateContext, type NoiseDeps,
} from "./noise-suppression";

const track = { kind: "audio", enabled: true } as unknown as MediaStreamTrack;
const stream = {
  getAudioTracks: () => [track],
  getTracks: () => [track],
} as unknown as MediaStream;

const filteredTrack = { kind: "audio" } as unknown as MediaStreamTrack;
const filteredStream = {
  getAudioTracks: () => [filteredTrack],
  getTracks: () => [filteredTrack],
} as unknown as MediaStream;

/** A fake AudioContext with just the graph the module touches. */
function fakeContext(over: Partial<Record<string, unknown>> = {}) {
  const node = { connect: vi.fn(), disconnect: vi.fn(), destroy: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const sink = { stream: filteredStream, connect: vi.fn(), disconnect: vi.fn() };
  const ctx = {
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: vi.fn(() => source),
    createMediaStreamDestination: vi.fn(() => sink),
    close: vi.fn(async () => {}),
    node,
    source,
    sink,
    ...over,
  };
  return ctx;
}

const deps = (ctx: ReturnType<typeof fakeContext> | null, over: Partial<NoiseDeps> = {}): NoiseDeps => ({
  createContext: () => (ctx as unknown as AudioContext) ?? null,
  loadUrls: async () => ({ workletUrl: "worklet.js", wasmUrl: "a.wasm", wasmSimdUrl: "b.wasm" }),
  loadLib: async () => ({
    loadRnnoise: async () => new ArrayBuffer(8),
    RnnoiseWorkletNode: class {
      constructor() {
        return ctx?.node as unknown as AudioWorkletNode;
      }
    } as never,
  }),
  ...over,
});

describe("applyNoiseSuppression", () => {
  it("builds the graph and hands back a filtered stream whose stop() tears everything down", async () => {
    const ctx = fakeContext();
    const res = await applyNoiseSuppression(stream, deps(ctx));
    expect(res.status).toBe("on");
    expect(res.stream).toBe(filteredStream);
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith("worklet.js");
    expect(ctx.source.connect).toHaveBeenCalled();

    res.stop();
    expect(ctx.node.disconnect).toHaveBeenCalled();
    expect(ctx.node.destroy).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });

  it("a browser with no AudioContext keeps the call on the unfiltered track", async () => {
    const res = await applyNoiseSuppression(stream, deps(null));
    expect(res).toMatchObject({ status: "unavailable", reason: "no_audio_context" });
    expect(res.stream).toBe(stream);
    expect(() => res.stop()).not.toThrow();
  });

  it("a stream with no audio track is a reason, not a crash", async () => {
    const silent = { getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream;
    const res = await applyNoiseSuppression(silent, deps(fakeContext()));
    expect(res).toMatchObject({ status: "unavailable", reason: "no_audio_track" });
  });

  it("a failed wasm fetch is named, and the unfiltered track still goes out", async () => {
    const res = await applyNoiseSuppression(
      stream,
      deps(fakeContext(), {
        loadLib: async () => {
          throw new Error("Failed to fetch wasm binary");
        },
      }),
    );
    expect(res.status).toBe("unavailable");
    expect(res.reason).toBe("wasm_load_failed");
    expect(res.stream).toBe(stream);
  });

  it("addModule refusing (CSP, no worklet support) is reported, not thrown", async () => {
    const ctx = fakeContext({
      audioWorklet: {
        addModule: vi.fn(async () => {
          throw new Error("AudioWorklet is not defined");
        }),
      },
    });
    const res = await applyNoiseSuppression(stream, deps(ctx));
    expect(res).toMatchObject({ status: "unavailable", reason: "worklet_unsupported" });
    // The half-built context is closed: the alternative is an open one holding
    // the mic indicator for the rest of the call.
    expect(ctx.close).toHaveBeenCalled();
  });
});

/* ── Calls audit E5: a filter that sends silence while the UI says "on" ─── */

describe("the filter's context (E5)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is created at 48 kHz, the rate RNNoise is built for", () => {
    const made: unknown[] = [];
    vi.stubGlobal("AudioContext", class {
      constructor(opts?: unknown) {
        made.push(opts);
      }
    });
    expect(defaultCreateContext()).not.toBeNull();
    expect(made).toEqual([{ sampleRate: 48_000 }]);
  });

  it("falls back to the device rate where a rate cannot be asked for", () => {
    const made: unknown[] = [];
    vi.stubGlobal("AudioContext", class {
      constructor(opts?: unknown) {
        if (opts) throw new Error("NotSupportedError");
        made.push("default");
      }
    });
    expect(defaultCreateContext()).not.toBeNull();
    expect(made).toEqual(["default"]);
  });

  it("a context that will not start is 'suspended', and the raw track goes out", async () => {
    const resume = vi.fn(async () => {});
    const ctx = fakeContext({ state: "suspended", resume });
    const res = await applyNoiseSuppression(stream, deps(ctx));
    expect(resume).toHaveBeenCalled();
    expect(res).toMatchObject({ status: "unavailable", reason: "suspended" });
    expect(res.stream).toBe(stream);
    expect(ctx.close).toHaveBeenCalled();
  });

  it("a suspended context that resumes is used", async () => {
    const ctx = fakeContext({ state: "suspended" });
    // The context starts suspended and runs once resumed (a spread would copy
    // a getter's value, so the resume is attached to the object itself).
    Object.assign(ctx, {
      resume: vi.fn(async () => {
        Object.assign(ctx, { state: "running" });
      }),
    });
    const res = await applyNoiseSuppression(stream, deps(ctx));
    expect(res.status).toBe("on");
  });
});

describe("watchForSilentOutput (E5)", () => {
  afterEach(() => vi.useRealTimers());

  it("calls onSilent when the mic hears speech and the filter sends nothing", () => {
    vi.useFakeTimers();
    const onSilent = vi.fn();
    watchForSilentOutput({ readInput: () => 0.2, readOutput: () => 0, onSilent });
    vi.advanceTimersByTime(1_000);
    expect(onSilent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onSilent).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onSilent).toHaveBeenCalledTimes(1);
  });

  it("quiet on both sides proves nothing and fires nothing", () => {
    vi.useFakeTimers();
    const onSilent = vi.fn();
    watchForSilentOutput({ readInput: () => 0, readOutput: () => 0, onSilent });
    vi.advanceTimersByTime(30_000);
    expect(onSilent).not.toHaveBeenCalled();
  });

  it("stops watching once the filter is heard passing speech", () => {
    vi.useFakeTimers();
    const onSilent = vi.fn();
    let out = 0.05;
    watchForSilentOutput({ readInput: () => 0.2, readOutput: () => out, onSilent });
    vi.advanceTimersByTime(500);
    out = 0; // later silence is the person pausing, not the filter
    vi.advanceTimersByTime(10_000);
    expect(onSilent).not.toHaveBeenCalled();
  });

  it("the stop function ends the watch", () => {
    vi.useFakeTimers();
    const onSilent = vi.fn();
    const stop = watchForSilentOutput({ readInput: () => 0.2, readOutput: () => 0, onSilent });
    stop();
    vi.advanceTimersByTime(5_000);
    expect(onSilent).not.toHaveBeenCalled();
  });
});

describe("reasonFor", () => {
  it("maps a thrown thing to a reason the overlay can print", () => {
    expect(reasonFor(new Error("Failed to fetch"))).toBe("wasm_load_failed");
    expect(reasonFor(new Error("addModule failed"))).toBe("worklet_unsupported");
    expect(reasonFor(new Error("AudioContext is not allowed to start"))).toBe("no_audio_context");
    expect(reasonFor("something else entirely")).toBe("init_failed");
    expect(reasonFor(undefined)).toBe("init_failed");
  });
});
