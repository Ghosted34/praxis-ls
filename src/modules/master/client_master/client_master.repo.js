/** Client master repository (MOD-03). All client_master SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "client_master", data);
const get = (client, id) => getById(client, "client_master", "client_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "client_master", "client_id", id, fields, "*", null, { touch: "updated_at" });
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("name ILIKE $" + params.length); }
  if (q.active !== undefined) { params.push(q.active === "true" || q.active === true); wh.push("is_active = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT * FROM client_master " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}


/**
 * Real outstanding receivables for a client — derived, not cached.
 *
 * DATA 1.9 (High). `client_master.cached_receivables` is declared
 * NOT NULL DEFAULT 0 and NOTHING IN src/ EVER WRITES TO IT. It is permanently
 * zero. It is READ though: creditStatus computes availability as
 * `limit - cached_receivables`, so every client reported zero exposure and
 * unlimited available credit regardless of what they actually owe. The
 * credit-limit control was inert.
 *
 * The figure was always computable — this is the same derivation
 * smart_receivables.repo.openInvoices already uses: posted invoices minus what
 * has been allocated against them.
 *
 * Derived on read rather than maintained as a cache, deliberately. A
 * denormalised balance has to be updated by every path that touches an invoice
 * or an allocation, and the finding here is precisely that one such path was
 * missed — permanently and silently. A correct number computed on demand beats
 * a fast number that is wrong.
 *
 * CREDIT NOTES REDUCE EXPOSURE. A credit note is an `invoice` row with
 * type='CREDIT_NOTE' and a POSITIVE total_ttc (credit_note.service builds it
 * from positive line amounts), so it must be SUBTRACTED, not summed. Omitting
 * them would overstate what a client owes and refuse orders they are entitled
 * to place — the opposite failure to the one being fixed, and just as wrong.
 *
 * Two kinds, handled separately because `reverses_invoice_id` (migration 0442)
 * tells us which:
 *   - linked to an invoice   → nets against THAT invoice, so a credited invoice
 *                              also stops counting as overdue
 *   - not linked to anything → a general credit on the account, netted at the
 *                              client level
 *
 * A linked credit note is floored at the invoice total (GREATEST(..., 0)) so an
 * over-credited invoice cannot manufacture negative exposure that quietly
 * offsets a different, genuinely unpaid invoice. Over-crediting is a data
 * error; it should be visible as an anomaly on that invoice, not silently
 * spread across the account. A deliberate general credit is the unlinked case,
 * which does net across the whole balance.
 *
 * Only locked statuses count on both sides: a DRAFT invoice is not a
 * receivable, and a DRAFT credit note is not yet a concession.
 */

/** Issued to the client and no longer editable — the statuses that are real money. */
const LOCKED_STATUSES = ["POSTED_LOCKED", "APPROVED_LOCKED", "ISSUED_LOCKED"];

async function outstandingFor(client, clientId) {
  const { rows } = await client.query(
    `WITH finals AS (
       SELECT invoice_id, total_ttc, payment_due_on
         FROM invoice
        WHERE client_id = $1 AND type = 'FINAL' AND status = ANY($2)
     ),
     paid AS (
       SELECT invoice_id, SUM(amount) AS amt
         FROM payment_allocation
        WHERE invoice_id IN (SELECT invoice_id FROM finals)
        GROUP BY invoice_id
     ),
     credited AS (
       SELECT reverses_invoice_id AS invoice_id, SUM(total_ttc) AS amt
         FROM invoice
        WHERE client_id = $1 AND type = 'CREDIT_NOTE' AND status = ANY($2)
          AND reverses_invoice_id IS NOT NULL
        GROUP BY reverses_invoice_id
     ),
     unlinked_credit AS (
       SELECT COALESCE(SUM(total_ttc), 0) AS amt
         FROM invoice
        WHERE client_id = $1 AND type = 'CREDIT_NOTE' AND status = ANY($2)
          AND reverses_invoice_id IS NULL
     ),
     remaining AS (
       SELECT f.payment_due_on,
              GREATEST(f.total_ttc - COALESCE(p.amt, 0) - COALESCE(c.amt, 0), 0) AS due
         FROM finals f
         LEFT JOIN paid     p ON p.invoice_id = f.invoice_id
         LEFT JOIN credited c ON c.invoice_id = f.invoice_id
     )
     SELECT
       GREATEST(COALESCE(SUM(due), 0) - (SELECT amt FROM unlinked_credit), 0)::numeric AS outstanding,
       -- payment_due_on IS NULL yields NULL, not true, so an undated invoice is
       -- never counted as overdue. That is correct: nothing is late until a due
       -- date says so.
       COALESCE(SUM(CASE WHEN payment_due_on < CURRENT_DATE THEN due ELSE 0 END), 0)::numeric AS overdue
     FROM remaining`,
    [clientId, LOCKED_STATUSES],
  );
  return {
    outstanding: Number(rows[0].outstanding) || 0,
    overdue: Number(rows[0].overdue) || 0,
  };
}

module.exports = { outstandingFor, insert, get, update, list };
