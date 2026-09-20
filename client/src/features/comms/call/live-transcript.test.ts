/**
 * The in-call browser capture (PR-2, §4.9) — what the fallback gets.
 *
 * The recogniser is a stub, because what matters here is not the recognition: it
 * is that segments come out TIMED (the server cuts them along part spans), that
 * the hook restarts itself when the browser stops it (a fallback that quietly
 * stops listening is worse than none), and that a failed flush does not lose
 * the words.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LiveTranscript, tagFor,
  type LiveSegment, type Recognition, type RecognitionCtor, type SpeechEvent,
} from "./live-transcript";

class FakeRecognition implements Recognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: SpeechEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
  /** Emit one browser result, final or interim. */
  say(text: string, isFinal = true) {
    const results: SpeechEvent["results"] = {
      0: { isFinal, length: 1, 0: { transcript: text, confidence: 1 } },
      length: 1,
    };
    this.onresult?.({ resultIndex: 0, results });
  }
}

let clock = 0;
const now = () => clock;

beforeEach(() => {
  clock = 1_700_000_000_000;
  FakeRecognition.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

function make(flush: (segments: LiveSegment[]) => Promise<void> = async () => {}) {
  const live = new LiveTranscript("fr", { flush, now, Recognition: FakeRecognition as unknown as RecognitionCtor });
  return { live, flush };
}

describe("the live capture", () => {
  it("is unavailable where the browser has no recogniser, and says so instead of pretending", () => {
    const live = new LiveTranscript("en", { flush: async () => {}, Recognition: null });
    void (null as unknown as LiveSegment);
    expect(live.available).toBe(false);
    live.start();
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it("runs in the app language", () => {
    const { live } = make();
    live.start();
    expect(FakeRecognition.instances[0].lang).toBe(tagFor("fr"));
    expect(FakeRecognition.instances[0].lang).toBe("fr-FR");
    expect(tagFor("en")).toBe("en-GB");
  });

  it("times each segment from the start of the side's own recording", () => {
    const { live } = make();
    live.start();
    clock += 3_000;
    FakeRecognition.instances[0].say("bonjour tout le monde");
    clock += 5_000;
    FakeRecognition.instances[0].say("deux conteneurs");

    const [first, second] = live.captured;
    expect(first).toMatchObject({ seq: 0, text: "bonjour tout le monde", language: "fr" });
    expect(first.started_ms).toBeLessThanOrEqual(first.ended_ms);
    expect(second.seq).toBe(1);
    // Monotonic and inside the call: 8 s have passed.
    expect(second.ended_ms).toBeLessThanOrEqual(8_000);
    expect(second.started_ms).toBeGreaterThanOrEqual(first.ended_ms);
  });

  it("keeps an interim the recogniser never finalised", async () => {
    const { live } = make();
    live.start();
    clock += 8_000;
    FakeRecognition.instances[0].say("trois tonnes", false);
    await live.stop();
    expect(live.captured.map((s) => s.text)).toContain("trois tonnes");
  });

  it("restarts itself when the browser stops it, so a long call keeps being heard", async () => {
    vi.useFakeTimers();
    const { live } = make();
    live.start();
    const first = FakeRecognition.instances[0];
    first.onend?.();
    vi.advanceTimersByTime(300);
    expect(FakeRecognition.instances.length).toBe(2);
    await live.stop();
    expect(FakeRecognition.instances[1].stopped).toBe(1);
  });

  it("flushes what it has, and a failed flush does not lose the words", async () => {
    const flush = vi.fn<(segments: LiveSegment[]) => Promise<void>>(async () => {
      throw new Error("offline");
    });
    const { live } = make(flush);
    live.start();
    clock += 2_000;
    FakeRecognition.instances[0].say("allo");
    await live.pushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    // Still there for the next attempt — the server upserts by seq.
    expect(live.captured).toHaveLength(1);
    await live.stop();
    expect(flush.mock.calls[flush.mock.calls.length - 1][0]).toHaveLength(1);
  });
});
