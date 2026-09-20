/**
 * Call recorder (Smart Comms PR-2) — one MediaRecorder per SIDE, cut into parts.
 *
 * ── WHY PARTS AND NOT ONE FILE ──────────────────────────────────────────────
 *
 * The transcription provider takes a FILE. A 27-minute call is ~25 MB per side
 * on a corridor connection, and one failed upload of it loses the entire side's
 * transcript. So the recorder cuts at 60–120 s, uploads each part as it closes,
 * and a part that fails is a part that failed — not a call. This is the client
 * half of §4.5 step 1, and it is also why the language boundary of a
 * code-switched call lands on a part boundary: each part is detected on its own.
 *
 * ── THE FOUR PROPERTIES THAT MATTER ─────────────────────────────────────────
 *
 *   1. NOTHING IS UPLOADED BEFORE THE CALL CONNECTS. The recorder arms when
 *      media is up (`arm()`), so the dead air of a 40-second ring is not in the
 *      record, and a call that never connected has nothing to store.
 *   2. A CHUNK THAT ARRIVES WHILE THE PREVIOUS UPLOAD IS IN FLIGHT IS BUFFERED,
 *      not dropped. `onmessage` sets `bufferedMs`; the timer only decides when a
 *      part is CLOSED, and closing never waits for the network.
 *   3. HANGING UP NEVER WAITS FOR US. `finish()` is fire-and-forget from the
 *      caller's point of view: PR-1's hang-up path is a REST call and a state
 *      change, and a recorder that made it wait for 20 uploads would be the
 *      flaky-call bug this feature was supposed to be careful not to reintroduce.
 *   4. WHAT CANNOT BE UPLOADED IS SAID OUT LOUD. `onLost` reports parts that
 *      never made it, and the UI shows them; the server's own state
 *      (TRANSCRIPTION_FAILED) covers the other end of the same fact.
 *
 * The live capture (live-transcript.ts) is a SEPARATE concern with its own
 * failure mode, and it rides along with each part's upload as `live_segments`.
 * Where the recogniser is unavailable, the audio still is — and where the audio
 * is not, the words still are.
 */

/** Close a part once it reaches this. Inside the 60–120 s window §4.5 asks for. */
export const PART_TARGET_MS = 120_000;
/** Never let a part be shorter than this unless the call is ending. */
export const PART_MIN_MS = 60_000;
/** How often MediaRecorder hands us bytes. Small enough that a part is a whole
 *  number of chunks even when the timer and the callback disagree. */
export const CHUNK_MS = 5_000;
/** A ceiling per part, matching the server's own bound: past this the bytes are
 *  a client bug (raw PCM, a stuck device) and uploading them wastes the call. */
export const MAX_PART_BYTES = 12 * 1024 * 1024;

export type RecorderChunk = { blob: Blob; ms: number };
export type RecorderPart = { index: number; blob: Blob; durationMs: number };

/**
 * Group buffered chunks into parts.
 *
 * PURE, and exported for exactly that reason: part boundaries are the contract
 * between the client and the transcript (one part = one vendor call = one
 * language answer), and a rule this load-bearing should be testable without a
 * MediaRecorder, a browser, or a network.
 *
 * The cut happens on a CHUNK boundary at or past `targetMs` — never mid-chunk —
 * so the part's duration is honest. A chunk bigger than the target gets a part
 * of its own rather than a cut through it.
 */
export function groupChunks(chunks: RecorderChunk[], targetMs = PART_TARGET_MS): RecorderPart[] {
  const parts: RecorderPart[] = [];
  let current: RecorderChunk[] = [];
  let ms = 0;
  const close = () => {
    if (!current.length) return;
    parts.push({
      index: parts.length + 1,
      blob: new Blob(current.map((c) => c.blob), { type: current[0].blob.type }),
      durationMs: ms,
    });
    current = [];
    ms = 0;
  };
  for (const chunk of chunks) {
    current.push(chunk);
    ms += chunk.ms;
    if (ms >= targetMs) close();
  }
  close();
  return parts;
}

/** What the recorder needs from the outside world, all injectable for tests. */
export type RecorderDeps = {
  /** Upload ONE part. Resolves with the server's answer, rejects on failure. */
  upload: (part: RecorderPart, total: number) => Promise<void>;
  /** Supply the live capture for a part (may be empty). */
  liveSegments?: () => unknown[];
  onRecorder?: (recorder: MediaRecorder | null) => void;
  audioBitsPerSecond?: number;
};

/** The container the browser will actually give us, in preference order. */
export function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  const MR = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  if (!MR || typeof MR.isTypeSupported !== "function") return "";
  return candidates.find((t) => MR.isTypeSupported(t)) || "";
}

/**
 * One side's recorder for one call.
 *
 * Lifecycle: `arm(stream)` → parts upload as they close → `finish()` on
 * hang-up. Every method is safe to call twice and safe to call after `finish()`
 * — the overlay can unmount, the socket can deliver the terminal event, and the
 * user can press hang-up, in any order.
 */
export class CallRecorder {
  readonly callId: string;
  readonly side: "caller" | "callee";
  readonly language: "en" | "fr";
  private deps: RecorderDeps;
  private recorder: MediaRecorder | null = null;
  private buffered: RecorderChunk[] = [];
  private bufferedMs = 0;
  private closed: RecorderPart[] = [];
  private uploads: Promise<void>[] = [];
  private lost = 0;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Total parts the SIDE produced, known only at the end — but a part
   *  uploaded earlier must still declare one, so the count is sent as the
   *  running total and corrected on the final upload (see `send`). */
  private sentCount = 0;

  constructor(opts: {
    callId: string;
    side: "caller" | "callee";
    language: "en" | "fr";
    deps: RecorderDeps;
  }) {
    this.callId = opts.callId;
    this.side = opts.side;
    this.language = opts.language;
    this.deps = opts.deps;
  }

  /** Parts whose upload failed. The UI reports these; the server's own state
   *  covers the same fact from its side, and neither is allowed to be silent. */
  get lostParts(): number {
    return this.lost;
  }

  get isRecording(): boolean {
    return !!this.recorder && this.recorder.state === "recording";
  }

  /**
   * Start recording the local side. Throws when the browser has no
   * MediaRecorder — the caller turns that into the honest UI state ("this
   * browser cannot record; the call is still being transcribed from the live
   * capture where one exists").
   */
  arm(stream: MediaStream): void {
    if (this.recorder || this.stopped) return;
    if (typeof MediaRecorder === "undefined") throw new Error("no-media-recorder");
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      ...(this.deps.audioBitsPerSecond ? { audioBitsPerSecond: this.deps.audioBitsPerSecond } : {}),
    });
    this.recorder = rec;
    this.deps.onRecorder?.(rec);

    rec.ondataavailable = (e: BlobEvent) => {
      if (!e.data || !e.data.size) return;
      this.buffered.push({ blob: e.data, ms: CHUNK_MS });
      this.bufferedMs += CHUNK_MS;
      // Close on the same schedule the chunk arrives on, so the part boundary
      // is a chunk boundary by construction rather than by luck.
      if (this.bufferedMs >= PART_TARGET_MS) this.closePart();
    };
    rec.onstop = () => this.closePart();
    rec.start(CHUNK_MS);
    // A part that has not been closed by its own cadence (a browser that
    // coalesces chunks) is closed here.
    this.timer = setInterval(() => {
      if (this.bufferedMs >= PART_TARGET_MS) this.closePart();
    }, CHUNK_MS);
  }

  /** Map a closed part onto the wire. `total` is the running count: the server
   *  stores it for display ("part 9 of 12") and never uses it to decide when to
   *  transcribe — the pipeline reads what is actually there. */
  private send(part: RecorderPart, total: number): void {
    this.sentCount = Math.max(this.sentCount, total);
    const run = (async () => {
      await this.deps.upload(part, total);
    })().catch(() => {
      // A part that failed to upload is COUNTED, not thrown: the remaining
      // parts are the difference between a transcript with a hole and no
      // transcript at all, and one network blip must not end the side.
      this.lost += 1;
    });
    this.uploads.push(run);
  }

  private closePart(): void {
    if (!this.buffered.length) return;
    // A part below the minimum is only closed when the call is ENDING (finish
    // closes the tail). Otherwise the chunks stay buffered for the next cut,
    // which is what keeps a part in the 60–120 s band on a slow device.
    if (this.bufferedMs < PART_MIN_MS && !this.stopped) return;
    // Everything buffered goes into ONE part here — the sizing decision has
    // already been made by the caller of this function (`bufferedMs` crossed the
    // target, or the call is ending).
    const [part] = groupChunks(this.buffered, Number.POSITIVE_INFINITY);
    if (!part) return;
    this.buffered = [];
    this.bufferedMs = 0;
    this.closed.push(part);
    this.send(part, this.closed.length);
  }

  /**
   * Stop recording and upload the tail. Resolves when every part has been
   * attempted — the CALLER never has to await this (see the header), but a test
   * and the "how many parts were lost" report both need the answer.
   */
  async finish(): Promise<{ parts: number; lost: number }> {
    if (!this.stopped) {
      this.stopped = true;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      try {
        if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
        else this.closePart();
      } catch {
        /* @silent:teardown — a recorder already stopped (the stream ended, the
           tab lost the device) has nothing left to stop; the tail below is
           what matters, and it runs either way. */
      }
      this.closePart();
      this.deps.onRecorder?.(null);
    }
    await Promise.all(this.uploads);
    return { parts: this.sentCount, lost: this.lost };
  }
}
