/**
 * Data access for white-label branding (the `appearance` section of `setting`).
 * All SQL for this module lives here per CONVENTIONS.md — the service only
 * orchestrates + audits.
 */
"use strict";

const SECTION = "appearance";

/** All appearance key/value rows for the tenant. */
async function getAppearance(client) {
  const { rows } = await client.query(`SELECT key, value FROM setting WHERE section = $1`, [SECTION]);
  return rows;
}

/** Upsert one appearance setting (value stored as jsonb). */
async function upsertAppearance(client, key, value, actorId) {
  await client.query(
    `INSERT INTO setting (section, key, value, updated_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (section, key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_by = EXCLUDED.updated_by,
            updated_at = now(),
            version = setting.version + 1`,
    [SECTION, key, JSON.stringify(value), actorId || null],
  );
}

// ── Login screen editor (3.2) — same setting table, section='login' ──
const LOGIN_SECTION = "login";
async function getLogin(client) {
  const { rows } = await client.query(`SELECT key, value FROM setting WHERE section = $1`, [LOGIN_SECTION]);
  return rows;
}
async function upsertLogin(client, key, value, actorId) {
  await client.query(
    `INSERT INTO setting (section, key, value, updated_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (section, key) DO UPDATE
        SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
            updated_at = now(), version = setting.version + 1`,
    [LOGIN_SECTION, key, JSON.stringify(value), actorId || null]);
}

// ── Installed-app (PWA) design — same setting table, section='pwa' ──
//
// A SEPARATE SECTION, not more `appearance` keys. Appearance is the *in-app*
// token layer, read on every page load and painted into CSS variables; this is
// the *installed app's* identity — manifest, home-screen icon, boot splash and
// the install/offline copy. They are edited by different screens, they fall
// back to each other rather than duplicating (an unset PWA name means "use the
// brand name"), and keeping them apart means the manifest route can read one
// small row set instead of filtering the appearance map.
const PWA_SECTION = "pwa";
async function getPwa(client) {
  const { rows } = await client.query(`SELECT key, value FROM setting WHERE section = $1`, [PWA_SECTION]);
  return rows;
}
async function upsertPwa(client, key, value, actorId) {
  await client.query(
    `INSERT INTO setting (section, key, value, updated_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (section, key) DO UPDATE
        SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
            updated_at = now(), version = setting.version + 1`,
    [PWA_SECTION, key, JSON.stringify(value), actorId || null]);
}

module.exports = {
  SECTION,
  LOGIN_SECTION,
  PWA_SECTION,
  getAppearance,
  upsertAppearance,
  getLogin,
  upsertLogin,
  getPwa,
  upsertPwa,
};
