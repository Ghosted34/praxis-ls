/**
 * receipt.posted → dossier.fully_collected (Plan A, Phase 3).
 *
 * A posted receipt FIFO-allocates across a client's open invoices. This resolves
 * the dossiers those allocations touched (payment_allocation → invoice → dossier)
 * and, for any whose posted FINAL invoices now have ZERO outstanding, emits a
 * one-time `dossier.fully_collected` signal — the "ready to close" cue a UI/prompt
 * can consume (a signal, not a user notification; same pattern as
 * dossier.milestones_completed).
 *
 * SAFE + idempotent: emits at most once per dossier; never transitions anything.
 */
"use strict";

const { emitEvent } = require("../../shared/events/emit");

const LOCKED = "('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')";
function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "receipt.posted",
  handlerKey: "receipt.posted:collected-signal",
  feature: null,
  async run(client, event) {
    const receiptId = idFromRef(event.entity_ref, "payment_receipt");
    if (!receiptId) return { skipped: "no receipt ref" };

    const dossiers = (await client.query(
      "SELECT DISTINCT i.dossier_id FROM payment_allocation pa " +
        "JOIN invoice i ON i.invoice_id = pa.invoice_id " +
        "WHERE pa.receipt_id = $1 AND i.dossier_id IS NOT NULL",
      [receiptId],
    )).rows;
    if (!dossiers.length) return { skipped: "receipt touched no dossier-tagged invoices" };

    const signalled = [];
    for (const { dossier_id } of dossiers) {
      // Outstanding across this dossier's posted FINAL invoices.
       
      const out = await client.query(
        "SELECT COUNT(*)::int AS n, " +
          "COALESCE(SUM(i.total_ttc - COALESCE(a.alloc, 0)), 0) AS outstanding " +
          "FROM invoice i " +
          "LEFT JOIN (SELECT invoice_id, SUM(amount) AS alloc FROM payment_allocation GROUP BY invoice_id) a ON a.invoice_id = i.invoice_id " +
          "WHERE i.dossier_id = $1 AND i.type = 'FINAL' AND i.status IN " + LOCKED,
        [dossier_id],
      );
      const row = out.rows[0];
      if (!row || row.n === 0) continue; // no billed invoices → nothing to "collect"
      if (Number(row.outstanding) > 0) continue; // still owed

       
      const already = await client.query(
        "SELECT 1 FROM event_log WHERE event_type_key = 'dossier.fully_collected' AND entity_ref = $1 LIMIT 1",
        ["dossier:" + dossier_id],
      );
      if (already.rows.length) continue;

       
      await emitEvent(client, {
        eventTypeKey: "dossier.fully_collected",
        moduleKey: "MOD-29",
        entityRef: "dossier:" + dossier_id,
        actorUserId: null,
      });
      signalled.push(dossier_id);
    }
    return { signalled: signalled.length };
  },
};
