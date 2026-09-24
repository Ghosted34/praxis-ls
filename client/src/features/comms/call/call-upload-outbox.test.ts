/**
 * The recording upload queue (calls audit E11, A2): parts and the side's
 * declaration go out in order, a failed upload is retried with backoff, a
 * refusal is final, and whatever was not acknowledged is still there on the
 * next page load, so the last part of a call survives a closed tab.
 */
import { describe, it, expect, vi } from "vitest";
import {
  UploadOutbox,
  memoryStore,
  itemId,
  isFinalRefusal,
  BACKOFF_MS,
  MAX_AGE_MS,
  type OutboxItem,
  type OutboxStore,
} from "./call-upload-outbox";

const part = (index: number, over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: itemId({ kind: "part", callId: "c1", side: "caller", index }),
  kind: "part",
  callId: "c1",
  side: "caller",
  index,
  blob: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]),
  durationMs: 120_000,
  mimeType: "audio/webm",
  language: "en",
  createdAt: 1_000 + index,
  attempts: 0,
  ...over,
} as OutboxItem);

const complete = (parts: number): OutboxItem => ({
  id: itemId({ kind: "complete", callId: "c1", side: "caller" }),
  kind: "complete",
  callId: "c1",
  side: "caller",
  parts,
  createdAt: 5_000,
  attempts: 0,
});

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const label = (i: OutboxItem) => (i.kind === "part" ? `part ${i.index}` : `complete ${i.parts}`);

function outboxWith(send: (item: OutboxItem) => Promise<void>, store: OutboxStore = memoryStore()) {
  const sleeps: number[] = [];
  const lost: string[] = [];
  const box = new UploadOutbox({
    store,
    send,
    sleep: async (ms) => { sleeps.push(ms); },
    onLost: (i) => lost.push(label(i)),
    now: () => 10_000,
  });
  return { box, sleeps, lost, store };
}

describe("the upload queue", () => {
  it("sends parts, then the declaration, in the order they were added", async () => {
    const sent: string[] = [];
    const { box, store } = outboxWith(async (i) => { sent.push(label(i)); });
    await box.add(part(1));
    await box.add(part(2));
    await box.add(complete(2));
    await box.idle();
    expect(sent).toEqual(["part 1", "part 2", "complete 2"]);
    expect(await store.all()).toEqual([]);
  });

  it("a network error, a timeout, a 429 or a 5xx is retried with backoff; the item is not skipped", async () => {
    const sent: string[] = [];
    const failures = [httpError(0), httpError(503), httpError(429)];
    const { box, sleeps } = outboxWith(async (i) => {
      if (i.kind === "part" && i.index === 1 && failures.length) throw failures.shift();
      sent.push(label(i));
    });
    await box.add(part(1));
    await box.add(part(2));
    await box.idle();
    expect(sleeps).toEqual(BACKOFF_MS.slice(0, 3));
    expect(sent).toEqual(["part 1", "part 2"]);
  });

  it("a refusal is final: the item is dropped and reported, and the queue moves on", async () => {
    const sent: string[] = [];
    const { box, lost, store } = outboxWith(async (i) => {
      if (i.kind === "part" && i.index === 1) throw httpError(409); // the window closed
      sent.push(label(i));
    });
    await box.add(part(1));
    await box.add(complete(1));
    await box.idle();
    expect(lost).toEqual(["part 1"]);
    expect(sent).toEqual(["complete 1"]);
    expect(await store.all()).toEqual([]);
  });

  it("out of retries this session, the item stays stored and is sent on the next load", async () => {
    const store = memoryStore();
    const first = outboxWith(async () => { throw httpError(0); }, store);
    await first.box.add(part(1));
    await first.box.idle();
    expect(first.sleeps).toEqual(BACKOFF_MS);
    expect((await store.all()).map(label)).toEqual(["part 1"]);

    // The tab closed; a new page loads and resumes.
    const sent: string[] = [];
    const second = outboxWith(async (i) => { sent.push(label(i)); }, store);
    await second.box.resume();
    await second.box.idle();
    expect(sent).toEqual(["part 1"]);
    expect(await store.all()).toEqual([]);
  });

  it("resume sends what an earlier page left, oldest first, and drops what is too old to be accepted", async () => {
    const store = memoryStore();
    await store.put(complete(2));
    await store.put(part(2));
    await store.put(part(1));
    await store.put(part(9, { createdAt: 10_000 - MAX_AGE_MS - 1 }));
    const sent: string[] = [];
    const { box } = outboxWith(async (i) => { sent.push(label(i)); }, store);
    await box.resume();
    await box.idle();
    expect(sent).toEqual(["part 1", "part 2", "complete 2"]);
    expect(await store.all()).toEqual([]);
  });

  it("the same part added twice keeps one place in the queue and is sent once", async () => {
    const send = vi.fn(async (_i: OutboxItem) => {});
    const { box } = outboxWith(send);
    const p = part(1);
    await Promise.all([box.add(p), box.add({ ...p })]);
    await box.idle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(box.pending).toHaveLength(0);
  });

  it("classifies what is worth retrying", () => {
    expect(isFinalRefusal(httpError(422))).toBe(true);
    expect(isFinalRefusal(httpError(413))).toBe(true);
    expect(isFinalRefusal(httpError(401))).toBe(false); // a session to renew
    expect(isFinalRefusal(httpError(408))).toBe(false);
    expect(isFinalRefusal(httpError(429))).toBe(false);
    expect(isFinalRefusal(httpError(500))).toBe(false);
    expect(isFinalRefusal(new Error("offline"))).toBe(false);
  });
});
