"use strict";

/**
 * user_known_device (14230) — the devices the server remembers for the sign-in
 * greeting. See known-device.js for what this is and, more importantly, what it
 * is not (a credential).
 */

/** How many passkeys one (device, person) row lists — one per device is the
 *  norm; room for a replaced one and a synced one. */
const MAX_IDS = 10;

/**
 * Record a sign-in from this device: bump `last_seen_at`, and when a passkey
 * was proven here, add its id (once, keeping the newest MAX_IDS).
 */
async function upsert(client, { deviceHash, userId, label = null, credentialId = null }) {
  await client.query(
    `INSERT INTO user_known_device (device_hash, user_id, label, passkey_ids)
     VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN '{}'::text[] ELSE ARRAY[$4::text] END)
     ON CONFLICT (device_hash, user_id) DO UPDATE SET
       last_seen_at = now(),
       label = COALESCE(EXCLUDED.label, user_known_device.label),
       passkey_ids = CASE
         WHEN $4::text IS NULL OR $4::text = ANY(user_known_device.passkey_ids) THEN user_known_device.passkey_ids
         ELSE (user_known_device.passkey_ids || $4::text)[GREATEST(1, cardinality(user_known_device.passkey_ids) + 2 - $5::int):]
       END`,
    [deviceHash, userId, label, credentialId, MAX_IDS],
  );
}

/**
 * The person this device last signed in, with the passkeys proven HERE that
 * their account STILL holds (the join is what makes a removed passkey vanish
 * from every device at once), and whether they have a Quick PIN. Active
 * accounts only.
 */
async function latestAccount(client, deviceHash) {
  const { rows } = await client.query(
    `SELECT u.email, u.full_name, u.avatar_ref,
            ARRAY(SELECT c.credential_id FROM webauthn_credential c
                   WHERE c.user_id = d.user_id AND c.credential_id = ANY(d.passkey_ids)
                   ORDER BY c.last_used_at DESC NULLS LAST) AS passkeys,
            EXISTS (SELECT 1 FROM user_quick_pin p WHERE p.user_id = d.user_id) AS has_quick_pin
       FROM user_known_device d
       JOIN app_user u ON u.user_id = d.user_id
      WHERE d.device_hash = $1 AND u.status = 'ACTIVE'
      ORDER BY d.last_seen_at DESC
      LIMIT 1`,
    [deviceHash],
  );
  return rows[0] || null;
}

/** A passkey the person removed stops being listed anywhere (the join already
 *  hides it; this keeps the rows honest too). */
async function forgetPasskey(client, { userId, credentialId }) {
  await client.query(
    "UPDATE user_known_device SET passkey_ids = array_remove(passkey_ids, $2) WHERE user_id = $1 AND $2 = ANY(passkey_ids)",
    [userId, credentialId],
  );
}

module.exports = { upsert, latestAccount, forgetPasskey, MAX_IDS };
