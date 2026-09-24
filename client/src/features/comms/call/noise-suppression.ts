/**
 * RNNoise on the outbound call track (Smart Comms PR-3, guide §4.4).
 *
 * The problem this exists for is the yard: a forklift, a diesel engine, a
 * loading bay. WebRTC's baseline stack (`noiseSuppression: true` on
 * getUserMedia) is a stationary-noise suppressor tuned for an office floor — it
 * is what every app ships, and it is not enough when the noise is loud, mobile
 * and broadband. RNNoise is a small recurrent network that models speech and
 * subtracts everything else, and it is the "better than a phone in a yard"
 * layer the programme promised.
 *
 * ── THE FOUR RULES THIS FILE IS BUILT AROUND ────────────────────────────────
 *
 * 1. A CALL MUST NEVER BREAK BECAUSE THE FILTER DID NOT LOAD (§4.4, §4.7).
 *    Every path here returns a result rather than throwing, and the failure
 *    result carries a reason the overlay renders ("noise filter unavailable").
 *    The house rule is that every failure says something; a filter that
 *    silently did nothing would be the worst version of this feature.
 *
 * 2. OUT OF THE CRITICAL PATH. Nothing is imported at module scope. The package
 *    (~40 kB of JS plus a ~90 kB wasm binary, fetched with `?url` as an emitted
 *    asset) is pulled in by a dynamic import when a call actually starts, and
 *    the wasm is compiled off the media path: the engine connects the unfiltered
 *    track IMMEDIATELY and swaps in the filtered one when it is ready. A call
 *    that starts 200 ms sooner and gains the filter 300 ms in is the right trade
 *    on a 4G corridor connection.
 *
 * 3. THE SAME TRACK OBJECT IS NOT REUSED. MediaStreamAudioSourceNode takes a
 *    track and never gives it back; the engine's mute path sets `.enabled` on
 *    the mic track, which still works through the graph, so muting before and
 *    after the swap behave identically.
 *
 * 4. IT BELONGS TO THE CALL. `AudioContext`, the worklet node and the
 *    destination track are owned here and torn down by `stop()` — a leaked
 *    AudioContext keeps a microphone indicator lit on a device whose call has
 *    ended, which is both a battery cost and a privacy one.
 */
import type { NoiseFilterStatus, NoiseFilterReason } from "./call-engine";

/** What the loader needs from the environment. Injected so a test can drive
 *  every branch — success, blocked worklet, failed wasm fetch — without a real
 *  AudioContext, which jsdom does not implement. */
export type NoiseDeps = {
  /** `AudioContext` or `webkitAudioContext`, or null when unsupported. */
  createContext?: () => AudioContext | null;
  /** Dynamic import of the package's URL exports. */
  loadUrls?: () => Promise<{ workletUrl: string; wasmUrl: string; wasmSimdUrl: string }>;
  /** Dynamic import of the package's runtime exports. */
  loadLib?: () => Promise<{
    loadRnnoise: (o: { url: string; simdUrl: string }) => Promise<ArrayBuffer>;
    RnnoiseWorkletNode: new (
      ctx: AudioContext,
      o: { maxChannels: number; wasmBinary: ArrayBuffer },
    ) => AudioWorkletNode & { destroy?: () => void };
  }>;
};

export type NoiseResult =
  | { status: "on"; stream: MediaStream; reason: null; stop: () => void }
  | { status: "off"; stream: MediaStream; reason: null; stop: () => void }
  | { status: "unavailable"; stream: MediaStream; reason: NoiseFilterReason; stop: () => void };

/**
 * The default loaders. Split out so the dynamic import is visible in one place
 * — and so the `?url` suffixes, which are the whole reason the wasm is an asset
 * rather than an inlined base64 blob in the entry chunk, are not buried inside
 * the graph builder.
 */
/** An AudioContext at 48 kHz, the rate RNNoise is built for (audit E5);
 *  the device rate where a rate cannot be asked for. */
export function defaultCreateContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ sampleRate: 48_000 });
  } catch {
    try {
      return new Ctor();
    } catch {
      // Constructible-looking but refused (autoplay policy, no audio device).
      return null;
    }
  }
}

/** How long a context gets to leave "suspended" before the filter gives up:
 *  resume() without a gesture can stay pending for ever. */
const RESUME_WAIT_MS = 1_000;

const defaultDeps: Required<NoiseDeps> = {
  createContext: defaultCreateContext,
  loadUrls: async () => {
    const [worklet, wasm, simd] = await Promise.all([
      import("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url"),
      import("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url"),
      import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url"),
    ]);
    return {
      workletUrl: (worklet as { default: string }).default,
      wasmUrl: (wasm as { default: string }).default,
      wasmSimdUrl: (simd as { default: string }).default,
    };
  },
  loadLib: () => import("@sapphi-red/web-noise-suppressor"),
};

/** The pass-through result: the unfiltered track, and a stop() that is a no-op
 *  because there is nothing of ours in the graph. */
function passthrough(
  stream: MediaStream,
  status: "off",
  reason?: never,
): Extract<NoiseResult, { status: "off" }>;
function passthrough(
  stream: MediaStream,
  status: "unavailable",
  reason: NoiseFilterReason,
): Extract<NoiseResult, { status: "unavailable" }>;
function passthrough(
  stream: MediaStream,
  status: "off" | "unavailable",
  reason?: NoiseFilterReason,
): NoiseResult {
  if (status === "off") return { status, stream, reason: null, stop: () => {} };
  return { status, stream, reason: reason ?? "init_failed", stop: () => {} };
}

/**
 * Build a filtered copy of `stream`'s audio.
 *
 * Never throws and never rejects: every failure is a `status: "unavailable"`
 * carrying a reason, because the caller's next line is always "start the call".
 * `onSilent` fires if the filter later turns out to send silence over speech
 * (audit E5); the caller then goes back to the raw track.
 */
export async function applyNoiseSuppression(
  stream: MediaStream,
  deps: NoiseDeps = {},
  opts: { onSilent?: () => void } = {},
): Promise<NoiseResult> {
  const d = { ...defaultDeps, ...deps };
  const track = stream.getAudioTracks()[0];
  if (!track) return passthrough(stream, "unavailable", "no_audio_track");

  let ctx: AudioContext | null = null;
  let node: (AudioWorkletNode & { destroy?: () => void }) | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  try {
    ctx = d.createContext();
    if (!ctx) return passthrough(stream, "unavailable", "no_audio_context");
    // A suspended context renders nothing: a filter on one sends silence
    // while the overlay says "on" (audit E5).
    if (ctx.state === "suspended") {
      await Promise.race([
        ctx.resume().catch(() => {
          /* @silent:teardown — refused: the state check below reports it. */
        }),
        new Promise((r) => setTimeout(r, RESUME_WAIT_MS)),
      ]);
      if ((ctx.state as string) === "suspended") {
        void ctx.close().catch(() => {
          /* @silent:teardown — discarding a context that never started. */
        });
        return passthrough(stream, "unavailable", "suspended");
      }
    }

    const urls = await d.loadUrls();
    const lib = await d.loadLib();
    const wasmBinary = await lib.loadRnnoise({ url: urls.wasmUrl, simdUrl: urls.wasmSimdUrl });
    await ctx.audioWorklet.addModule(urls.workletUrl);

    node = new lib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    source = ctx.createMediaStreamSource(stream);
    const sink = ctx.createMediaStreamDestination();
    source.connect(node);
    node.connect(sink);

    const filtered = sink.stream.getAudioTracks()[0];
    if (!filtered) {
      node.disconnect();
      void ctx.close().catch(() => {
        /* @silent:teardown — the context is being discarded; its close error is noise on a path that already returns "unavailable". */
      });
      return passthrough(stream, "unavailable", "no_audio_track");
    }

    const stopWatch = opts.onSilent ? watchGraph(ctx, source, node, opts.onSilent) : () => {};
    return {
      status: "on",
      stream: sink.stream,
      reason: null,
      stop: () => {
        stopWatch();
        try {
          node?.disconnect();
          node?.destroy?.();
          source?.disconnect();
        } catch {
          // @silent:teardown — disconnect on an already-torn-down graph is a no-op.
        }
        void ctx?.close().catch(() => {
          // @silent:teardown — closing a closed AudioContext is a no-op.
        });
      },
    };
  } catch (err) {
    // THE FALLBACK PATH, and the one that matters: the call continues on the
    // unfiltered track. Whatever went wrong (worklet addModule blocked by a
    // CSP, wasm fetch blocked by the network, a browser without AudioWorklet),
    // it is reported as a reason the overlay can show — never as silence.
    try {
      node?.disconnect();
      source?.disconnect();
    } catch {
      // @silent:teardown — same as above; we are already on the failure path.
    }
    void ctx?.close().catch(() => {
      /* @silent:teardown — same: we are already on the fallback path and the original error is the one worth reporting. */
    });
    return passthrough(stream, "unavailable", reasonFor(err));
  }
}

/** RMS level of what an analyser hears right now, 0..1. */
function level(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** Tap the graph's input and output with analysers and watch them. */
function watchGraph(
  ctx: AudioContext,
  source: AudioNode,
  node: AudioNode,
  onSilent: () => void,
): () => void {
  if (typeof ctx.createAnalyser !== "function") return () => {};
  const input = ctx.createAnalyser();
  const output = ctx.createAnalyser();
  source.connect(input);
  node.connect(output);
  const inBuf = new Float32Array(input.fftSize);
  const outBuf = new Float32Array(output.fftSize);
  const stop = watchForSilentOutput({
    readInput: () => level(input, inBuf),
    readOutput: () => level(output, outBuf),
    onSilent,
  });
  return () => {
    stop();
    try {
      input.disconnect();
      output.disconnect();
    } catch {
      // @silent:teardown — the graph is already torn down.
    }
  };
}

/** Speech on the mic is louder than this (RMS). */
const SPEECH_LEVEL = 0.01;
/** The filter's output counts as silent below this. */
const SILENT_LEVEL = 0.0005;

/**
 * Watch a filter for sending silence while the microphone hears speech
 * (audit E5): 1.5 s of speech in and nothing out calls `onSilent` once. The
 * first time speech comes out, the filter is proven and the watch ends; two
 * minutes without speech ends it too. Returns a stop function.
 */
export function watchForSilentOutput({
  readInput,
  readOutput,
  onSilent,
  sampleMs = 250,
  silentForMs = 1_500,
  giveUpMs = 120_000,
}: {
  readInput: () => number;
  readOutput: () => number;
  onSilent: () => void;
  sampleMs?: number;
  silentForMs?: number;
  giveUpMs?: number;
}): () => void {
  let silentMs = 0;
  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += sampleMs;
    const speaking = readInput() > SPEECH_LEVEL;
    if (speaking && readOutput() > SILENT_LEVEL) return stop();
    if (speaking) silentMs += sampleMs;
    if (silentMs >= silentForMs) {
      stop();
      onSilent();
      return;
    }
    if (elapsed >= giveUpMs) stop();
  }, sampleMs);
  function stop() {
    clearInterval(timer);
  }
  return stop;
}

/**
 * Turn a thrown thing into a reason the UI can print.
 *
 * The mapping is deliberately coarse — the sentence in the overlay is the same
 * for "no worklet support" and "the module failed to load" because the person
 * holding the phone can act on neither, and the detail lives in the call's own
 * console line. What the caller must not get is a silent success.
 */
export function reasonFor(err: unknown): NoiseFilterReason {
  const message = err instanceof Error ? err.message : String(err || "");
  if (/AudioWorklet|addModule/i.test(message)) return "worklet_unsupported";
  if (/fetch|network|Failed to load|wasm/i.test(message)) return "wasm_load_failed";
  if (/context/i.test(message)) return "no_audio_context";
  return "init_failed";
}

/** The status the engine exposes for the overlay's dot and sentence. */
export type { NoiseFilterStatus };
