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

module.exports = { SECTION, getAppearance, upsertAppearance };
