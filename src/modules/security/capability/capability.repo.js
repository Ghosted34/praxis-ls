"use strict";
const { makeRepo } = require("../../../shared/crud/resource");

// Blanket-authority sentinel for user_capability.document_type. The table's PK is
// (user_id, capability_id, document_type) so document_type is implicitly NOT NULL;
// '*' means "this authority applies to every document type", which is what
// requireCapability() (code-presence only, thresholds ignored) checks. Any future
// per-document-type routing uses a real doc type and is left untouched by the
// blanket assignment path below.
const ALL_DOCS = "*";

const base = makeRepo({
  table: "capability",
  pk: "capability_id",
  activeColumn: null,
  searchColumn: "name",
  orderBy: "name ASC",
});

/** The capability codes a user holds (blanket rows), for requireCapability parity. */
async function userCapabilities(client, userId) {
  const { rows } = await client.query(
    `SELECT c.capability_id, c.code, c.name
       FROM user_capability uc
       JOIN capability c ON c.capability_id = uc.capability_id
      WHERE uc.user_id = $1 AND uc.document_type = $2
      ORDER BY c.code`,
    [userId, ALL_DOCS],
  );
  return rows;
}

/**
 * Replace a user's blanket capability set. Only the document_type='*' rows are
 * managed here, so any fine-grained (per-doc-type) authority a tenant adds later
 * survives. Runs in the caller's transaction.
 */
async function setUserCapabilities(client, userId, capabilityIds) {
  await client.query(
    "DELETE FROM user_capability WHERE user_id = $1 AND document_type = $2",
    [userId, ALL_DOCS],
  );
  for (const cid of capabilityIds || []) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO user_capability (user_id, capability_id, document_type)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, cid, ALL_DOCS],
    );
  }
}

module.exports = { ...base, ALL_DOCS, userCapabilities, setUserCapabilities };
