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

const DRIVER = config.STORAGE_DRIVER || "local";

/* ── shared ────────────────────────────────────────────────────────────── */

function publicUrl(key) {
  if (config.CDN_BASE_URL) return `${config.CDN_BASE_URL}/${key}`;
  if (DRIVER === "s3") {
    // Path-style object URL against the configured endpoint. Only resolvable if
    // the bucket/object is publicly readable; prefer CDN_BASE_URL or signedUrl.
    const base = (config.S3_ENDPOINT || "").replace(/\/+$/, "");
    return base ? `${base}/${config.S3_BUCKET}/${key}` : `/media/${key}`;
  }
  return `/media/${key}`;
}

/* ── local driver ──────────────────────────────────────────────────────── */

const local = {
  async put(buffer, { key, contentType }) {
    const finalKey = key || crypto.randomBytes(16).toString("hex");
    const filePath = path.join(config.STORAGE_LOCAL_PATH, finalKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return { key: finalKey, public_url: publicUrl(finalKey), size: buffer.length, content_type: contentType };
  },
  async get(key) {
    return fs.readFile(path.join(config.STORAGE_LOCAL_PATH, key));
  },
  async delete(key) {
    await fs.unlink(path.join(config.STORAGE_LOCAL_PATH, key));
  },
  async signedUrl(key) {
    // No signing for the local driver — it is served by the /media route (public
    // assets) or gated by an authenticated download route (sensitive docs).
    return publicUrl(key);
  },
};

/* ── s3 driver (lazy client) ───────────────────────────────────────────── */

let _s3 = null;
function s3Client() {
  if (_s3) return _s3;
  // eslint-disable-next-line global-require
  const { S3Client } = require("@aws-sdk/client-s3");
  if (!config.S3_BUCKET) throw new Error("S3_BUCKET is not configured");
  _s3 = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT || undefined,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials:
      config.S3_ACCESS_KEY && config.S3_SECRET_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
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
    // eslint-disable-next-line global-require
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const finalKey = key || crypto.randomBytes(16).toString("hex");
    await s3Client().send(
      new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: finalKey, Body: buffer, ContentType: contentType }),
    );
    return { key: finalKey, public_url: publicUrl(finalKey), size: buffer.length, content_type: contentType };
  },
  async get(key) {
    // eslint-disable-next-line global-require
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const out = await s3Client().send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    return streamToBuffer(out.Body);
  },
  async delete(key) {
    // eslint-disable-next-line global-require
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    await s3Client().send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  },
  async signedUrl(key, ttlSeconds = 900) {
    // eslint-disable-next-line global-require
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    // eslint-disable-next-line global-require
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    return getSignedUrl(s3Client(), new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), {
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
};
