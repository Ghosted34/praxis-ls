/**
 * Governed counterparty merge (PR3-C §5.2).
 *
 * Two records turn out to be the same counterparty (a duplicate the dedup
 * detection surfaced). Merging folds the LOSER into the SURVIVOR — same kind
 * only (a client never merges into a supplier; that cross-kind relationship is
 * the conversion bridge, not a merge). In ONE transaction it:
 *
 *   1. Reattaches every foreign key loser → survivor. The FKs are DISCOVERED
 *      from the catalogue (pg_constraint) rather than hand-listed, so a table
 *      added later that references a master is reattached automatically instead
 *      of being silently left pointing at an archived record.
 *   2. Preserves the loser's names as aliases under the survivor (so a later
 *      search / dedup still finds the counterparty by its old name) and moves
 *      any aliases the loser already carried.
 *   3. Unions the child collections (they ride along on the FK reattachment);
 *      trivially-identical registrations and bank accounts are de-duplicated,
 *      everything else is kept.
 *   4. Soft-archives the loser — registration_status ARCHIVED, is_active false,
 *      a deactivation_reason, and merged_into_id pointing at the survivor. The
 *      loser is NEVER hard-deleted: journal lines, invoices and dossiers
 *      reference it and the roll-up must stay reconstructable (Hard Rule 5).
 *   5. Deactivates the loser's auxiliary account (never deletes it) and
 *      re-points its open compliance flags to the survivor.
 *   6. Writes an immutable-ledger + audit entry (before/after + actor).
 *
 * `executeMerge` performs the DML and assumes the CALLER has opened the
 * transaction (so the approval-apply path can run it inside its own tx without
 * the nested-BEGIN trap); `merge` is the convenience wrapper that opens one.
 */
"use strict";
const partyAccounting = require("../party-accounting.service");
const { audit, emitEvent } = require("../../../shared/events/emit");
const { normalizeName } = require("../_shared/party-write.service");
const { AppError } = require("../../../utils/errors");

const KIND = {
  client: { table: "client_master", pk: "client_id", moduleKey: "MOD-03" },
  supplier: { table: "supplier_master", pk: "supplier_id", moduleKey: "MOD-04" },
};

function cfg(kind) {
  const k = KIND[kind];
  if (!k) throw new AppError("BAD_PARTY_KIND", `unknown party kind "${kind}"`, 422);
  return k;
}

async function loadParty(c, k, id) {
  const { rows } = await c.query(`SELECT * FROM ${k.table} WHERE ${k.pk} = $1`, [id]);
  return rows[0] || null;
}

const refOf = (party, k) => party.ref || party.legal_name || party.name || String(party[k.pk]);

/**
 * Every foreign key in the schema that references `<table>(<pkColumn>)`.
 * Catalogue-derived, so the reattachment stays exhaustive as the schema grows.
 * Returns `[{ child_table, child_col }]` where child_table is a regclass text
 * (already correctly quoted / schema-qualified for the search_path).
 */
async function referencingForeignKeys(c, table, pkColumn) {
  const { rows } = await c.query(
    `SELECT con.conrelid::regclass::text AS child_table,
            att.attname                  AS child_col
       FROM pg_constraint con
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f'
        AND con.confrelid = $1::regclass
        AND con.confkey[1] = (
          SELECT attnum FROM pg_attribute
           WHERE attrelid = $1::regclass AND attname = $2 AND NOT attisdropped
        )
      ORDER BY child_table, child_col`,
    [table, pkColumn],
  );
  return rows;
}

/**
 * De-duplicate a child collection on the survivor after the union: when two
 * rows share the same content signature, keep the oldest and drop the rest.
 * Only the collections where an exact duplicate is meaningful — registrations
 * (same kind+number) and bank accounts (same account/iban) — are folded;
 * contacts, addresses, owners and documents keep both (Hard Rule: otherwise keep
 * both). Returns the number of rows removed.
 */
async function dedupChild(c, { table, parentCol, parentId, sigCols }) {
  const coalesced = sigCols.map((col) => `lower(coalesce(${col}::text, ''))`).join(" || '|' || ");
  const { rowCount } = await c.query(
    `DELETE FROM ${table} t
      USING (
        SELECT ctid,
               row_number() OVER (
                 PARTITION BY ${coalesced}
                 ORDER BY created_at ASC, ctid ASC
               ) AS rn
          FROM ${table}
         WHERE ${parentCol} = $1
      ) d
      WHERE t.ctid = d.ctid AND d.rn > 1
        AND (${sigCols.map((col) => `t.${col} IS NOT NULL`).join(" OR ")})`,
    [parentId],
  );
  return rowCount || 0;
}

/** The distinct trading names the loser was known by (to preserve as aliases). */
function loserNames(loser) {
  const seen = new Set();
  const out = [];
  for (const v of [loser.legal_name, loser.name, loser.trading_name]) {
    const s = (v || "").trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

/**
 * Validate a merge request and load both parties. Pure of side effects — used by
 * both the preview and the execute path so they cannot disagree on what is
 * mergeable.
 */
async function loadPair(c, { kind, survivorId, loserId }) {
  const k = cfg(kind);
  if (!survivorId || !loserId) throw new AppError("VALIDATION_ERROR", "survivor_id and loser_id are required", 422);
  if (String(survivorId) === String(loserId)) throw new AppError("MERGE_SAME_RECORD", "A record cannot be merged into itself.", 422);
  const survivor = await loadParty(c, k, survivorId);
  if (!survivor) throw new AppError("NOT_FOUND", `Survivor ${kind} not found`, 404);
  const loser = await loadParty(c, k, loserId);
  if (!loser) throw new AppError("NOT_FOUND", `Loser ${kind} not found`, 404);
  if (loser.merged_into_id) throw new AppError("ALREADY_MERGED", "That record has already been merged.", 409);
  if (survivor.merged_into_id) throw new AppError("ALREADY_MERGED", "The survivor has itself been merged into another record.", 409);
  return { k, survivor, loser };
}

/**
 * What a merge WOULD move — counts per referencing table, for the confirm modal.
 * Read-only.
 */
async function mergePreview(c, { kind, survivorId, loserId }) {
  const { k, survivor, loser } = await loadPair(c, { kind, survivorId, loserId });
  const fks = await referencingForeignKeys(c, k.table, k.pk);
  const moves = [];
  for (const { child_table, child_col } of fks) {
    // Skip the master's own self-referential bookkeeping columns in the preview
    // (merged_into_id / linked_*) — they are not records a user thinks of as
    // "moving", and counting them just clutters the modal.
    if (child_table === k.table && child_col === "merged_into_id") continue;
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM ${child_table} WHERE "${child_col}" = $1`,
      [loserId],
    );
    if (rows[0].n > 0) moves.push({ table: child_table, column: child_col, count: rows[0].n });
  }
  return {
    kind,
    survivor: { id: survivor[k.pk], ref: refOf(survivor, k), name: survivor.legal_name || survivor.name },
    loser: { id: loser[k.pk], ref: refOf(loser, k), name: loser.legal_name || loser.name },
    moves,
    total: moves.reduce((s, m) => s + m.count, 0),
  };
}

/**
 * The transactional merge. Assumes the caller has already opened a transaction.
 * Returns a summary of what moved.
 */
async function executeMerge(c, { kind, survivorId, loserId, actor = {} }) {
  const { k, survivor, loser } = await loadPair(c, { kind, survivorId, loserId });
  const parentCol = k.pk;
  const survivorRef = refOf(survivor, k);

  // 1 — reattach every referencing FK loser → survivor.
  const fks = await referencingForeignKeys(c, k.table, k.pk);
  const reattached = [];
  for (const { child_table, child_col } of fks) {
    const { rowCount } = await c.query(
      `UPDATE ${child_table} SET "${child_col}" = $1 WHERE "${child_col}" = $2`,
      [survivorId, loserId],
    );
    if (rowCount) reattached.push({ table: child_table, column: child_col, count: rowCount });
  }

  // 2 — preserve aliases: move the loser's own aliases, then record its names.
  await c.query(
    "UPDATE party_alias SET party_id = $1 WHERE party_kind = $2 AND party_id = $3",
    [survivorId, kind, loserId],
  );
  for (const nm of loserNames(loser)) {
    await c.query(
      `INSERT INTO party_alias (party_kind, party_id, alias, alias_norm, kind, source_ref)
       SELECT $1, $2, $3, $4, 'MERGED_NAME', $5
        WHERE NOT EXISTS (
          SELECT 1 FROM party_alias
           WHERE party_kind = $1 AND party_id = $2 AND lower(alias) = lower($3))`,
      [kind, survivorId, nm, normalizeName({ name: nm }), `${kind}:${loserId}`],
    );
  }

  // 3 — union the child collections is already done by the reattachment above;
  // fold trivially-identical registrations and bank accounts on the survivor.
  const deduped = {};
  deduped.registrations = await dedupChild(c, { table: "party_registration", parentCol, parentId: survivorId, sigCols: ["kind", "number"] });
  deduped.banks = await dedupChild(c, { table: `${kind}_bank_account`, parentCol, parentId: survivorId, sigCols: ["account_number", "iban", "momo_number"] });

  // 4 — soft-archive the loser (never delete).
  await c.query(
    `UPDATE ${k.table}
        SET registration_status = 'ARCHIVED', is_active = false,
            deactivation_reason = $2, merged_into_id = $3, updated_at = now()
      WHERE ${k.pk} = $1`,
    [loserId, `merged into ${survivorRef}`, survivorId],
  );

  // 5 — deactivate the loser's aux account; re-point its open compliance flags.
  await partyAccounting.deactivateAux(c, { kind, partyId: loserId });
  await c.query(
    "UPDATE compliance_flag SET entity_ref = $1 WHERE entity_ref = $2 AND resolved_at IS NULL",
    [`${kind}:${survivorId}`, `${kind}:${loserId}`],
  );

  // 6 — immutable ledger + audit + a HIGH event for oversight.
  const summary = { survivor_id: survivorId, loser_id: loserId, reattached, deduped };
  await audit(c, {
    actorUserId: actor.user_id || null,
    action: `${kind}.merged`,
    moduleKey: k.moduleKey,
    entityRef: `${kind}:${survivorId}`,
    isSensitive: true,
    before: { loser: { id: loserId, ref: refOf(loser, k), registration_status: loser.registration_status } },
    after: summary,
    metadata: { loser_ref: refOf(loser, k), reattached_count: reattached.reduce((s, r) => s + r.count, 0) },
  });
  await emitEvent(c, {
    eventTypeKey: "party.merged", moduleKey: k.moduleKey,
    entityRef: `${kind}:${survivorId}`, actorUserId: actor.user_id || null,
    priority: "HIGH", payload: { loser_id: loserId, loser_ref: refOf(loser, k) },
  });

  return summary;
}

/** Direct merge — opens its own transaction. Used by the sandbox / non-gated path. */
async function merge(c, opts) {
  await c.query("BEGIN");
  try {
    const r = await executeMerge(c, opts);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

module.exports = { KIND, referencingForeignKeys, loadPair, mergePreview, executeMerge, merge, loserNames };
