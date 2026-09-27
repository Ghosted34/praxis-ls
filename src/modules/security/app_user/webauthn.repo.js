"use strict";

async function insertCredential(client, { credentialId, userId, publicKey, counter, transports, deviceType, backedUp, aaguid, label }) {
  const { rows } = await client.query(
    `INSERT INTO webauthn_credential (credential_id, user_id, public_key, counter, transports, device_type, backed_up, aaguid, label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING credential_id, user_id, counter, transports, device_type, backed_up, aaguid, label, created_at, last_used_at`,
    [credentialId, userId, publicKey, counter || 0, transports || null, deviceType || "singleDevice", backedUp || false, aaguid || null, label || null],
  );
  return rows[0];
}

/** What My security lists — never the public key. */
async function listForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT credential_id, label, transports, device_type, backed_up, aaguid, created_at, last_used_at
     FROM webauthn_credential WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

/** Registration's exclude list and the per-user cap. */
async function listForUserWithKeys(client, userId) {
  const { rows } = await client.query(`SELECT credential_id, transports FROM webauthn_credential WHERE user_id = $1`, [userId]);
  return rows;
}

async function getByCredentialId(client, credentialId) {
  const { rows } = await client.query(`SELECT * FROM webauthn_credential WHERE credential_id = $1`, [credentialId]);
  return rows[0] || null;
}

async function updateCounter(client, credentialId, newCounter) {
  await client.query(`UPDATE webauthn_credential SET counter = $2, last_used_at = now() WHERE credential_id = $1`, [credentialId, newCounter]);
}

async function deleteCredential(client, credentialId, userId) {
  const { rows } = await client.query(
    `DELETE FROM webauthn_credential WHERE credential_id = $1 AND user_id = $2 RETURNING credential_id, label`,
    [credentialId, userId],
  );
  return rows[0] || null;
}

module.exports = {
  insertCredential,
  listForUser,
  listForUserWithKeys,
  getByCredentialId,
  updateCounter,
  deleteCredential,
};
