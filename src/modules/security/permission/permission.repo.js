"use strict";

const { listComplete } = require("../../../shared/db/query-helpers");
const { makeRepo } = require("../../../shared/crud/resource");

const base = makeRepo({
  // SEC H3. The grant matrix. PUT /permissions/grant is validated properly now
  // (permission.validator), but the generic CRUD create/update on the same
  // table still went through passthrough — a second door to the same rows.
  writable: ["role_id", "module_key", "can_create", "can_read", "can_update", "can_delete", "can_approve"],
  table: "permission",
  pk: "permission_id",
  activeColumn: null,
  searchColumn: null,
  // The permission table has no created_at/updated_at — order by its real
  // columns (was "created_at DESC", which 500'd GET /permissions).
  orderBy: "role_id, module_key",
});

/**
 * EVERY grant, unpaginated — what the matrix editor needs.
 *
 * The generic `list()` clamps to 50 rows (shared/db/query-helpers.js page()),
 * and the matrix was loading through it. With 11 roles × 72 modules the default
 * seed alone writes far more than 50 `permission` rows, so the editor only ever
 * saw the first page. That is not a display bug — it is destructive:
 *
 *   · a cell whose grant exists but wasn't in the first 50 renders EMPTY;
 *   · clicking one permission on that cell computes `current` as an all-false
 *     grant and PUTs the whole row, and the upsert overwrites all five columns
 *     from EXCLUDED — so the grants that were already there are wiped;
 *   · after a refresh the row still isn't in the first page, so the cell looks
 *     empty again and the edit looks like it "didn't save".
 *
 * Bounded by roles × modules and admin-only, so returning the lot is safe. The
 * paginated `list()` stays for any other caller.
 */
async function listAll(client) {
  const { rows } = await listComplete(client, "SELECT * FROM permission ORDER BY role_id, module_key", [], { label: "The permission grant matrix", ceiling: 20000 });
  return rows;
}

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

module.exports = { ...base, listAll, upsertGrant };
