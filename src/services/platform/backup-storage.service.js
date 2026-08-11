/**
 * Backup storage — where tenant dumps and object syncs are written.
 *
 * Two interchangeable drivers behind one interface, chosen by BACKUP_DRIVER,
 * mirroring `storage.service.js`. Three things make this a separate module
 * rather than a reuse of that one:
 *
 *   1. INDEPENDENCE (decision D6). Backups belong in a different provider or
 *      account from primary storage, because a backup that shares a credential
 *      with the data it protects does not survive that credential being
 *      compromised — which is one of the four threats §3.2 lists. Separate
 *      config is what makes that separation real rather than aspirational.
 *
 *   2. STREAMS, NOT BUFFERS. The document vault deals in files a person
 *      uploaded; this deals in `pg_dump` output, which for a real tenant is
 *      hundreds of megabytes to gigabytes. `storage.service.put()` takes a
 *      Buffer, and buffering a multi-gigabyte dump to serialise it into memory
 *      is how a backup job takes the worker down with it. Everything here is a
 *      stream end to end.
 *
 *   3. LISTING. Retention needs to enumerate what exists and delete what has
 *      aged out. The vault never needed `list()`; a backup store is useless
 *      without it.
 *
 * The S3 driver lazily requires '@aws-sdk/client-s3' so a local-driver
 * deployment does not need the package installed.
 */
"use strict";

const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const runtimeConfig = require("./runtime-config.service");

/**
 * WHY THE DRIVER AND CREDENTIALS ARE RESOLVED PER CALL, NOT AT MODULE LOAD
 *
 *   They used to be read once when this file was required: `const DRIVER =
 *   config.BACKUP_DRIVER`, an `impl` chosen from it, and the exports bound
 *   straight to that object. That is fine when the only source is `.env`, which
 *   cannot change while the process runs.
 *
 *   It stops being fine now the platform settings vault is the primary source.
 *   An operator rotating a bucket key in the console expects the next backup to
 *   use it — not the next deploy. Binding at load time would mean the console
 *   reporting a change that the running process ignores, which is exactly the
 *   "control that reports success and changes nothing" this codebase keeps
 *   ruling out.
 *
 *   So every exported call resolves first. The cost is one cached lookup per
 *   call (see runtime-config.service for the TTL); the streaming, hashing and
 *   key-safety logic below is untouched.
 */
async function cfg() {
  return runtimeConfig.backupStorage();
}

/**
 * Same key discipline as the document vault, and for the same reason: keys are
 * composed by callers out of slugs and timestamps, and `path.join` will happily
 * resolve `../../` outside the backup root. The guard lives at the one place
 * both drivers funnel through.
 */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;

function assertSafeKey(key) {
  const k = key === null || key === undefined ? "" : String(key);
  if (!KEY_RE.test(k) || k.includes("..") || k.includes("//")) {
    const e = new Error(`invalid backup key: ${k}`);
    e.status = 400;
    throw e;
  }
  return k;
}

function localPath(key, root) {
  const safe = assertSafeKey(key);
  const base = path.resolve(root || config.BACKUP_LOCAL_PATH);
  const full = path.resolve(base, safe);
  // The separator is part of the test: `startsWith(base)` alone accepts a
  // sibling directory whose name merely begins with the base.
  if (full !== base && !full.startsWith(base + path.sep)) {
    const e = new Error(`invalid backup key: ${safe}`);
    e.status = 400;
    throw e;
  }
  return full;
}

/**
 * Hash and count the bytes as they pass through.
 *
 * A TRANSFORM, NOT A PassThrough WITH A 'data' LISTENER — and this distinction
 * silently truncated every dump this service wrote.
 *
 *   Attaching a `data` handler puts a stream into FLOWING mode immediately.
 *   Anything emitted before a destination is connected is delivered to the
 *   handler and then DISCARDED. So the tap counted and hashed the entire
 *   1.8 MB dump while only the chunks that arrived after the writable attached
 *   ever reached the disk — a 192 KB file recorded as 1,821,846 bytes with a
 *   checksum of the full stream.
 *
 *   Every symptom pointed AWAY from the truth: `backup_run` said OK, the byte
 *   count was right, the checksum was of real data. Only a restore could find
 *   it, which is the entire argument for WS-B3.
 *
 * `_transform` cannot lose data: nothing flows until the pipeline connects a
 * destination, and backpressure is honoured throughout.
 */
class HashingCounter extends Transform {
  constructor() {
    super();
    this._hash = crypto.createHash("sha256");
    this.bytes = 0;
  }

  _transform(chunk, _enc, cb) {
    this.bytes += chunk.length;
    this._hash.update(chunk);
    cb(null, chunk);
  }

  result() {
    return { checksum: this._hash.digest("hex"), bytes: this.bytes };
  }
}

/* ── local driver ────────────────────────────────────────────────────────── */

const local = {
  async putStream(readable, key, c) {
    const full = localPath(key, c.localPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tap = new HashingCounter();
    // Write to a temp name and rename on success. A crash mid-dump otherwise
    // leaves a truncated file at the real key, which looks like a backup and
    // restores like a corruption — the single worst artefact this can produce.
    const tmp = `${full}.partial`;
    try {
      await pipeline(readable, tap, fsSync.createWriteStream(tmp));

      // VERIFY WHAT LANDED, before promoting it to the real key.
      //
      // The counter reports what passed THROUGH; `stat` reports what is
      // actually ON DISK. Trusting the first is how this service shipped
      // truncated dumps recorded as complete — the two disagreed and nothing
      // was asking. A short write from a full disk or a broken pipe produces
      // exactly the same silent outcome, so this stays as a permanent guard
      // rather than a fix for one bug.
      const st = await fs.stat(tmp);
      const counted = tap.result();
      if (st.size !== counted.bytes) {
        throw new Error(
          `short write: streamed ${counted.bytes} bytes but only ${st.size} reached disk — not promoting to "${key}"`,
        );
      }

      await fs.rename(tmp, full);
      return { key, location: `local:${key}`, ...counted };
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  },

  getStream(key, c) {
    return fsSync.createReadStream(localPath(key, c.localPath));
  },

  async exists(key, c) {
    try {
      await fs.access(localPath(key, c.localPath));
      return true;
    } catch {
      return false;
    }
  },

  async stat(key, c) {
    try {
      const st = await fs.stat(localPath(key, c.localPath));
      return { bytes: st.size, modified: st.mtime };
    } catch {
      return null;
    }
  },

  async list(prefix = "", c) {
    const base = path.resolve(c.localPath);
    const root = prefix ? localPath(prefix, c.localPath) : base;
    const out = [];
    async function walk(dir) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === "ENOENT") return; // nothing backed up yet
        throw err;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (!e.name.endsWith(".partial")) {
          const st = await fs.stat(full);
          out.push({
            key: path.relative(base, full).split(path.sep).join("/"),
            bytes: st.size,
            modified: st.mtime,
          });
        }
      }
    }
    await walk(root);
    return out;
  },

  async remove(key, c) {
    await fs.unlink(localPath(key, c.localPath)).catch((err) => {
      if (err.code !== "ENOENT") throw err;
    });
  },
};

/* ── s3 driver (lazy client) ─────────────────────────────────────────────── */

let _s3 = null;
let _s3Key = null;

/**
 * The client is cached against the CREDENTIALS it was built from, not just
 * "have we built one". A plain `if (_s3) return _s3` would keep serving a client
 * created with the old key after an operator rotates the bucket credential in
 * the console — backups would keep succeeding against the old account until the
 * process restarted, which is the silent half-broken state this whole move is
 * meant to remove.
 */
async function s3Client(c) {
  const s3c = c.s3;
  const identity = [s3c.endpoint, s3c.bucket, s3c.region, s3c.accessKey, s3c.secretKey, s3c.forcePathStyle].join("|");
  if (_s3 && _s3Key === identity) return _s3;

  const { S3Client } = require("@aws-sdk/client-s3");
  if (!s3c.bucket) {
    throw new Error("no backup bucket configured (driver=s3) — set it in Platform Console → Integrations → Backup storage");
  }
  _s3 = new S3Client({
    region: s3c.region,
    endpoint: s3c.endpoint || undefined,
    forcePathStyle: s3c.forcePathStyle,
    credentials:
      s3c.accessKey && s3c.secretKey
        ? { accessKeyId: s3c.accessKey, secretAccessKey: s3c.secretKey }
        : undefined, // fall back to the default credential chain (IAM role)
  });
  _s3Key = identity;
  return _s3;
}

const s3 = {
  async putStream(readable, key, c) {
    let Upload;
    try {
      ({ Upload } = require("@aws-sdk/lib-storage"));
    } catch {
      throw new Error(
        "BACKUP_DRIVER=s3 requires '@aws-sdk/lib-storage' (multipart upload for streamed dumps). Run: npm install @aws-sdk/lib-storage",
      );
    }
    const safe = assertSafeKey(key);
    const client = await s3Client(c);
    const tap = new HashingCounter();
    // Transform, and `pipe` only as the plumbing between two streams neither of
    // which is in flowing mode yet — see HashingCounter's header for the data
    // loss the previous 'data'-listener version caused here too.
    readable.pipe(tap);
    // `Upload` (multipart) rather than PutObjectCommand: PutObject needs a known
    // content length, and a dump stream has none until it ends. Multipart also
    // means a large dump is not held in memory.
    const up = new Upload({
      client,
      params: {
        Bucket: c.s3.bucket,
        Key: safe,
        Body: tap,
        ContentType: "application/octet-stream",
      },
    });
    await up.done();
    const counted = tap.result();

    // Same verification as the local driver: ask the STORE how big the object
    // is, rather than trusting what we believe we sent.
    try {
      const { HeadObjectCommand } = require("@aws-sdk/client-s3");
      const head = await client.send(
        new HeadObjectCommand({ Bucket: c.s3.bucket, Key: safe }),
      );
      if (Number(head.ContentLength) !== counted.bytes) {
        throw new Error(
          `short upload: streamed ${counted.bytes} bytes but the object is ${head.ContentLength}`,
        );
      }
    } catch (err) {
      // A verification that cannot run is not a pass. Surface it — the caller
      // records the run as FAILED rather than banking an unverified artefact.
      throw new Error(`could not verify the uploaded object "${safe}": ${err.message}`);
    }

    return {
      key: safe,
      location: `s3://${c.s3.bucket}/${safe}`,
      ...counted,
    };
  },

  getStream(key, c) {
    // Returns a promise for a stream; callers await via `openStream` below.
    return (async () => {
      const { GetObjectCommand } = require("@aws-sdk/client-s3");
      const client = await s3Client(c);
      const out = await client.send(
        new GetObjectCommand({ Bucket: c.s3.bucket, Key: assertSafeKey(key) }),
      );
      return out.Body;
    })();
  },

  async exists(key, c) {
    const { HeadObjectCommand } = require("@aws-sdk/client-s3");
    const client = await s3Client(c);
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: c.s3.bucket, Key: assertSafeKey(key) }),
      );
      return true;
    } catch {
      return false;
    }
  },

  async stat(key, c) {
    const { HeadObjectCommand } = require("@aws-sdk/client-s3");
    const client = await s3Client(c);
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: c.s3.bucket, Key: assertSafeKey(key) }),
      );
      return { bytes: Number(head.ContentLength), modified: head.LastModified };
    } catch {
      return null;
    }
  },

  async list(prefix = "", c) {
    const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
    const client = await s3Client(c);
    const out = [];
    let token;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: c.s3.bucket,
          Prefix: prefix || undefined,
          ContinuationToken: token,
        }),
      );
      for (const o of page.Contents || []) {
        out.push({ key: o.Key, bytes: o.Size, modified: o.LastModified });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  },

  async remove(key, c) {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const client = await s3Client(c);
    await client.send(
      new DeleteObjectCommand({ Bucket: c.s3.bucket, Key: assertSafeKey(key) }),
    );
  },
};

/* ── driver selection ────────────────────────────────────────────────────── */

/**
 * Pick the driver for THIS call.
 *
 * Previously a module-level constant. It is a function now because the driver
 * itself is configurable from the console: an operator who switches a
 * deployment from local disk to a bucket should not have to restart the API for
 * the next backup to land in the right place.
 */
function driverFor(c) {
  return c.driver === "s3" ? s3 : local;
}

/**
 * Every export resolves the config, then dispatches.
 *
 * The drivers below are unchanged in behaviour — same streaming, same hashing,
 * same short-write verification. All that moved is WHERE their settings come
 * from, and the fact that the answer can now change while the process runs.
 */
async function putStream(readable, key) {
  const c = await cfg();
  return driverFor(c).putStream(readable, key, c);
}

/** Open a readable stream for a key, normalising the two drivers' shapes. */
async function openStream(key) {
  const c = await cfg();
  return driverFor(c).getStream(key, c);
}

async function exists(key) {
  const c = await cfg();
  return driverFor(c).exists(key, c);
}

async function stat(key) {
  const c = await cfg();
  return driverFor(c).stat(key, c);
}

async function list(prefix = "") {
  const c = await cfg();
  return driverFor(c).list(prefix, c);
}

async function remove(key) {
  const c = await cfg();
  return driverFor(c).remove(key, c);
}

/** Which driver and destination are actually in force, and where that came from. */
async function describe() {
  const c = await cfg();
  return {
    driver: c.driver,
    source: c.source,
    destination: c.driver === "s3" ? `s3://${c.s3.bucket}` : c.localPath,
    // Presence only. The secret itself is never returned by anything here.
    credentials_set: c.driver === "s3" ? Boolean(c.s3.accessKey && c.s3.secretKey) : true,
  };
}

/**
 * Retention sweep (D4): keep every dump for the daily window, and keep Sunday's
 * for the weekly window beyond that. Both windows now come from the vault
 * (ops.tuning), falling back to env.
 *
 * Returns what it removed rather than removing silently — a retention job that
 * cannot say what it deleted is indistinguishable from one that deleted the
 * wrong thing.
 */
async function pruneRetention({
  prefix = "pg/",
  now = new Date(),
  // Injected rather than closed over. Retention is the one operation here that
  // DELETES, so it is the one that most needs to be testable without a live
  // bucket — and a function that reaches through a module-level closure cannot
  // be exercised at all without one. Defaults dispatch to the selected driver.
  list: listFn = list,
  remove: removeFn = remove,
  // Injectable for the same reason: a retention test should not need a vault.
  tuning = null,
} = {}) {
  const t = tuning || (await runtimeConfig.opsTuning());
  const dailyMs = Number(t.backupRetainDailyDays) * 86_400_000;
  const weeklyMs = Number(t.backupRetainWeeklyWeeks) * 7 * 86_400_000;
  const objects = await listFn(prefix);
  const removed = [];
  const kept = [];

  for (const o of objects) {
    const age = now.getTime() - new Date(o.modified).getTime();
    const isSunday = new Date(o.modified).getUTCDay() === 0;
    // Weekly retention is a SUPERSET of daily, so the Sunday test comes first:
    // a Sunday dump inside the daily window must not be evaluated against the
    // weekly window and dropped early.
    const keep = age <= dailyMs || (isSunday && age <= weeklyMs);
    if (keep) {
      kept.push(o.key);
      continue;
    }
    await removeFn(o.key);
    removed.push(o.key);
  }

  if (removed.length) {
    logger.info({ removed: removed.length, kept: kept.length, prefix }, "backup retention pruned");
  }
  return { removed, kept: kept.length };
}

module.exports = {
  putStream,
  openStream,
  exists,
  stat,
  list,
  remove,
  pruneRetention,
  assertSafeKey,
  describe,
  // `driver` was a constant read at import time. It is a function now because
  // the answer can change while the process runs — anything still treating it
  // as a string would silently compare against a function and always be wrong,
  // which is why it is renamed rather than quietly changed in place.
  currentDriver: async () => (await cfg()).driver,
};
