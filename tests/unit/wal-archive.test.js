"use strict";

/**
 * WS-B1 layer 2 — the WAL archiver, and the reversed-argument defect that made
 * point-in-time recovery impossible.
 *
 * WHAT WAS WRONG
 *
 *   `archive_command` called `store.putStream(key, readStream)`. The signature
 *   is `putStream(readable, key)`. Reversed, the key guard is handed a stream
 *   object, rejects it, and the archiver exits 1 — for every segment, forever.
 *
 *   Nothing catches that without a test like this one, and the symptom is
 *   about as misleading as symptoms get. Postgres responds to a failing
 *   archive_command exactly as it should: it retries and refuses to recycle
 *   the WAL, so the first externally visible sign is the data volume filling
 *   up days later — while the console still shows healthy nightly dumps and
 *   everyone believes the recovery point is five minutes rather than a day.
 *
 * WHY THE ASSERTIONS ARE ABOUT ARGUMENT SHAPE
 *
 *   The interesting property is not "putStream was called" but "it was called
 *   with a stream where a stream goes and a string where a key goes". Pinning
 *   the shape is what stops the reversal being reintroduced; asserting the
 *   call count would have passed against the broken version.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { archiveSegment } = require("../../scripts/db/wal-archive");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-wal-test-"));

/** A realistic-ish segment. The content only matters for the checksum check. */
function writeSegment(name, bytes = 64 * 1024) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, crypto.randomBytes(bytes));
  return p;
}

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

afterAll(async () => {
  // Let any read stream opened during the run finish closing before the
  // directory goes: fs.createReadStream opens lazily, so removing the tree
  // immediately produces a stray ENOENT after the suite has already passed.
  await new Promise((r) => setTimeout(r, 20));
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("wal-archive", () => {
  test("hands putStream a readable and a key, in that order", async () => {
    const name = "000000010000000000000003";
    const source = writeSegment(name);
    const seen = [];

    const store = {
      stat: jest.fn(async () => null), // not yet archived
      putStream: jest.fn(async (readable, key) => {
        seen.push({ readable, key });
        // The real store consumes the stream; a mock that does not must close
        // it, or the lazy open lands after the temp directory is gone.
        if (readable && typeof readable.destroy === "function") readable.destroy();
        return { key, bytes: fs.statSync(source).size, checksum: sha256File(source) };
      }),
    };

    const { code } = await archiveSegment(source, name, { store, prefix: "wal" });

    expect(store.putStream).toHaveBeenCalledTimes(1);
    const call = seen[0];

    // THE REGRESSION. Reversed, `key` is a ReadStream and `readable` a string.
    expect(typeof call.key).toBe("string");
    expect(call.key).toBe(`wal/${name}`);
    expect(call.readable).toBeTruthy();
    expect(typeof call.readable.pipe).toBe("function");

    expect(code).toBe(0);
  });

  test("an already-archived segment of the same size is a successful no-op", async () => {
    const name = "000000010000000000000004";
    const source = writeSegment(name);
    const store = {
      stat: jest.fn(async () => ({ bytes: fs.statSync(source).size })),
      putStream: jest.fn(),
    };

    const { code } = await archiveSegment(source, name, { store, prefix: "wal" });

    // A retry after a partial ack must not re-upload and must not fail.
    expect(store.putStream).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });

  test("refuses to overwrite a segment archived with a different size", async () => {
    const name = "000000010000000000000005";
    const source = writeSegment(name);
    const store = {
      stat: jest.fn(async () => ({ bytes: 17 })), // same name, different bytes
      putStream: jest.fn(),
    };

    const { code, message } = await archiveSegment(source, name, { store, prefix: "wal" });

    // Two servers archiving into one prefix corrupts the recovery sequence
    // silently, so Postgres requires this case to fail rather than overwrite.
    expect(store.putStream).not.toHaveBeenCalled();
    expect(code).toBe(1);
    expect(message).toMatch(/DIFFERENT size/i);
  });

  test("a segment name Postgres would never produce is refused", async () => {
    const source = writeSegment("000000010000000000000006");
    const store = { stat: jest.fn(), putStream: jest.fn() };

    // The segment name becomes a storage key, so this is a path-traversal
    // guard as much as a sanity check.
    const { code } = await archiveSegment(source, "../../etc/passwd", { store, prefix: "wal" });

    expect(store.putStream).not.toHaveBeenCalled();
    expect(code).toBe(1);
  });

  test("a failed upload exits non-zero so Postgres keeps the segment", async () => {
    const name = "000000010000000000000007";
    const source = writeSegment(name);
    const store = {
      stat: jest.fn(async () => null),
      putStream: jest.fn(async () => {
        throw new Error("bucket unreachable");
      }),
    };

    const { code, message } = await archiveSegment(source, name, { store, prefix: "wal" });

    // Reporting success on a failed upload silently discards WAL: the archive
    // develops a hole, and PITR stops at it.
    expect(code).toBe(1);
    expect(message).toMatch(/bucket unreachable/);
  });

  test("a truncated or altered archived copy fails the checksum check", async () => {
    const name = "000000010000000000000008";
    const source = writeSegment(name);
    const store = {
      stat: jest.fn(async () => null),
      putStream: jest.fn(async (readable, key) => ({
        key,
        bytes: 1,
        checksum: "0".repeat(64), // not what was read from disk
      })),
    };

    const { code, message } = await archiveSegment(source, name, { store, prefix: "wal" });

    expect(code).toBe(1);
    expect(message).toMatch(/checksum mismatch/i);
  });

  test("a missing source file is refused before anything is uploaded", async () => {
    const store = { stat: jest.fn(), putStream: jest.fn() };

    const { code, message } = await archiveSegment(
      path.join(TMP, "000000010000000000000009"),
      "000000010000000000000009",
      { store, prefix: "wal" },
    );

    expect(store.putStream).not.toHaveBeenCalled();
    expect(code).toBe(1);
    expect(message).toMatch(/source file missing/i);
  });
});
