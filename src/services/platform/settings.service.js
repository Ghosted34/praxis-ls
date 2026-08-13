/**
 * Platform settings (deploy-wide integrations) — the root-admin store for infra
 * credentials shared by ALL tenants: object storage (S3), geocoding (Geoapify)
 * and Web-Push (VAPID). Set + tested in the Platform Console; consumed by
 * storage.service / geoapify.service / push.service.
 *
 * Secrets are AES-256-GCM encrypted at rest (encryption.service, same key as
 * tenant secrets) and NEVER returned over HTTP — reads yield presence + last4.
 * `resolve()` is INTERNAL (returns the decrypted secret for a consumer/probe)
 * and must never be wired to a route.
 */
"use strict";

const platformDb = require("./db");
const probes = require("./settings.probes");
const encryption = require("../encryption.service");

// (section.key) → probe + how to assemble the probe/consumer cfg from the stored
// non-secret `value` and the decrypted secret. Adding a row here makes a new
// platform credential settable + testable.
const SPEC = {
  "storage.s3": { probe: probes.s3, cfg: (value, secret) => ({ ...value, secret_key: secret }) },
  "geocoding.geoapify": { probe: probes.geoapify, cfg: (value, secret) => ({ ...value, api_key: secret }) },
  "push.vapid": { probe: probes.vapid, cfg: (value, secret) => ({ public_key: value.public_key, private_key: secret, subject: value.subject }) },
  // System-email fallback sender. value = non-secret config incl. SMTP host/user;
  // the SMTP password is the encrypted `secret`. Probe: nodemailer verify().
  "mail.fallback": { probe: probes.smtp, cfg: (value, secret) => ({ smtp_host: value.smtp_host, smtp_port: value.smtp_port, smtp_user: value.smtp_user, smtp_secure: value.smtp_secure, smtp_pass: secret }) },
  // WS-ER1 — ops alert channels. The URL is the SECRET, not the value: a Slack
  // or Teams incoming webhook is a bearer credential (anyone holding it can
  // post as the integration), so it is encrypted and read back as last4 only,
  // exactly like an API key.
  //
  // Two keys rather than one row with two fields, so `page` can be tested
  // independently — the noisy channel and the wake-someone channel are the two
  // most important things to verify separately, and a single test that only
  // exercised one of them would be the more dangerous half going unchecked.
  "alerts.default": { probe: probes.alertWebhook, cfg: (value, secret) => ({ url: secret, ...value }) },
  "alerts.page": { probe: probes.alertWebhook, cfg: (value, secret) => ({ url: secret, ...value }) },
  // The address is in `value`, not `secret`: a webhook URL is a bearer
  // credential and is encrypted; an address is not, and hiding it would mean
  // nobody can see where alerts are being sent.
  "alerts.email": { probe: probes.alertEmail, cfg: (value) => ({ to: value.to }) },
  // WS-B1 — where backups are written. The probe takes no arguments: it asks
  // the storage service what is in force and exercises THAT, so the test proves
  // the configuration the backup job will actually use rather than a copy of it
  // reconstructed here. Testing a reconstruction is how a test passes against
  // settings nothing else reads.
  "storage.backup": { probe: probes.backupStorage, cfg: () => ({}) },
};
const specKey = (section, key) => section + "." + key;

/** Public, redacted row shape (no ciphertext / plaintext). */
function redact(row) {
  if (!row) return null;
  return {
    section: row.section,
    key: row.key,
    value: row.value || {},
    secret_set: Boolean(row.secret_enc),
    last4: row.last4 || null,
    version: row.version,
    updated_at: row.updated_at,
  };
}

async function getRow(section, key) {
  const { rows } = await platformDb.query(
    "SELECT * FROM platform.platform_setting WHERE section=$1 AND key=$2",
    [section, key],
  );
  return rows[0] || null;
}

/** All platform settings, redacted. */
async function list() {
  const { rows } = await platformDb.query(
    "SELECT * FROM platform.platform_setting ORDER BY section, key",
  );
  return rows.map(redact);
}

async function get(section, key) {
  return redact(await getRow(section, key));
}

/**
 * Upsert a setting. `value` (non-secret) is REPLACED; `secret` is encrypted when
 * provided and PRESERVED when omitted (so editing the bucket doesn't wipe the
 * key). Returns the redacted row.
 */
async function put({ section, key, value = {}, secret, actor = null }) {
  const existing = await getRow(section, key);
  let secretEnc = existing ? existing.secret_enc : null;
  let last4 = existing ? existing.last4 : null;
  if (secret !== undefined && secret !== null && secret !== "") {
    if (typeof secret !== "string" || secret.length > 4000) {
      const e = new Error("secret must be a string of 1–4000 characters");
      e.status = 422;
      throw e;
    }
    secretEnc = encryption.encrypt(secret);
    last4 = secret.slice(-4);
  }
  const { rows } = await platformDb.query(
    `INSERT INTO platform.platform_setting (section, key, value, secret_enc, last4, updated_by)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6)
     ON CONFLICT (section, key) DO UPDATE
       SET value = EXCLUDED.value, secret_enc = EXCLUDED.secret_enc, last4 = EXCLUDED.last4,
           version = platform.platform_setting.version + 1, updated_by = EXCLUDED.updated_by,
           updated_at = now()
     RETURNING *`,
    [section, key, JSON.stringify(value || {}), secretEnc, last4, actor],
  );

  // Drop the runtime-config cache so a change takes effect on the next read
  // rather than after the TTL. Without this an operator saves a new bucket key,
  // presses Test, and the probe exercises the OLD one for up to half a minute —
  // which is the most confusing possible moment for a stale read.
  //
  // Required lazily and guarded: settings.service is loaded very early, and a
  // cache invalidation must never be the thing that fails a save.
  try {
    require("./runtime-config.service").invalidate();
  } catch {
    /* the cache is an optimisation; losing the invalidation costs one TTL */
  }

  return redact(rows[0]);
}

/** INTERNAL — decrypted { value, secret } for a consumer/probe, or null. */
async function resolve(section, key) {
  const row = await getRow(section, key);
  if (!row) return null;
  return {
    value: row.value || {},
    secret: row.secret_enc ? encryption.decrypt(row.secret_enc) : null,
  };
}

/** Run the provider's live probe against the stored credential. Never throws. */
async function test(section, key) {
  const spec = SPEC[specKey(section, key)];
  if (!spec) return { ok: false, error: "no test available for " + section + "." + key };
  const resolved = await resolve(section, key);
  if (!resolved) return { ok: false, error: "not configured" };
  try {
    const meta = await spec.probe(spec.cfg(resolved.value, resolved.secret));
    return { ok: true, section, key, ...meta };
  } catch (err) {
    const r = err.response;
    return {
      ok: false,
      section,
      key,
      status: (r && r.status) || err.statusCode || err.$metadata?.httpStatusCode,
      error: (r && r.data && (r.data.error?.message || r.data.message)) || err.message,
    };
  }
}

/**
 * Generate a fresh VAPID keypair (web-push) and store it: public key + subject
 * in `value`, private key encrypted. Returns the public half only.
 */
async function generateVapid({ subject, actor = null } = {}) {
   
  const webpush = require("web-push");
  const keys = webpush.generateVAPIDKeys();
  const subj = subject || "mailto:admin@praxisls.com";
  await put({ section: "push", key: "vapid", value: { public_key: keys.publicKey, subject: subj }, secret: keys.privateKey, actor });
  return { public_key: keys.publicKey, subject: subj };
}

module.exports = { list, get, put, resolve, test, generateVapid };
