"use strict";
async function listSoftDeletes(c) {
  const { rows } = await c.query("SELECT * FROM soft_delete WHERE restored_at IS NULL ORDER BY deleted_at DESC LIMIT 100");
  return rows;
}
async function getSoftDelete(c, id) {
  const { rows } = await c.query("SELECT * FROM soft_delete WHERE soft_delete_id=$1", [id]);
  return rows[0] || null;
}
async function pinHash(c, userId) {
  const { rows } = await c.query("SELECT godmode_pin_hash FROM app_user WHERE user_id=$1", [userId]);
  return rows[0] ? rows[0].godmode_pin_hash : null;
}
async function recordPurge(c, { actorUserId, actorName, actorEmail, entityRef, payload, ip }) {
  // God-Mode purges are always sensitive (0510). Snapshot the actor's name
  // and email at write time so the Control Tower's self-scoped feed can
  // render them without a cross-schema join back to app_user. Existing
  // callers that don't pass actorName/actorEmail keep working — the columns
  // default NULL.
  await c.query(
    `INSERT INTO immutable_ledger (
       actor_user_id, actor_name_snapshot, actor_email_snapshot,
       action, module_key, entity_ref, before_json, ip, is_sensitive
     ) VALUES ($1,$2,$3,'godmode.purge','MOD-00B',$4,$5,$6, true)`,
    [actorUserId, actorName || null, actorEmail || null, entityRef, payload || null, ip || null],
  );
}

// ── G5: catalogue-driven accounting guard + dependency preview ──────────────
//
// The old guard was a regex over a hand-listed set of prefixes
// (/^(invoice|journal|receipt|payment|asset|payroll):/i) — every new posting
// module (credit_note, supplier_invoice, cash_request, regie, depreciation…)
// depended on someone remembering to edit it, and anything missed was
// purgeable. The replacement is referential: every posting path writes to the
// immutable ledger keyed by the record's entity_ref, so "has this record ever
// touched the books" is answered by the ledger, not by a naming convention.
// Children (any FK table referencing the record's table) are DISCOVERED from
// pg_constraint the same way party_merge discovers reattachment targets, so
// the dependency preview stays exhaustive as the schema grows.

/** Split `table:id` — the entity_ref shape every module writes (`invoice:uuid`). */
function parseEntityRef(entityRef) {
  const m = /^([a-z_]+):([0-9a-fA-F-]{36})$/.exec(String(entityRef || ""));
  return m ? { table: m[1], id: m[2] } : null;
}

/** Immutable-ledger rows keyed to this record (exact, or child refs under it). */
async function ledgerRefs(c, entityRef) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM immutable_ledger
      WHERE entity_ref = $1 OR entity_ref LIKE $1 || ':%'`,
    [entityRef],
  );
  return rows[0] ? rows[0].n : 0;
}

/** The record table's primary key column, resolved through the catalogue.
 *  `to_regclass` returns NULL for an unknown name instead of throwing, so a
 *  table that does not exist (or a table in another schema) degrades to
 *  "no dependencies" rather than erroring the preview. */
async function tablePk(c, table) {
  const { rows } = await c.query(
    `SELECT att.attname AS pk
       FROM pg_constraint con
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'p' AND con.conrelid = to_regclass($1)`,
    [table],
  );
  return rows[0] ? rows[0].pk : null;
}

/** Every FK in the schema referencing `table(pk)` — catalogue-derived. */
async function referencingForeignKeys(c, table, pk) {
  const { rows } = await c.query(
    `SELECT con.conrelid::regclass::text AS child_table,
            att.attname                  AS child_col
       FROM pg_constraint con
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f'
        AND con.confrelid = to_regclass($1)
        AND con.confkey[1] = (
          SELECT attnum FROM pg_attribute
           WHERE attrelid = to_regclass($1) AND attname = $2 AND NOT attisdropped
        )
      ORDER BY child_table, child_col`,
    [table, pk],
  );
  return rows;
}

/** Rows in one child table pointing at the record. child_table/child_col come
 *  from the catalogue (regclass-qualified), never from user input. */
async function childCount(c, childTable, childCol, id) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM ${childTable} WHERE ${childCol} = $1`,
    [id],
  );
  return rows[0] ? rows[0].n : 0;
}

module.exports = {
  listSoftDeletes, getSoftDelete, pinHash, recordPurge,
  parseEntityRef, ledgerRefs, tablePk, referencingForeignKeys, childCount,
};
