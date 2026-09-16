/**
 * Settings hub (MOD-70) — the tenant self-config surface (numbering schemes,
 * business rules, email/fx/comms, appearance, workflow). Read by section/key;
 * every write version-bumps and is audited (config changes are security-sensitive).
 * This is the admin face of shared/config/settings, which the rest of the app
 * reads at runtime. All SQL is in the repo; validation in the rules.
 */
"use strict";

const repo = require("./setting.repo");
const events = require("./setting.events");
const probes = require("./setting.probes");
const { assertValue } = require("./setting.rules");
const encryption = require("../../../services/encryption.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

// Integration secrets (1.4) live in the generic setting store but are handled
// specially: the plaintext is AES-256-GCM encrypted on write and NEVER read
// back. Reads return metadata + last4 only; the ciphertext (`secret_enc`) and
// plaintext (`secret`) never leave this service.
const SECRET_SECTION = "integration_secret";

/** Strip a secret row's value down to safe metadata (no ciphertext/plaintext). */
function redactSecretValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return { provider: value.provider ?? null, key_name: value.key_name ?? null, last4: value.last4 ?? null };
}
function redactRow(row) {
  if (!row) return row;
  return row.section === SECRET_SECTION ? { ...row, value: redactSecretValue(row.value) } : row;
}

/** Validate + encrypt a secret write payload into the shape we persist. */
function encryptSecret(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("BAD_SECRET", "integration_secret value must be an object containing a 'secret'", 422);
  }
  const secret = value.secret;
  // OAuth bundles contain both an access JWT and a refresh token, not a password.
  const maxLength = value.key_name === "MAIL_CONN" && ["microsoft_graph", "google_gmail"].includes(value.provider) ? 65536 : 4000;
  if (typeof secret !== "string" || secret.length < 1 || secret.length > maxLength) {
    throw new AppError("BAD_SECRET", `integration_secret.secret must be a string of 1–${maxLength} characters`, 422);
  }
  return {
    provider: value.provider ?? null,
    key_name: value.key_name ?? null,
    secret_enc: encryption.encrypt(secret),
    last4: secret.slice(-4),
  };
}

/** All settings grouped by section (secret sections redacted). */
async function all(client) {
  const rows = await repo.listAll(client);
  return rows.reduce((acc, r) => {
    const value = r.section === SECRET_SECTION ? redactSecretValue(r.value) : r.value;
    (acc[r.section] = acc[r.section] || {})[r.key] = { value, version: r.version, updated_at: r.updated_at };
    return acc;
  }, {});
}
const sections = (client) => repo.listSections(client);
async function section(client, s) {
  const rows = await repo.getSection(client, s);
  return s === SECRET_SECTION ? rows.map((r) => ({ ...r, value: redactSecretValue(r.value) })) : rows;
}
async function get(client, s, key) {
  const row = await repo.getByKey(client, s, key);
  if (!row) throw new AppError("NOT_FOUND", "No setting " + s + "." + key, 404);
  return redactRow(row);
}

/** Upsert one (section,key) value — version bump + audit + event. */
async function put(client, { section: s, key, value, actor = {} }) {
  // Integration secrets are encrypted before validation/persistence; the
  // plaintext is dropped here and never stored or audited.
  const storeValue = s === SECRET_SECTION ? encryptSecret(value) : value;
  assertValue(s, key, storeValue);
  const before = await repo.getByKey(client, s, key);
  const row = await repo.upsert(client, { section: s, key, value: storeValue, updatedBy: actor.user_id || null });
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "setting:" + s + "." + key, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "setting:" + s + "." + key, before: redactRow(before), after: redactRow(row) });
  return redactRow(row);
}

async function remove(client, { section: s, key, actor = {} }) {
  const ok = await repo.remove(client, s, key);
  if (!ok) throw new AppError("NOT_FOUND", "No setting " + s + "." + key, 404);
  await audit(client, { actorUserId: actor.user_id || null, action: events.DELETED, moduleKey: events.MODULE, entityRef: "setting:" + s + "." + key });
  return { deleted: true };
}

/**
 * INTERNAL ONLY — decrypt a stored integration secret for server-side use
 * (e.g. calling a provider's API at runtime). Must NEVER be wired to a route;
 * the HTTP surface is write-only. Returns null if the secret isn't set.
 */
async function readSecret(client, key) {
  const row = await repo.getByKey(client, SECRET_SECTION, key);
  if (!row || !row.value || !row.value.secret_enc) return null;
  return encryption.decrypt(row.value.secret_enc);
}

/**
 * Verify a stored integration secret with a live, read-only upstream call.
 * The plaintext is decrypted in-process for the probe and NEVER returned; the
 * HTTP surface only ever sees { ok, provider, status?, error? } + probe meta.
 * Mirrors AI Governance's testVendor. Returns ok:false (never throws) so the
 * UI can render a clean pass/fail.
 */
async function testSecret(client, key) {
  const row = await repo.getByKey(client, SECRET_SECTION, key);
  if (!row || !row.value || !row.value.secret_enc) {
    return { ok: false, error: "no integration secret set for '" + key + "'" };
  }
  const provider = row.value.provider || null;
  if (!probes.hasProbe(provider)) {
    return { ok: false, provider, error: "no connectivity test available for provider '" + provider + "'" };
  }
  const secret = encryption.decrypt(row.value.secret_enc);
  try {
    const meta = await probes.PROBES[provider](secret);
    return { ok: true, provider, ...meta };
  } catch (err) {
    const r = err.response;
    return {
      ok: false,
      provider,
      status: r && r.status,
      error: (r && r.data && ((r.data.error && r.data.error.message) || r.data["error-type"] || r.data.message)) || err.message,
    };
  }
}

module.exports = { all, sections, section, get, put, remove, readSecret, testSecret, SECRET_SECTION };
