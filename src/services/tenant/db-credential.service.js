/**
 * WS-S2 — per-tenant database credentials.
 *
 * Tenant isolation is the database boundary (one physical Postgres DB per
 * tenant), but until now every tenant pool authenticated with the SAME shared
 * `config.DB_PASSWORD` and one app role. The isolation was therefore physical
 * but not credential-level: a leaked app password reached every tenant DB.
 *
 * `platform.tenant_database.secret_ref` has always recorded WHERE that tenant's
 * credential lives (`vault:tenant/<slug>/db-password`, written by
 * `provisionTenant()`); nothing ever read it. This module is that read path.
 *
 * WHY THE PLATFORM VAULT, NOT THE TENANT VAULT
 * --------------------------------------------
 * Per-tenant secrets normally live in the tenant's own `integration_secret`
 * vault (`settingService.readSecret`). A DB password cannot: reading it would
 * require a connection to the very database the password opens. So the tenant DB
 * credential is the one per-tenant secret that must live in the PLATFORM vault
 * (`platform.platform_setting`, section `tenant_db`, key = slug), encrypted with
 * the same AES-256-GCM `ENCRYPTION_KEY` as every other secret. It is still never
 * stored on a row in plaintext, and never in the tenant DB.
 *
 * ROLLOUT SAFETY
 * --------------
 * Resolution is **vault → shared fallback**. A tenant with no stored credential
 * resolves to `config.DB_PASSWORD` exactly as before, so this change is inert
 * until a credential is provisioned per tenant. That makes the backfill
 * incremental: rotate tenants in one at a time, and a tenant that has not been
 * rotated keeps working.
 */
"use strict";

const platformDb = require("../platform/db");
const encryption = require("../encryption.service");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

/** Platform-settings coordinates for a tenant's DB credential. */
const SECTION = "tenant_db";

/**
 * Cache decrypted credentials.
 *
 * INCIDENT 2026-08-12. The original TTL was 60s and the cache was read-through:
 * on expiry the NEXT tenant request paid a platform-DB round trip while holding
 * the registry's in-flight guard, so every concurrent request for that tenant
 * queued behind it. When the platform DB was saturated by the Kaizen ops sweeps,
 * that queue exceeded `TENANT_POOL_ACQUIRE_TIMEOUT_MS` and tenant logins failed.
 *
 * Two changes remove the platform DB from the tenant's critical path:
 *
 *   1. A LONG ttl (default 1h). A rotation still takes effect without a restart
 *      because `putCredential()` calls `invalidate()`, which is immediate; the
 *      TTL is only the backstop for a rotation performed outside this process.
 *   2. A STALE-WHILE-REVALIDATE read. An expired entry is served immediately and
 *      refreshed in the background, so expiry costs a tenant request nothing.
 *
 * A cold entry (no cached value at all) still has to be read inline — but that
 * read is now bounded by `LOOKUP_TIMEOUT_MS` and degrades to the shared
 * credential rather than waiting.
 */
const CRED_TTL_MS = Number(config.TENANT_DB_CRED_TTL_MS || 3_600_000);

/**
 * How long a cold credential lookup may block a tenant connection.
 *
 * The docblock on `resolveCredential` already promised that any failure degrades
 * to the shared credential "because the alternative is taking a tenant offline
 * over a secret-store hiccup". It degraded on ERROR but not on SLOWNESS, and
 * slowness is the failure mode that actually occurred. This is that promise made
 * true: past this bound the lookup is abandoned, the shared credential is used,
 * and the vault read continues in the background to populate the cache.
 */
const LOOKUP_TIMEOUT_MS = Number(config.TENANT_DB_CRED_TIMEOUT_MS || 500);

const credCache = new Map(); // slug -> { cred, expires }
const refreshing = new Set(); // slugs with a background refresh in flight

/**
 * Parse a `secret_ref` into vault coordinates.
 *
 * Supported schemes:
 *   `vault:tenant/<slug>/db-password`  → platform_setting (tenant_db, <slug>)
 *   `env:SOME_VAR`                     → process.env.SOME_VAR (self-hosted escape hatch)
 *
 * Anything unrecognised returns null, which falls back to the shared credential
 * rather than failing the request — an unparseable ref must not take a tenant
 * offline.
 */
function parseSecretRef(ref) {
  const s = String(ref || "").trim();
  if (!s) return null;
  const vault = /^vault:tenant\/([a-z0-9_-]+)\/db-password$/i.exec(s);
  if (vault) return { kind: "vault", slug: vault[1].toLowerCase() };
  const env = /^env:([A-Z0-9_]+)$/i.exec(s);
  if (env) return { kind: "env", varName: env[1] };
  return null;
}

/** Read + decrypt a tenant's stored DB password, or null when none is set. */
async function readVaultSecret(slug) {
  const { rows } = await platformDb.query(
    "SELECT secret_enc FROM platform.platform_setting WHERE section=$1 AND key=$2",
    [SECTION, slug],
  );
  const row = rows[0];
  if (!row || !row.secret_enc) return null;
  try {
    return encryption.decrypt(row.secret_enc);
  } catch (err) {
    // A credential we cannot decrypt is a real problem (wrong ENCRYPTION_KEY,
    // corrupted ciphertext) — but falling back to the shared password keeps the
    // tenant serving while it is investigated. Loud, not fatal.
    logger.error({ err, slug }, "tenant DB credential failed to decrypt — falling back to shared credential");
    return null;
  }
}

/**
 * Resolve the `{ user, password, source }` a tenant pool should authenticate
 * with.
 *
 * `meta` is a registry row (see `resolveByHost` / `resolveBySlug`) and must
 * carry `slug`, `app_role` and `secret_ref`.
 *
 * Never throws: any failure degrades to the shared credential, because the
 * alternative is taking a tenant offline over a secret-store hiccup.
 */
async function resolveCredential(meta) {
  // `app_role` is the least-privilege role recorded per tenant DB at provision
  // time. It was selected by the registry queries but never used — the pool
  // always connected as the deploy-wide role.
  //
  // INCIDENT 2026-08-12 — `app_role` is only correct alongside that tenant's OWN
  // password. Pairing it with the shared one authenticates as a role that either
  // does not exist or has a different password, so the shared fallback must keep
  // using the deploy-wide role. `app_role` is used only on the vault path below.
  const fallback = {
    user: config.TENANT_DB_APP_ROLE || config.DB_USER,
    password: config.DB_PASSWORD,
    source: "shared",
  };

  const slug = meta.slug;
  if (!slug) return fallback;

  const now = Date.now();
  const hit = credCache.get(slug);
  if (hit) {
    // Stale-while-revalidate: an expired entry is still correct until a rotation
    // happens, and a rotation performed through this process invalidates it
    // outright. Serving it costs nothing and refreshing it costs the background.
    if (hit.expires <= now) void refreshInBackground(meta, slug);
    return hit.cred;
  }

  const ref = parseSecretRef(meta.secret_ref);
  if (!ref) return fallback;

  // Cold read — bounded. Past LOOKUP_TIMEOUT_MS the tenant is served on the
  // shared credential and the lookup finishes in the background, so a slow
  // platform DB degrades this tenant's ISOLATION for one pool creation rather
  // than degrading its AVAILABILITY to zero.
  const lookup = loadCredential(meta, ref, fallback, slug);
  const timed = await withTimeout(lookup, LOOKUP_TIMEOUT_MS);
  if (timed.timedOut) {
    logger.warn(
      { slug, timeoutMs: LOOKUP_TIMEOUT_MS },
      "tenant DB credential lookup exceeded its budget — serving on the shared credential while it completes",
    );
    return fallback;
  }
  return timed.value;
}

/** The actual vault read + cache write, shared by the cold and background paths. */
async function loadCredential(meta, ref, fallback, slug) {
  let password = null;
  try {
    if (ref.kind === "vault") password = await readVaultSecret(ref.slug);
    else if (ref.kind === "env") password = process.env[ref.varName] || null;
  } catch (err) {
    logger.error({ err, slug }, "tenant DB credential lookup failed — falling back to shared credential");
    return fallback;
  }

  // No credential provisioned yet: this tenant has not been rotated. Expected
  // during backfill, so it is not an error.
  if (!password) return fallback;

  // The per-tenant role and the per-tenant password are one unit — see the note
  // on `fallback` above. They are only ever used together, here.
  const cred = {
    user: meta.app_role || fallback.user,
    password,
    source: "vault",
  };
  credCache.set(slug, { cred, expires: Date.now() + CRED_TTL_MS });
  return cred;
}

/**
 * Refresh a stale entry without anyone waiting on it.
 *
 * De-duplicated per slug: a fleet-wide expiry must not turn into one platform-DB
 * query per concurrent request, which is the stampede the old read-through cache
 * produced under load.
 */
async function refreshInBackground(meta, slug) {
  if (refreshing.has(slug)) return;
  const ref = parseSecretRef(meta.secret_ref);
  if (!ref) return;
  refreshing.add(slug);
  try {
    const fallback = {
      user: config.TENANT_DB_APP_ROLE || config.DB_USER,
      password: config.DB_PASSWORD,
      source: "shared",
    };
    await loadCredential(meta, ref, fallback, slug);
  } catch (err) {
    logger.warn({ err, slug }, "background credential refresh failed — the cached credential stays in use");
  } finally {
    refreshing.delete(slug);
  }
}

/**
 * Resolve `p` or give up after `ms`.
 *
 * The promise is NOT cancelled on timeout — it keeps running and populates the
 * cache, so the next request benefits from the work this one refused to wait for.
 */
function withTimeout(p, ms) {
  let timer;
  const bail = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([
    p.then((value) => ({ timedOut: false, value })),
    bail,
  ]).finally(() => clearTimeout(timer));
}

/**
 * Store (or rotate) a tenant's DB password in the platform vault.
 *
 * This writes the secret only — creating the Postgres role and granting it on
 * the tenant database is the caller's job (see `provisioning.service.js`), so
 * that the credential is never in the vault describing a role that does not
 * exist.
 */
async function putCredential(slug, password, actor = null) {
  if (typeof password !== "string" || !password || password.length > 4000) {
    const e = new Error("tenant DB password must be a string of 1–4000 characters");
    e.status = 422;
    throw e;
  }
  const secretEnc = encryption.encrypt(password);
  await platformDb.query(
    `INSERT INTO platform.platform_setting (section, key, value, secret_enc, last4, updated_by)
       VALUES ($1,$2,'{}'::jsonb,$3,$4,$5)
     ON CONFLICT (section, key) DO UPDATE
       SET secret_enc = EXCLUDED.secret_enc, last4 = EXCLUDED.last4,
           version = platform.platform_setting.version + 1,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [SECTION, String(slug).toLowerCase(), secretEnc, password.slice(-4), actor],
  );
  invalidate(slug);
}

/** Drop a cached credential so the next pool creation re-reads it (rotation). */
function invalidate(slug) {
  if (slug) {
    credCache.delete(String(slug).toLowerCase());
    refreshing.delete(String(slug).toLowerCase());
  } else {
    credCache.clear();
    refreshing.clear();
  }
}

/**
 * Mark a cached entry stale without deleting it — the state a TTL expiry
 * produces, reachable in a test without waiting out TENANT_DB_CRED_TTL_MS.
 *
 * Exported because stale-while-revalidate is the behaviour that keeps the
 * platform DB off the tenant's critical path, and behaviour that only shows up
 * under load is behaviour that gets refactored away unless a test pins it.
 * `invalidate()` cannot stand in: it removes the entry, which is the rotation
 * path, not the expiry path.
 */
function _expireForTest(slug) {
  const key = String(slug).toLowerCase();
  const hit = credCache.get(key);
  if (hit) hit.expires = 0;
}

/** Whether a tenant has its own credential provisioned (for the health view). */
async function hasOwnCredential(slug) {
  const { rows } = await platformDb.query(
    "SELECT 1 FROM platform.platform_setting WHERE section=$1 AND key=$2 AND secret_enc IS NOT NULL",
    [SECTION, String(slug).toLowerCase()],
  );
  return rows.length > 0;
}

module.exports = {
  resolveCredential,
  putCredential,
  invalidate,
  _expireForTest,
  hasOwnCredential,
  parseSecretRef,
  SECTION,
};
