/**
 * Call recorder — one side of one call, as a series of complete audio files
 * (doc/SMART_COMMS_CALLS_AUDIT.md A3).
 *
 * A MediaRecorder started with a timeslice writes the container header into
 * its FIRST chunk only, so any later slice of that stream is undecodable on its
 * own. This recorder therefore starts a new MediaRecorder at every part
 * boundary (on the same track, before the old one stops, so no audio falls in
 * between) and records each without a timeslice: every part is a whole file
 * with its own header, and each is transcribed as soon as it is uploaded.
 *
 * Nothing here touches the network. A closed part is handed to `onPart` (the
 * durable upload outbox, call-upload-outbox.ts), so hanging up never waits on
 * an upload and a part survives a closed tab.
 */

/** A part's length: the 120 s the server expects, cut by the recorder itself. */
export const PART_TARGET_MS = 120_000;
/** Mono Opus at this rate is ~240 KB a minute; browsers default far higher. */
export const RECORDER_BITS_PER_SECOND = 32_000;
/** The server's per-part ceiling. A bigger part is a device fault, not audio. */
export const MAX_PART_BYTES = 12 * 1024 * 1024;

export type RecorderPart = {
  /** 1-based, in recording order, with no gaps. */
  index: number;
  blob: Blob;
  /** Measured from when the part started to when it was stopped. */
  durationMs: number;
  mimeType: string;
};

export type RecorderDeps = {
  /** Take a closed part (persist it, queue its upload). */
  onPart: (part: RecorderPart) => void | Promise<void>;
  /** A part that could not be kept (too large, or the device produced nothing usable). */
  onLost?: (index: number) => void;
  onRecorder?: (recorder: MediaRecorder | null) => void;
  now?: () => number;
  partMs?: number;
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

type Segment = {
  rec: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
  stopped: Promise<void>;
};

/**
 * The track the recorder records: a clone of the call's microphone, asked to
 * be mono. A clone so the recorder can stop its own track at the end without
 * touching the call's, and so the constraint never reaches the call's audio.
 */
async function recordingStream(stream: MediaStream): Promise<{ stream: MediaStream; own: MediaStreamTrack | null }> {
  const track = typeof stream.getAudioTracks === "function" ? stream.getAudioTracks()[0] : undefined;
  if (!track || typeof track.clone !== "function" || typeof MediaStream === "undefined") {
    return { stream, own: null };
  }
  const own = track.clone();
  if (own.readyState === "ended") {
    // A device that will not share its capture: record the call's own track.
    own.stop();
    return { stream, own: null };
  }
  try {
    await own.applyConstraints({ channelCount: 1 });
  } catch {
    /* @silent:teardown — a device that cannot be asked for mono records what it
       has; the bitrate cap still bounds the size. */
  }
  return { stream: new MediaStream([own]), own };
}

/**
 * Lifecycle: `arm(stream)` when media is up → a part closes every
 * PART_TARGET_MS → `finish()` on hang-up closes the last one. Every method is
 * safe to call twice and after `finish()`.
 */
export class CallRecorder {
  readonly callId: string;
  readonly side: "caller" | "callee";
  readonly language: "en" | "fr";
  private deps: RecorderDeps;
  private stream: MediaStream | null = null;
  private ownTrack: MediaStreamTrack | null = null;
  private mimeType = "";
  private current: Segment | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Closes run one after another, so part numbers follow recording order. */
  private closing: Promise<void> = Promise.resolve();
  private parts = 0;
  private lost = 0;
  private armed = false;
  private stopped = false;

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

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Parts that could not be kept. */
  get lostParts(): number {
    return this.lost;
  }

  get isRecording(): boolean {
    return !!this.current && this.current.rec.state === "recording";
  }

  /** Parts closed so far: after `finish()`, the side's declared count. */
  get partCount(): number {
    return this.parts;
  }

  /**
   * Start recording the local side. Rejects when the browser has no
   * MediaRecorder; the call is unaffected and the side declares zero parts.
   */
  async arm(stream: MediaStream): Promise<void> {
    if (this.armed || this.stopped) return;
    if (typeof MediaRecorder === "undefined") throw new Error("no-media-recorder");
    this.armed = true;
    const source = await recordingStream(stream);
    this.stream = source.stream;
    this.ownTrack = source.own;
    if (this.stopped) {
      this.ownTrack?.stop();
      return;
    }
    this.mimeType = pickMimeType();
    this.current = this.startSegment();
    this.schedule();
  }

  private startSegment(): Segment {
    const rec = new MediaRecorder(this.stream as MediaStream, {
      ...(this.mimeType ? { mimeType: this.mimeType } : {}),
      audioBitsPerSecond: RECORDER_BITS_PER_SECOND,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.onerror = () => resolve();
    });
    // No timeslice: the whole part arrives as one file when it is stopped.
    rec.start();
    this.deps.onRecorder?.(rec);
    return { rec, chunks, startedAt: this.now(), stopped };
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.rotate(), this.deps.partMs ?? PART_TARGET_MS);
  }

  /** A part boundary: the next recorder is running before this one stops. */
  private rotate(): void {
    if (this.stopped || !this.current) return;
    const old = this.current;
    try {
      this.current = this.startSegment();
    } catch {
      /* @silent:teardown — the track ended (device unplugged); the part that
         is closing below is the last one this recorder can make. */
      this.current = null;
    }
    if (this.current) this.schedule();
    this.close(old);
  }

  private close(seg: Segment): void {
    const stoppedAt = this.now();
    try {
      if (seg.rec.state !== "inactive") seg.rec.stop();
    } catch {
      /* @silent:teardown — a recorder the browser already stopped has
         delivered its data; the wait below resolves on its own event. */
    }
    this.closing = this.closing.then(async () => {
      await seg.stopped;
      const blob = new Blob(seg.chunks, { type: seg.chunks[0]?.type || this.mimeType || "audio/webm" });
      if (!blob.size) return;
      this.parts += 1;
      const index = this.parts;
      if (blob.size > MAX_PART_BYTES) {
        this.lost += 1;
        this.deps.onLost?.(index);
        return;
      }
      try {
        await this.deps.onPart({
          index,
          blob,
          durationMs: Math.max(0, stoppedAt - seg.startedAt),
          mimeType: blob.type,
        });
      } catch {
        // Counted, never thrown: one part that could not be queued must not
        // stop the parts after it.
        this.lost += 1;
        this.deps.onLost?.(index);
      }
    });
  }

  /**
   * Stop recording and close the last part. Resolves once every part has been
   * handed over; the caller never has to wait for this before hanging up.
   */
  async finish(): Promise<{ parts: number; lost: number }> {
    if (!this.stopped) {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      const seg = this.current;
      this.current = null;
      if (seg) this.close(seg);
      this.deps.onRecorder?.(null);
    }
    await this.closing;
    this.ownTrack?.stop();
    return { parts: this.parts, lost: this.lost };
  }
}
