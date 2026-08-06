/**
 * File storage abstraction. Two interchangeable drivers behind a stable
 * interface, selected by STORAGE_DRIVER (config/env.js):
 *
 *   'local' (default) — filesystem under STORAGE_LOCAL_PATH, served by Express
 *                       at /media/<key> for public assets.
 *   's3'              — any S3-compatible object store (AWS S3, MinIO, Wasabi,
 *                       Backblaze B2, Cloudflare R2). Config: S3_ENDPOINT,
 *                       S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY,
 *                       S3_FORCE_PATH_STYLE, optional CDN_BASE_URL.
 *
 * Modules only ever call put/get/delete/publicUrl/signedUrl — swapping the
 * driver never touches a module.
 *
 * NOTE: the S3 driver lazily requires '@aws-sdk/client-s3' (and, for
 * signedUrl, '@aws-sdk/s3-request-presigner') so local deployments don't need
 * those packages installed. Install them when STORAGE_DRIVER=s3.
 *
 * Interface:
 *   put(buffer, { key, contentType })  → { key, public_url, size, content_type }
 *   get(key)                            → Buffer
 *   delete(key)                         → void
 *   publicUrl(key)                      → string
 *   signedUrl(key, ttlSeconds)          → Promise<string>  (temporary access)
 */

"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { config } = require("../config/env");
const { isPublicStorageKey } = require("../shared/http/media-guard");
const { AppError } = require("../utils/errors");

const DRIVER = config.STORAGE_DRIVER || "local";

/* ── shared ────────────────────────────────────────────────────────────── */

// S3 credentials are DEPLOY-WIDE and resolve from the platform_setting store
// ('storage'/'s3', root-admin managed) first, then env. Resolved config + the
// built client are cached; resetCache() drops both after a Platform Console
// change so new creds take effect without a restart.
let _s3cfg = null;
let _s3 = null;

function resetCache() {
  _s3 = null;
  _s3cfg = null;
}

/** Synchronous best-effort view (used by publicUrl); env until resolveS3 ran. */
function s3View() {
  const c = _s3cfg || {};
  return {
    endpoint: c.endpoint || config.S3_ENDPOINT || "",
    bucket: c.bucket || config.S3_BUCKET || "",
    cdnBaseUrl: c.cdnBaseUrl || config.CDN_BASE_URL || "",
  };
}

async function resolveS3() {
  if (_s3cfg) return _s3cfg;
  let value = {};
  let secret = null;
  try {
     
    const platformSettings = require("./platform/settings.service");
    const r = await platformSettings.resolve("storage", "s3");
    if (r) { value = r.value || {}; secret = r.secret; }
  } catch {
    // platform store unavailable (e.g. tests / no DB) → fall back to env
  }
  _s3cfg = {
    endpoint: value.endpoint || config.S3_ENDPOINT || "",
    bucket: value.bucket || config.S3_BUCKET || "",
    region: value.region || config.S3_REGION || "us-east-1",
    accessKey: value.access_key || config.S3_ACCESS_KEY || "",
    secretKey: secret || config.S3_SECRET_KEY || "",
    forcePathStyle: value.force_path_style !== undefined ? value.force_path_style : config.S3_FORCE_PATH_STYLE,
    cdnBaseUrl: value.cdn_base_url || config.CDN_BASE_URL || "",
  };
  return _s3cfg;
}

/**
 * The URL to persist for a stored object.
 *
 * REWRITTEN 2026-08-02. This used to return a direct path-style bucket URL under
 * `s3` for ANY key — including vault artefacts, since `pdf.service.renderAndStore`
 * passes every rendered PDF through here. Persisting that URL is precisely how a
 * confidential document acquires a shareable link that bypasses
 * `GET /documents/:id/download` and its `requirePermission`. It was the same hole
 * the flat `/media` mount had, one layer along, and it would have opened the day
 * the S3 driver was switched on.
 *
 * Now: **a private key never gets a direct object URL.** Everything resolves to
 * the app's own `/media/<key>`, which applies the allow-list (see
 * shared/http/media-guard.js) and, under s3, redirects a PERMITTED key to a
 * short-TTL presigned URL. Two consequences worth having:
 *   - the value is driver-independent, so a stored URL keeps working across a
 *     local→s3 migration (a bucket URL in the database would not), and
 *   - the bucket needs no public-read at all.
 *
 * CDN_BASE_URL is honoured only for public keys — caching a private artefact at
 * an edge would put it back outside the app's control.
 */
function publicUrl(key) {
  const v = s3View();
  if (v.cdnBaseUrl && isPublicStorageKey(key)) return `${v.cdnBaseUrl}/${key}`;
  return `/media/${key}`;
}

/* ── local driver ──────────────────────────────────────────────────────── */

/**
 * Storage keys are composed by CALLERS out of request data — an entity id from a
 * route parameter, a tenant slug, a document id — and then joined onto
 * STORAGE_LOCAL_PATH. `path.join(base, "../../etc/crontab")` resolves happily
 * outside the base, so a key that was never checked is a path traversal with a
 * file write on the end of it.
 *
 * Nothing was checking. Every caller was individually careful (uuids, hex,
 * fixed extensions) and one of them being careless is all it takes — so the
 * guard belongs HERE, at the one place every driver funnels through, not in
 * fifteen call sites that each have to remember.
 *
 * Two independent checks, because either alone has a gap:
 *   1. a charset allow-list — letters, digits, `_ - . /` — which rejects `..`
 *      by rejecting the traversal that needs it, plus null bytes, backslashes
 *      (Windows separators) and absolute paths;
 *   2. a resolved-path containment check, which is the actual invariant and
 *      holds even if the charset rule is later loosened.
 */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;

function assertSafeKey(key) {
  const k = key === null || key === undefined ? "" : String(key);
  if (!KEY_RE.test(k) || k.includes("..") || k.includes("//")) {
    throw new AppError("BAD_STORAGE_KEY", "Invalid storage key", 400);
  }
  return k;
}

/** The absolute path for a key, proven to sit inside the storage root. */
function localPath(key) {
  const safe = assertSafeKey(key);
  const base = path.resolve(config.STORAGE_LOCAL_PATH);
  const full = path.resolve(base, safe);
  // `startsWith(base)` alone would accept a sibling directory whose name merely
  // begins with the base ("/data/storage-evil" vs "/data/storage"), so the
  // separator is part of the test.
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new AppError("BAD_STORAGE_KEY", "Invalid storage key", 400);
  }
  return full;
}

const local = {
  async put(buffer, { key, contentType }) {
    const finalKey = assertSafeKey(key || crypto.randomBytes(16).toString("hex"));
    const filePath = localPath(finalKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return { key: finalKey, public_url: publicUrl(finalKey), size: buffer.length, content_type: contentType };
  },
  async get(key) {
    return fs.readFile(localPath(key));
  },
  async delete(key) {
    await fs.unlink(localPath(key));
  },
  async signedUrl(key) {
    // No signing for the local driver — it is served by the /media route (public
    // assets) or gated by an authenticated download route (sensitive docs).
    return publicUrl(key);
  },
};

/* ── s3 driver (lazy client) ───────────────────────────────────────────── */

async function s3Client() {
  if (_s3) return _s3;
   
  const { S3Client } = require("@aws-sdk/client-s3");
  const cfg = await resolveS3();
  if (!cfg.bucket) throw new Error("S3 bucket is not configured (Platform Console → Integrations, or S3_BUCKET)");
  _s3 = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.forcePathStyle,
    credentials:
      cfg.accessKey && cfg.secretKey
        ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
        : undefined, // fall back to the AWS default credential chain (IAM role, env)
  });
  return _s3;
}

async function streamToBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const s3 = {
  async put(buffer, { key, contentType }) {
     
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const cfg = await resolveS3();
    const client = await s3Client();
    // Same key discipline as the local driver: one rule, both back-ends, so a
    // deployment does not become traversable by switching STORAGE_DRIVER.
    const finalKey = assertSafeKey(key || crypto.randomBytes(16).toString("hex"));
    await client.send(
      new PutObjectCommand({ Bucket: cfg.bucket, Key: finalKey, Body: buffer, ContentType: contentType }),
    );
    return { key: finalKey, public_url: publicUrl(finalKey), size: buffer.length, content_type: contentType };
  },
  async get(key) {
     
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const cfg = await resolveS3();
    const client = await s3Client();
    const out = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return streamToBuffer(out.Body);
  },
  async delete(key) {
     
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const cfg = await resolveS3();
    const client = await s3Client();
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  },
  async signedUrl(key, ttlSeconds = 900) {
     
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
     
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    const cfg = await resolveS3();
    const client = await s3Client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  },
};

/* ── driver selection ──────────────────────────────────────────────────── */

const impl = DRIVER === "s3" ? s3 : local;

module.exports = {
  put: impl.put,
  get: impl.get,
  delete: impl.delete,
  signedUrl: impl.signedUrl,
  publicUrl,
  driver: DRIVER,
  resetCache,
};
