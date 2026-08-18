"use strict";
/** God Mode (CEO-only, PIN-gated). Purges junk NON-accounting data and writes
 *  the full removed payload to the immutable ledger (PRD §8.5). Accounting-
 *  connected records can never be purged — only reversed. */
const repo = require("./godmode.repo");

const listPurgeable = (c) => repo.listSoftDeletes(c);

/**
 * Everything connected to a soft-deleted record, for the dependency preview
 * (meeting §11.2: "It shows every file connected to the record and asks
 * whether to delete across everything"):
 *   - ledger_refs — immutable-ledger rows keyed to this record; > 0 means it
 *     has touched the books and is unpurgeable (G5).
 *   - children — every table holding an FK to the record's table, with the
 *     count of rows pointing at this record, discovered from pg_constraint.
 */
async function dependencies(c, { softDeleteId }) {
  const row = await repo.getSoftDelete(c, softDeleteId);
  if (!row) {
    const e = new Error("record not found or already purged");
    e.status = 404;
    throw e;
  }
  const parsed = repo.parseEntityRef(row.entity_ref);
  const ledgerRefs = await repo.ledgerRefs(c, row.entity_ref);
  const children = [];
  if (parsed) {
    const pk = await repo.tablePk(c, parsed.table);
    if (pk) {
      const fks = await repo.referencingForeignKeys(c, parsed.table, pk);
      for (const fk of fks) {
        const n = await repo.childCount(c, fk.child_table, fk.child_col, parsed.id);
        if (n > 0) children.push({ table: fk.child_table, column: fk.child_col, count: n });
      }
    }
  }
  return {
    soft_delete: row,
    entity_ref: row.entity_ref,
    ledger_refs: ledgerRefs,
    purgeable: ledgerRefs === 0,
    children,
  };
}

async function purge(c, { actor, softDeleteId, pin, ip }) {
  if (!actor || !actor.user_id) { const e = new Error("authentication required"); e.status = 401; throw e; }
  const hash = await repo.pinHash(c, actor.user_id);
  if (!hash) { const e = new Error("God Mode is restricted to the CEO (no PIN on file)"); e.status = 403; throw e; }
  let ok = false;
  try { const argon2 = require("argon2"); ok = await argon2.verify(hash, pin || ""); } catch { ok = false; }
  if (!ok) { const e = new Error("invalid God Mode PIN"); e.status = 403; throw e; }

  const row = await repo.getSoftDelete(c, softDeleteId);
  if (!row) { const e = new Error("record not found or already purged"); e.status = 404; throw e; }

  // G5 — referential guard, not a naming convention. Any immutable-ledger row
  // keyed to this record means it has posted (or been part of a posted flow),
  // and a posted record can only be reversed, never purged. This covers every
  // posting module — invoice, journal, receipt, payment, asset, payroll,
  // credit_note, supplier_invoice, cash_request, regie, depreciation — with no
  // prefix list to keep in sync, because the ledger is written by every one.
  const ledgerRefs = await repo.ledgerRefs(c, row.entity_ref);
  if (ledgerRefs > 0) {
    const e = new Error(
      `accounting-connected records can never be purged — reverse instead (${ledgerRefs} immutable-ledger reference(s))`,
    );
    e.status = 422;
    throw e;
  }

  await repo.recordPurge(c, {
    actorUserId: actor.user_id,
    // Snapshot actor identity (0510) so the reader can render a card without a
    // cross-schema join. `actor` is `req.user` from the controller.
    actorName: actor.display_name || actor.email || null,
    actorEmail: actor.email || null,
    entityRef: row.entity_ref,
    payload: row.payload_json,
    ip,
  });
  return { purged: true, entity_ref: row.entity_ref };
}
module.exports = { listPurgeable, purge, dependencies };
