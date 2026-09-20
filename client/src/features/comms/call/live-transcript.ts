/**
 * The in-call browser capture (Smart Comms PR-2, §4.9) — the listener's words,
 * as the browser's own recogniser heard them.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ────────────────────────────────────
 *
 * It is NOT a transcript. It is the fallback's raw material: when the provider
 * cannot read a side's audio (§4.5 step 3), these segments BECOME that side's
 * transcript rows — flagged, `browser-live`, never certified — so a call whose
 * provider was down still has words the caller can send a summary from.
 *
 * It is stronger in ONE language — the app language it runs in — and that is
 * why flagged rows are labelled in the UI rather than quietly mixed in with
 * certified ones. The same standing rule as chat's browser-transcribe.ts:
 * browser words are never certified into the record.
 *
 * ── SEGMENTS ARE TIMED, AND THE TIMING IS LOAD-BEARING ──────────────────────
 *
 * Each segment carries `started_ms`/`ended_ms` from the START OF THIS SIDE's
 * recording, because that is what lets the SERVER cut the fallback along the
 * recorded part spans (one part = one detected language). Without timestamps the
 * fallback would be one undifferentiated block, and a code-switched call would
 * lose the part boundaries that make its languages legible.
 *
 * Uploaded at hang-up AND periodically during the call: the words are the
 * fallback for a provider that may already be down, so losing them to a closed
 * tab would be losing the whole safety net. The server upserts on (call, side,
 * seq), so a repeat is free.
 */

export type LiveSegment = {
  seq: number;
  text: string;
  language: "en" | "fr";
  started_ms: number;
  ended_ms: number;
};

/** The slice of the Web Speech API this file uses, declared locally (and
 *  exported, so a test can stand in a recogniser that satisfies it): the DOM
 *  typings do not ship it, and the chat module already does the same thing. */
export type SpeechAlternative = { transcript: string; confidence?: number };
export type SpeechResult = { isFinal: boolean; length: number; 0: SpeechAlternative };
export type SpeechEvent = { resultIndex: number; results: { length: number; [i: number]: SpeechResult } };
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
export type RecognitionCtor = new () => Recognition;

/** The browser's constructor, or null where there is none (Firefox, most
 *  WebViews). Null is a NORMAL state: the pipeline then relies on the audio
 *  alone, and only the "provider down AND no recogniser AND no audio" triangle
 *  has no words at all. */
export function speechRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Language tag for the recogniser — the APP language, which the caller's
 *  upload also reports as the draft language. */
export function tagFor(language: "en" | "fr"): string {
  return language === "fr" ? "fr-FR" : "en-GB";
}

export type LiveTranscriptDeps = {
  /** Persist the segments gathered so far. Called on a flush interval and at
   *  the end; resolves whether or not the server answered. */
  flush: (segments: LiveSegment[]) => Promise<void>;
  now?: () => number;
  /** Injectable for tests: the recogniser constructor. */
  Recognition?: RecognitionCtor | null;
};

/** How often the segments gathered so far are pushed. Half a minute of words is
 *  a real loss; every half minute is a request nobody notices mid-call. */
export const LIVE_FLUSH_MS = 30_000;

/**
 * Collect segments from the browser recogniser for the duration of one call.
 *
 * Restart-on-end: the Web Speech API stops itself after a silence (and, in
 * Chrome, after roughly a minute regardless). A fallback that quietly stops
 * listening ten minutes into a thirty-minute call would be worse than none — it
 * would look like the words were simply not said. So `onend` restarts it until
 * the call is over.
 */
export class LiveTranscript {
  private language: "en" | "fr";
  private deps: LiveTranscriptDeps;
  private rec: Recognition | null = null;
  private segments: LiveSegment[] = [];
  private interim = "";
  private startedAt = 0;
  private lastEnd = 0;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private stopped = false;

  constructor(language: "en" | "fr", deps: LiveTranscriptDeps) {
    this.language = language;
    // `Recognition` is injectable for tests; when the caller does not supply
    // one, the browser's own is resolved here, so the session never has to know
    // whether this browser has a recogniser at all.
    this.deps = {
      ...deps,
      Recognition: deps.Recognition === undefined ? speechRecognition() : deps.Recognition,
    };
  }

  get available(): boolean {
    return !!this.deps.Recognition;
  }

  get captured(): LiveSegment[] {
    return this.segments;
  }

  /** Begin listening. A no-op where the browser has no recogniser. */
  start(): void {
    const Ctor = this.deps.Recognition;
    if (!Ctor || this.rec || this.stopped) return;
    const now = this.deps.now || (() => Date.now());
    this.startedAt = this.startedAt || now();
    const rec = new Ctor();
    rec.lang = tagFor(this.language);
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: SpeechEvent) => {
      const at = now();
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i];
        const text = String((result[0] && result[0].transcript) || "").trim();
        if (!text) continue;
        if (!result.isFinal) {
          this.interim = text;
          continue;
        }
        const startMs = Math.max(0, this.lastEnd || at - this.startedAt - text.length * 60);
        const endMs = Math.max(startMs, at - this.startedAt);
        this.lastEnd = endMs;
        this.push({ text, started_ms: startMs, ended_ms: endMs });
      }
    };
    // Restart on end and on error: both mean "the recogniser stopped listening",
    // which is never an acceptable state while the call is still running.
    rec.onerror = () => this.restart(now);
    rec.onend = () => this.restart(now);
    try {
      rec.start();
      this.rec = rec;
    } catch {
      /* @silent:teardown — a recogniser that refuses to start (a second
         instance, a permission the user revoked mid-call) leaves the audio
         upload as the only path, which is exactly the documented triangle.
         Throwing here would take down the call for a listener that was only
         ever the fallback. */
      this.rec = null;
    }
    this.timer = setInterval(() => void this.pushNow(), LIVE_FLUSH_MS);
  }

  private restart(now: () => number): void {
    if (this.stopped) return;
    // The recogniser has stopped itself. Anything after the last final result
    // is still worth keeping — an interim the user did say.
    this.pushInterim(now);
    this.rec = null;
    setTimeout(() => {
      if (!this.stopped) this.start();
    }, 250);
  }

  private pushInterim(now: () => number): void {
    const text = this.interim.trim();
    this.interim = "";
    if (!text) return;
    const endMs = Math.max(this.lastEnd + 1, now() - this.startedAt);
    this.push({ text, started_ms: this.lastEnd, ended_ms: endMs });
    this.lastEnd = endMs;
  }

  private push(seg: { text: string; started_ms: number; ended_ms: number }): void {
    this.segments.push({
      seq: this.seq,
      text: seg.text.slice(0, 2000),
      language: this.language,
      started_ms: Math.round(seg.started_ms),
      ended_ms: Math.round(seg.ended_ms),
    });
    this.seq += 1;
  }

  /** Push everything gathered so far. Never throws — a flush that failed leaves
   *  the segments in place for the next one (the server upserts by seq). */
  async pushNow(): Promise<void> {
    if (!this.segments.length || this.flushing) return;
    const batch = this.segments.slice();
    this.flushing = (async () => {
      try {
        await this.deps.flush(batch);
      } catch {
        /* @silent:storage — the segments stay in memory and the next flush
           sends them again; a failed push is not a reason to end the call. */
      }
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  /** Stop listening and push the tail. Safe to call twice. */
  async stop(): Promise<LiveSegment[]> {
    if (this.stopped) return this.segments;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = this.deps.now || (() => Date.now());
    this.pushInterim(now);
    try {
      this.rec?.stop();
    } catch {
      /* @silent:teardown — stopping a recogniser that already ended itself. */
    }
    this.rec = null;
    await this.pushNow();
    return this.segments;
  }
}
