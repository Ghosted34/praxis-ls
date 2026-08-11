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
 * Cache decrypted credentials briefly.
 *
 * Pool creation is already rare (one per tenant per process, cached in the
 * registry's LRU), but pool EVICTION under `TENANT_POOL_CACHE_MAX` means a busy
 * fleet can re-create pools steadily, and each re-creation would otherwise cost
 * a platform-DB round trip plus a decrypt. The TTL is short so a rotation takes
 * effect without a restart; `invalidate()` makes it immediate.
 */
const CRED_TTL_MS = Number(config.TENANT_DB_CRED_TTL_MS || 60_000);
const credCache = new Map(); // slug -> { cred, expires }

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
  // always connected as the deploy-wide role. Prefer it when present.
  const fallback = {
    user: meta.app_role || config.TENANT_DB_APP_ROLE || config.DB_USER,
    password: config.DB_PASSWORD,
    source: "shared",
  };

  const slug = meta.slug;
  if (!slug) return fallback;

  const hit = credCache.get(slug);
  if (hit && hit.expires > Date.now()) return hit.cred;

  const ref = parseSecretRef(meta.secret_ref);
  if (!ref) return fallback;

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

  const cred = { user: fallback.user, password, source: "vault" };
  credCache.set(slug, { cred, expires: Date.now() + CRED_TTL_MS });
  return cred;
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
  if (slug) credCache.delete(String(slug).toLowerCase());
  else credCache.clear();
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
  hasOwnCredential,
  parseSecretRef,
  SECTION,
};
