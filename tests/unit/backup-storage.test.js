"use strict";

/**
 * WS-B1 — the backup storage driver, exercised against a REAL temporary
 * directory rather than a mock.
 *
 * WHY THIS FILE EXISTS
 *
 *   backup-restore.test.js mocks `putStream` wholesale, so it verified the
 *   orchestration around the writer and nothing about the writer itself. The
 *   writer was silently truncating every dump: the byte counter was a
 *   PassThrough with a `data` listener, which puts the stream into flowing mode
 *   before the pipeline connects a destination, so early chunks were counted,
 *   hashed, and then discarded. A 1.8 MB dump landed as 192 KB, recorded as
 *   1,821,846 bytes with a checksum of the full stream.
 *
 *   Every signal said the backup was fine. Only a restore found it. These tests
 *   put real bytes through the real driver so that class of defect cannot
 *   return unnoticed.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-backup-test-"));
process.env.BACKUP_DRIVER = "local";
process.env.BACKUP_LOCAL_PATH = TMP;

const store = require("../../src/services/platform/backup-storage.service");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** A payload far larger than one 64KB stream chunk — the bug only showed at size. */
function bigPayload(mb = 3) {
  return crypto.randomBytes(mb * 1024 * 1024);
}

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("putStream writes every byte", () => {
  /**
   * The regression test for the truncation. Multi-chunk, and the assertion is
   * against the FILE ON DISK, not against what the writer says it wrote —
   * because the writer said the right thing while writing the wrong thing.
   */
  test("a multi-chunk payload lands complete on disk", async () => {
    const payload = bigPayload(3);
    const r = await store.putStream(Readable.from([payload]), "pg/t/full.dump");

    const onDisk = fs.readFileSync(path.join(TMP, "pg/t/full.dump"));
    expect(onDisk.length).toBe(payload.length);
    expect(onDisk.equals(payload)).toBe(true);

    // And the reported metadata must describe that same file.
    expect(r.bytes).toBe(payload.length);
    expect(r.checksum).toBe(sha256(payload));
    expect(sha256(onDisk)).toBe(r.checksum);
  });

  test("survives a payload arriving as many separate chunks", async () => {
    const chunks = Array.from({ length: 200 }, () => crypto.randomBytes(8192));
    const payload = Buffer.concat(chunks);
    const r = await store.putStream(Readable.from(chunks), "pg/t/chunked.dump");

    const onDisk = fs.readFileSync(path.join(TMP, "pg/t/chunked.dump"));
    expect(onDisk.length).toBe(payload.length);
    expect(r.bytes).toBe(payload.length);
    expect(sha256(onDisk)).toBe(r.checksum);
  });

  test("round-trips through openStream byte-for-byte", async () => {
    const payload = bigPayload(2);
    await store.putStream(Readable.from([payload]), "pg/t/roundtrip.dump");

    const stream = await store.openStream("pg/t/roundtrip.dump");
    const read = [];
    for await (const c of stream) read.push(c);
    expect(Buffer.concat(read).equals(payload)).toBe(true);
  });

  test("an empty stream is written, and reported, as zero bytes", async () => {
    const r = await store.putStream(Readable.from([]), "pg/t/empty.dump");
    expect(r.bytes).toBe(0);
    expect(fs.statSync(path.join(TMP, "pg/t/empty.dump")).size).toBe(0);
  });
});

describe("failure handling", () => {
  /** A partial file must never be promoted to the real key and read as a backup. */
  test("leaves no artefact at the key when the source errors mid-stream", async () => {
    const failing = new Readable({
      read() {
        this.push(crypto.randomBytes(65536));
        this.destroy(new Error("source exploded"));
      },
    });

    await expect(store.putStream(failing, "pg/t/broken.dump")).rejects.toThrow(/exploded/);
    expect(fs.existsSync(path.join(TMP, "pg/t/broken.dump"))).toBe(false);
    expect(fs.existsSync(path.join(TMP, "pg/t/broken.dump.partial"))).toBe(false);
  });

  test("rejects a traversing key rather than writing outside the backup root", async () => {
    await expect(
      store.putStream(Readable.from([Buffer.from("x")]), "../escape.dump"),
    ).rejects.toThrow(/invalid backup key/);
  });
});

describe("listing", () => {
  test("finds written objects and ignores in-progress .partial files", async () => {
    await store.putStream(Readable.from([Buffer.from("a")]), "pg/list/one.dump");
    fs.writeFileSync(path.join(TMP, "pg/list/two.dump.partial"), "incomplete");

    const listed = await store.list("pg/list");
    const keys = listed.map((o) => o.key);
    expect(keys).toContain("pg/list/one.dump");
    expect(keys.some((k) => k.endsWith(".partial"))).toBe(false);
  });

  test("returns empty rather than throwing when nothing has been backed up", async () => {
    await expect(store.list("pg/never-used")).resolves.toEqual([]);
  });
});
