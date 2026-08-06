/**
 * Platform-settings connectivity probes — live, read-only checks for the
 * deploy-wide integration credentials (settings.service.test). Each takes the
 * resolved config (non-secret value merged with the decrypted secret), performs
 * one side-effect-free call, returns metadata on success and THROWS on failure.
 */
"use strict";

const axios = require("axios");

/** S3 / S3-compatible: HeadBucket verifies creds authenticate + bucket exists. */
async function s3(cfg) {
  if (!cfg.bucket) throw new Error("no bucket configured");
   
  const { S3Client, HeadBucketCommand } = require("@aws-sdk/client-s3");
  const client = new S3Client({
    region: cfg.region || "us-east-1",
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.force_path_style !== false,
    credentials:
      cfg.access_key && cfg.secret_key
        ? { accessKeyId: cfg.access_key, secretAccessKey: cfg.secret_key }
        : undefined,
  });
  await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  return { bucket: cfg.bucket, endpoint: cfg.endpoint || "aws-default" };
}

/** Geoapify: a reverse geocode round-trip. A bad key returns 401 (axios throws). */
async function geoapify(cfg) {
  const { data } = await axios.get("https://api.geoapify.com/v1/geocode/reverse", {
    params: { lat: 48.8566, lon: 2.3522, format: "json", limit: 1, apiKey: cfg.api_key },
    timeout: 8000,
  });
  return { results: data && Array.isArray(data.results) ? data.results.length : 0 };
}

/**
 * VAPID keys can't be exercised without a live browser subscription, so this
 * validates the keypair is present and well-formed (base64url, P-256 sizes:
 * 65-byte public → 87 chars, 32-byte private → 43 chars, unpadded).
 */
function vapid(cfg) {
  const pub = cfg.public_key || "";
  const priv = cfg.private_key || "";
  const b64url = /^[A-Za-z0-9_-]+$/;
  if (!pub || !priv) throw new Error("VAPID keypair not set — generate it first");
  if (!b64url.test(pub) || pub.length < 80) throw new Error("public key looks malformed");
  if (!b64url.test(priv) || priv.length < 40) throw new Error("private key looks malformed");
  return { public_key_len: pub.length, subject: cfg.subject || null };
}

module.exports = { s3, geoapify, vapid };
