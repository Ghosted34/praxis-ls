"use strict";
const { makeRepo } = require("../../../shared/crud/resource");

const base = makeRepo({
  table: "permission",
  pk: "permission_id",
  activeColumn: null,
  searchColumn: null,
  orderBy: "created_at DESC",
});

/**
 * Upsert a grant by its natural key (role_id, module_key) — the grant-matrix
 * edits by role×module, not by permission_id. Relies on the table's
 * UNIQUE(role_id, module_key). Returns the resulting row.
 */
async function upsertGrant(client, g) {
  const { rows } = await client.query(
    `INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (role_id, module_key) DO UPDATE SET
       can_create = EXCLUDED.can_create,
       can_read   = EXCLUDED.can_read,
       can_update = EXCLUDED.can_update,
       can_delete = EXCLUDED.can_delete,
       can_approve = EXCLUDED.can_approve
     RETURNING *`,
    [g.role_id, g.module_key, !!g.can_create, !!g.can_read, !!g.can_update, !!g.can_delete, !!g.can_approve],
  );
  return rows[0];
}

module.exports = { ...base, upsertGrant };
