#!/usr/bin/env node
/**
 * WS-B1 layer 2 — the inverse of `wal-archive.js`. Postgres's `restore_command`.
 *
 *   restore_command = 'node /app/scripts/db/wal-restore.js "%f" "%p"'
 *
 * Used during point-in-time recovery: Postgres asks for one WAL segment at a
 * time and replays it until it reaches `recovery_target_time`.
 *
 * EXIT CODES MATTER AND ARE NOT LIKE archive_command's.
 *
 *   0  — segment fetched. Postgres replays it and asks for the next one.
 *   1  — segment NOT AVAILABLE. This is not necessarily an error: it is also
 *        how recovery discovers it has reached the end of the archive, which is
 *        the normal way a PITR finishes. So a missing segment must exit 1
 *        quietly rather than shouting, or every successful recovery ends with
 *        an alarming log.
 *
 *   The consequence worth stating: a genuinely CORRUPT or unreachable archive
 *   looks the same to Postgres as a complete one. That is why `walStatus()`
 *   checks the archive continuously and why the restore drill exists — you
 *   cannot find this out at recovery time, which is the worst possible moment.
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const fs = require("fs");
const { pipeline } = require("stream/promises");
const store = require("../../src/services/platform/backup-storage.service");
const { config } = require("../../src/config/env");

const [segmentName, destPath] = process.argv.slice(2);

const keyFor = (name) => `${config.WAL_ARCHIVE_PREFIX || "wal"}/${name}`;

const bail = (code, msg) => {
  process.stderr.write(`wal-restore: ${msg}\n`);
  process.exit(code);
};

(async () => {
  if (!segmentName || !destPath) {
    bail(1, 'usage: wal-restore.js "%f" "%p" (called by Postgres restore_command)');
  }
  if (!/^[0-9A-F]{24}(\.[0-9A-F]{8}\.backup|\.history|\.partial)?$/i.test(segmentName)) {
    bail(1, `unrecognised segment name: ${segmentName}`);
  }

  const key = keyFor(segmentName);

  try {
    const exists = await store.exists(key);
    // The normal end of recovery, not a fault. Quiet on purpose.
    if (!exists) process.exit(1);

    // Download to a temp name and rename into place. Postgres reads the
    // destination as soon as this exits 0, so a partially-written file at the
    // real path would be replayed as though it were complete.
    const tmp = `${destPath}.praxis-partial`;
    await pipeline(await store.openStream(key), fs.createWriteStream(tmp));
    fs.renameSync(tmp, destPath);

    process.exit(0);
  } catch (err) {
    bail(1, `${segmentName}: ${err.message}`);
  }
})();
