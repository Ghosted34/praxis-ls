/**
 * Data access for per-user preferences (`user_preference`, migration 0496).
 * All SQL for the module lives here per CONVENTIONS.md — the service only
 * orchestrates.
 */
"use strict";

/** Every override this user has set in one section. */
async function getSection(client, userId, section) {
  const { rows } = await client.query(
    `SELECT key, value FROM user_preference WHERE user_id = $1 AND section = $2`,
    [userId, section],
  );
  return rows;
}

/** Upsert one preference (value stored as jsonb). */
async function upsert(client, userId, section, key, value) {
  await client.query(
    `INSERT INTO user_preference (user_id, section, key, value)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, section, key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = now()`,
    [userId, section, key, JSON.stringify(value)],
  );
}

/**
 * Delete one preference. This is how "inherit the tenant value" is stored —
 * as the ABSENCE of a row, not as a null one. A row holding null would be
 * indistinguishable from an override to "no font", and the overlay in the
 * service would have to special-case it on every read.
 */
async function remove(client, userId, section, key) {
  await client.query(`DELETE FROM user_preference WHERE user_id = $1 AND section = $2 AND key = $3`, [
    userId,
    section,
    key,
  ]);
}

/** Drop an entire section — backs "reset to the tenant default". */
async function removeSection(client, userId, section) {
  await client.query(`DELETE FROM user_preference WHERE user_id = $1 AND section = $2`, [userId, section]);
}

module.exports = { getSection, upsert, remove, removeSection };
