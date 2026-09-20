/**
 * The call recorder (PR-2) — part assembly, and the two promises that make it
 * safe to put on a live call: hanging up never waits for the network, and a
 * part that failed is COUNTED rather than thrown.
 *
 * The MediaRecorder here is a stub, deliberately: what this file is testing is
 * the arithmetic of part boundaries (which is what the vendor sees and what the
 * transcript's language chips come from) and the upload discipline, neither of
 * which needs a browser.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CallRecorder,
  groupChunks,
  pickMimeType,
  PART_MIN_MS,
  PART_TARGET_MS,
  CHUNK_MS,
  type RecorderPart,
} from "./call-recorder";

const chunk = (bytes = 64) => ({ blob: new Blob([new Uint8Array(bytes)]), ms: CHUNK_MS });

type Handler = ((e: { data: Blob }) => void) | null;

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  static constructed = 0;
  state = "inactive";
  ondataavailable: Handler = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public opts: Record<string, unknown> = {}) {
    FakeMediaRecorder.constructed += 1;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
  /** Simulate the browser handing over one timeslice of audio. */
  emit(bytes = 64) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

const stream = {} as unknown as MediaStream;

function makeRecorder(over: { upload?: (p: RecorderPart, total: number) => Promise<void> } = {}) {
  const upload = vi.fn(over.upload ?? (async () => {}));
  const rec = new CallRecorder({
    callId: "c1",
    side: "caller",
    language: "fr",
    deps: { upload },
  });
  return { rec, upload };
}

beforeEach(() => {
  FakeMediaRecorder.constructed = 0;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
});

describe("part assembly", () => {
  it("cuts on a chunk boundary at or past the target, never mid-chunk", () => {
    // 25 chunks of 5 s = 125 s: one full 120 s part, then the 5 s remainder.
    const parts = groupChunks(Array.from({ length: 25 }, () => chunk()), PART_TARGET_MS);
    expect(parts.map((p) => p.durationMs)).toEqual([120_000, 5_000]);
    expect(parts.map((p) => p.index)).toEqual([1, 2]);
    // Every chunk is in exactly one part: nothing is dropped at a boundary.
    expect(parts.reduce((n, p) => n + p.durationMs, 0)).toBe(125_000);
  });

  it("a stream shorter than the target is ONE part, not zero parts", () => {
    const parts = groupChunks([chunk(), chunk(), chunk()], PART_TARGET_MS);
    expect(parts).toHaveLength(1);
    expect(parts[0].durationMs).toBe(15_000);
  });

  it("parts land inside the 60–120 s band the guide asks for", () => {
    const parts = groupChunks(Array.from({ length: 24 }, () => chunk()), PART_TARGET_MS);
    expect(parts).toHaveLength(1);
    expect(parts[0].durationMs).toBeGreaterThanOrEqual(60_000);
    expect(parts[0].durationMs).toBeLessThanOrEqual(120_000);
  });
});

describe("the recorder on a live call", () => {
  it("uploads nothing until a part is actually closed", async () => {
    const { rec, upload } = makeRecorder();
    rec.arm(stream);
    const mr = FakeMediaRecorder as unknown as { constructed: number };
    expect(mr.constructed).toBe(1);

    for (let i = 0; i < 10; i += 1) (rec as unknown as { recorder: FakeMediaRecorder }).recorder.emit();
    expect(upload).not.toHaveBeenCalled();

    // 14 more chunks cross the 120 s target: ONE part goes up, and the caller's
    // call is not waiting for it.
    for (let i = 0; i < 14; i += 1) (rec as unknown as { recorder: FakeMediaRecorder }).recorder.emit();
    expect(upload).toHaveBeenCalledTimes(1);
    const [part, total] = upload.mock.calls[0];
    expect(part.index).toBe(1);
    expect(part.durationMs).toBe(PART_TARGET_MS);
    expect(total).toBe(1);
  });

  it("hanging up flushes the tail, and finish() resolves once the uploads settle", async () => {
    const { rec, upload } = makeRecorder();
    rec.arm(stream);
    const mr = (rec as unknown as { recorder: FakeMediaRecorder }).recorder;
    for (let i = 0; i < 24; i += 1) mr.emit();
    for (let i = 0; i < 5; i += 1) mr.emit();

    const out = await rec.finish();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][0].durationMs).toBe(25_000);
    expect(upload.mock.calls[1][1]).toBe(2);
    expect(out).toEqual({ parts: 2, lost: 0 });
  });

  it("a part is never cut below the minimum while the call is running", async () => {
    const { rec, upload } = makeRecorder();
    rec.arm(stream);
    const mr = (rec as unknown as { recorder: FakeMediaRecorder }).recorder;
    for (let i = 0; i < 23; i += 1) mr.emit(); // 115 s — inside the band, not closed
    expect((rec as unknown as { closed: RecorderPart[] }).closed).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
    mr.emit(); // 120 s — the target, and the cut
    const closed = (rec as unknown as { closed: RecorderPart[] }).closed;
    expect(closed).toHaveLength(1);
    expect(closed[0].durationMs).toBeGreaterThanOrEqual(PART_MIN_MS);
    expect(closed[0].durationMs).toBeLessThanOrEqual(PART_TARGET_MS);
  });

  it("a call that ends early still uploads its short tail — the minimum is a floor, not a filter", async () => {
    const { rec, upload } = makeRecorder();
    rec.arm(stream);
    const mr = (rec as unknown as { recorder: FakeMediaRecorder }).recorder;
    for (let i = 0; i < 4; i += 1) mr.emit(); // 20 s
    await rec.finish();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0].durationMs).toBe(20_000);
  });

  it("a part that fails to upload is COUNTED, and the side keeps recording", async () => {
    let calls = 0;
    const { rec } = makeRecorder({
      upload: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network");
      },
    });
    rec.arm(stream);
    const mr = (rec as unknown as { recorder: FakeMediaRecorder }).recorder;
    for (let i = 0; i < 48; i += 1) mr.emit();
    const out = await rec.finish();
    expect(out.parts).toBe(2);
    expect(out.lost).toBe(1);
    expect(rec.lostParts).toBe(1);
  });

  it("arming twice is a no-op, and finishing before arming is safe", async () => {
    const { rec } = makeRecorder();
    rec.arm(stream);
    rec.arm(stream);
    expect(FakeMediaRecorder.constructed).toBe(1);
    const empty = new CallRecorder({ callId: "c9", side: "callee", language: "en", deps: { upload: async () => {} } });
    expect(await empty.finish()).toEqual({ parts: 0, lost: 0 });
  });

  it("the container is chosen from what the browser actually supports", () => {
    expect(pickMimeType()).toBe("audio/webm;codecs=opus");
    (FakeMediaRecorder as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported = (t: string) => t === "audio/mp4";
    expect(pickMimeType()).toBe("audio/mp4");
  });
});
