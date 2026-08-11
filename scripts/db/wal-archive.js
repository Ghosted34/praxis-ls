#!/usr/bin/env node
/**
 * WS-B1 layer 2 — Postgres WAL archiving. This is Postgres's `archive_command`.
 *
 *   archive_command = 'node /app/scripts/db/wal-archive.js "%p" "%f"'
 *
 * Layer 1 (nightly `pg_dump` per tenant) gives an RPO of 24 hours: lose the host
 * at 23:00 and you lose the day. Continuous WAL archiving is what turns that
 * into minutes, which is what D4's "RPO <= 5 min where PITR is available" means.
 * Postgres is self-run on a VPS here, so it IS available.
 *
 * WHY NOT pgBackRest OR wal-g, WHICH THE PLAN NAMES
 *
 *   For the same reasons `object-backup.service.js` declined rclone, and they
 *   apply harder here: a new external binary to install, version-pin and keep
 *   present in the Postgres container; a second credential store and a second
 *   bucket layout that nothing else in this system understands; and a restore
 *   path only that tool can perform. This reuses `backup-storage.service`, so
 *   WAL lands beside the dumps, under the same driver, the same offsite account
 *   (D6) and the same key discipline — and `wal-restore.js` is the whole
 *   inverse.
 *
 *   The honest trade: pgBackRest does parallel, compressed, incremental
 *   archiving with built-in verification, and at a large enough WAL rate it
 *   would win. This is a serial upload of one 16MB segment at a time. If the
 *   archive starts falling behind (the `walStatus` lag figure exists to tell
 *   you), that is the signal to swap this out — the bucket layout stays.
 *
 * RULES THIS FILE MUST OBEY, because Postgres is unforgiving here:
 *
 *   1. EXIT NON-ZERO ON FAILURE. Postgres retries the same segment forever and
 *      will NOT recycle it. Reporting success on a failed upload silently
 *      discards WAL — the archive develops a hole, and PITR stops at it.
 *
 *   2. NEVER OVERWRITE a segment that already exists with DIFFERENT content.
 *      The Postgres docs are explicit: this must fail. An identical re-upload
 *      (a retry after a partial ack) is fine and exits 0.
 *
 *   3. BE FAST AND DO NOT TOUCH THE PLATFORM DATABASE. This runs once per
 *      segment on the Postgres host's critical path. Bookkeeping belongs in the
 *      periodic `walStatus` check, not here — a DB round trip per segment would
 *      couple WAL archiving to the availability of the thing it protects.
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const fs = require("fs");
const crypto = require("crypto");
const store = require("../../src/services/platform/backup-storage.service");
const { config } = require("../../src/config/env");

const [sourcePath, segmentName] = process.argv.slice(2);

/** `wal/000000010000000000000003`. Kept flat: Postgres names sort lexically. */
const keyFor = (name) => `${config.WAL_ARCHIVE_PREFIX || "wal"}/${name}`;

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/** stderr, not stdout: Postgres logs archive_command's stderr. */
const fail = (msg) => {
  process.stderr.write(`wal-archive: ${msg}\n`);
  process.exit(1);
};

(async () => {
  if (!sourcePath || !segmentName) {
    fail('usage: wal-archive.js "%p" "%f" (called by Postgres archive_command)');
  }
  // A segment name is 24 hex characters, or a .backup / .history label. Anything
  // else is not something Postgres produced, and this argument becomes a
  // storage key.
  if (!/^[0-9A-F]{24}(\.[0-9A-F]{8}\.backup|\.history|\.partial)?$/i.test(segmentName)) {
    fail(`refusing to archive an unrecognised segment name: ${segmentName}`);
  }
  if (!fs.existsSync(sourcePath)) fail(`source file missing: ${sourcePath}`);

  const key = keyFor(segmentName);

  try {
    // Rule 2. An identical re-upload is a retry and succeeds; a DIFFERENT file
    // under the same name means two timelines are colliding in one archive,
    // which would corrupt the recovery sequence silently.
    const existing = await store.stat(key).catch(() => null);
    if (existing) {
      const localSize = fs.statSync(sourcePath).size;
      if (existing.bytes === localSize) {
        process.stderr.write(`wal-archive: ${segmentName} already archived (identical size) — ok\n`);
        process.exit(0);
      }
      fail(
        `${segmentName} already exists in the archive with a DIFFERENT size ` +
          `(archived ${existing.bytes}, local ${localSize}). Refusing to overwrite — ` +
          `this usually means two servers are archiving to the same prefix.`,
      );
    }

    const result = await store.putStream(key, fs.createReadStream(sourcePath));

    // Verify what landed rather than trusting the upload. A truncated segment
    // is worse than a missing one: recovery replays it and stops mid-way,
    // reporting success up to a point that is not the point you asked for.
    const localHash = sha256File(sourcePath);
    if (result && result.checksum && result.checksum !== localHash) {
      fail(`checksum mismatch for ${segmentName} — archived copy does not match the source`);
    }

    process.exit(0);
  } catch (err) {
    // Rule 1. Postgres will retry; the WAL file stays on disk until it succeeds.
    fail(`${segmentName}: ${err.message}`);
  }
})();
