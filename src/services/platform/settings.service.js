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
  // Certified signatures (SIGNATURE_ENGINEERING_GUIDE §7.2, §7.5). The API
  // key is the SECRET (a bearer credential — anyone holding it can spend the
  // account's envelope allowance); the optional base_url is plain config, for
  // a provider sandbox that moves the API. The probe is GET /me, which also
  // says WHICH account the key is for — the one thing a wrong key's error
  // never says.
  //
  // The PRICING row (`qes.pricing`: unit_cost, currency, monthly_quota) has
  // no SPEC entry on purpose — there is no connectivity to test, and a probe
  // for a number would pass or fail on a guess. It is still settable through
  // the same console route, which does not consult the SPEC.
  "qes.signwell": { probe: probes.signwell, cfg: (value, secret) => ({ api_key: secret, base_url: value && value.base_url }) },
  // Microsoft Entra app for mailbox OAuth. Deploy-wide on purpose: ONE
  // multi-tenant registration serves every tenant, so the credential belongs
  // here beside the other infra secrets rather than in each tenant's vault.
  //
  // The client secret is the SECRET — it is a bearer credential, and it also
  // EXPIRES, which is the failure this row exists to make visible. When it
  // lapses every connected Microsoft mailbox stops syncing at once and looks
  // like a product bug; a Test button that says so in one click is the
  // difference between an afternoon and a minute.
  "mail.microsoft_graph": {
    probe: probes.microsoftGraph,
    cfg: (value, secret) => ({
      client_id: value.client_id,
      directory_id: value.directory_id,
      client_secret: secret,
    }),
  },
  // The call relay, API side (FN-2 follow-up). The probe takes no cfg: it
  // exercises what the runtime config has in force, which is the only way to
  // catch the drift this panel can create — see settings.probes.turn.
  //
  // No secret. TURN_CREDENTIAL_SECRET stays on the host because the API signs
  // with it and coturn verifies with it; a value only one of them can read
  // puts the two out of step and refuses every call's credential. That is the
  // pooler-password case named in runtime-config.service.js.
  "network.turn": { probe: probes.turn, cfg: () => ({}) },
};
const specKey = (section, key) => section + "." + key;

/**
 * The two registries above, as Maps, for lookup by a name off the URL.
 *
 * `/settings/:section/:key` puts two request parameters into an id, and both
 * callers INVOKE whatever the lookup returns. Indexing an object literal
 * with that id reaches Object.prototype — `constructor`, `toString`,
 * `valueOf` are inherited members, so a lookup finding nothing of ours can
 * still hand back a function.
 *
 * A Map has no prototype chain to walk and no inherited string keys, so the
 * dynamic property read is gone rather than guarded. (An own-property test
 * on the literal is equally safe at runtime and was the first fix here, but
 * it leaves the read in place — which is the shape itself, and what CodeQL's
 * js/unvalidated-dynamic-method-call is about.)
 *
 * The literals stay the source of truth: they are what a reader edits when
 * adding a credential, and deriving these once at load keeps the two from
 * drifting.
 */
const SPEC_BY_ID = new Map(Object.entries(SPEC));

function lookupSpec(registry, section, key) {
  const id = specKey(section, key);
  // Compared, not indexed. `registry.get(id)` is still a lookup keyed by
  // request input, and both callers INVOKE what it returns — the shape
  // js/unvalidated-dynamic-method-call is about, which neither an
  // own-property test nor the Map removed. Walking the known ids and
  // returning only inside an equality branch makes the result provably one
  // of this file's own entries: there is no key the caller supplies, only a
  // name it can match. Ten entries, once per settings write or test.
  for (const [knownId, entry] of registry) {
    if (knownId === id) return entry;
  }
  return null;
}

/**
 * Per-setting shape checks for the values that leave this deployment.
 *
 * `platformSetting` in the validator accepts any object, which is right for a
 * store this generic. `network.turn` needs more than that: its values are
 * assembled into the `iceServers` URLs handed to every caller's browser, so a
 * stray space or a scheme pasted into the host field becomes an ICE server
 * nobody can reach, on every call, with the failure surfacing as "calls do
 * not connect" rather than as anything about this field.
 */
const VALUE_RULES = {
  "network.turn": (v) => {
    const host = v.host === undefined ? "" : String(v.host).trim();
    if (host && !/^[A-Za-z0-9.-]+$/.test(host)) {
      return "host must be a bare hostname or IP — no scheme, port or path (e.g. turn.example.com)";
    }
    if (v.port_tcp !== undefined && v.port_tcp !== null && v.port_tcp !== "") {
      const n = Number(v.port_tcp);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return "port_tcp must be a whole number between 1 and 65535";
    }
    if (v.transports !== undefined && v.transports !== null && v.transports !== "") {
      const parts = String(v.transports).split(",").map((t) => t.trim()).filter(Boolean);
      if (!parts.length || parts.some((t) => t !== "udp" && t !== "tcp")) {
        return "transports must be udp, tcp, or udp,tcp";
      }
    }
    if (v.stun_urls) {
      const bad = String(v.stun_urls).split(",").map((u) => u.trim()).filter(Boolean)
        .filter((u) => !/^stuns?:/.test(u));
      if (bad.length) return `stun_urls entries must start with stun: or stuns: (got ${bad[0]})`;
    }
    return null;
  },
};

const VALUE_RULES_BY_ID = new Map(Object.entries(VALUE_RULES));

/** Throws 422 when a known setting's value is malformed. */
function assertValueShape(section, key, value) {
  const rule = lookupSpec(VALUE_RULES_BY_ID, section, key);
  if (!rule) return;
  const problem = rule(value || {});
  if (problem) {
    const e = new Error(problem);
    e.status = 422;
    throw e;
  }
}

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
  assertValueShape(section, key, value);
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
    /* @silent:teardown — the cache is an optimisation; losing the invalidation
       costs one TTL, and a save must never fail on its own bookkeeping. */
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
  const spec = lookupSpec(SPEC_BY_ID, section, key);
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
      // SMTP probes throw a classified error (smtp-error.map) so the console
      // can render the matching fix guide; other probes simply omit the key.
      code: err.code || undefined,
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

module.exports = {
  // The value rules, for the suite that holds the iceServers shapes.
  _test: { valueRules: VALUE_RULES, lookupSpec, spec: SPEC_BY_ID, valueRulesById: VALUE_RULES_BY_ID }, list, get, put, resolve, test, generateVapid };
