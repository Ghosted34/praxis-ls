/** Supplier-invoice repository (MOD-61). All SI / SI-line SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertSI = (client, data) => insertOne(client, "supplier_invoice", data);
const getSI = (client, id) => getById(client, "supplier_invoice", "supplier_invoice_id", id);
const insertLine = (client, data) => insertOne(client, "supplier_invoice_line", data);

async function deleteLines(client, id) { await client.query("DELETE FROM supplier_invoice_line WHERE supplier_invoice_id = $1", [id]); }
// The container type is joined so a carrier's invoice can be read line-by-line
// against the rate card it was priced from — the whole point of recording it.
// LEFT JOIN: most lines carry no equipment, and a type retired since the
// invoice was posted must still render its name.
const LINE_SELECT =
  "SELECT sl.*, dr.code AS container_type_code, dr.name_en AS container_type_en, " +
  "dr.name_fr AS container_type_fr, dr.extra AS container_type_extra " +
  "FROM supplier_invoice_line sl LEFT JOIN dictionary_ref dr ON dr.ref_id = sl.container_type_ref_id ";
async function listLines(client, id) {
  const { rows } = await client.query(LINE_SELECT + "WHERE sl.supplier_invoice_id = $1 ORDER BY sl.supplier_invoice_line_id", [id]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getSI(client, id);
  return updateOne(client, "supplier_invoice", "supplier_invoice_id", id, fields, "*", null, { touch: "updated_at" });
}
/** The PO facts the match needs: TTC total, currency and its originating PR. */
async function poFacts(client, poId) {
  const { rows } = await client.query(
    "SELECT total_ttc, currency, pr_id FROM purchase_order WHERE po_id = $1",
    [poId],
  );
  return rows[0] || null;
}
async function grnCountForPO(client, poId) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM goods_received_note WHERE po_id = $1", [poId]);
  return rows[0].n;
}
/** PO ordered qty per dictionary item (for the quantity leg of the match). */
async function poLineQty(client, poId) {
  const { rows } = await client.query(
    "SELECT dictionary_item_id, label, qty FROM purchase_order_item WHERE po_id = $1",
    [poId],
  );
  return rows;
}
/** Σ PR line totals (qty × unit_price) — the request's estimated value. */
async function prTotal(client, prId) {
  if (!prId) return null;
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(qty * unit_price), 0) AS total FROM purchase_request_line WHERE pr_id = $1",
    [prId],
  );
  return rows[0] ? Number(rows[0].total) : null;
}

/* ── AP payments (10720) ─────────────────────────────────────────────────── */
const insertPayment = (client, data) => insertOne(client, "supplier_invoice_payment", data);
async function listPayments(client, id) {
  const { rows } = await client.query(
    "SELECT * FROM supplier_invoice_payment WHERE supplier_invoice_id = $1 ORDER BY paid_on, created_at",
    [id],
  );
  return rows;
}
/** Σ of the payment children — the source of truth for amount_paid. */
async function paymentsTotal(client, id) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_invoice_payment WHERE supplier_invoice_id = $1",
    [id],
  );
  return Number(rows[0].total);
}
/**
 * Recompute supplier_master.cached_payables / cached_overdue from the invoices
 * themselves — never incremented, so a reversed payment cannot drift the cache
 * (Landing A's rule). Payable = Σ(amount_ttc − amount_paid) over posted/paid
 * invoices; overdue is the same sum restricted to invoices past their due date
 * (the legacy's cached_overdue, which the rebuild never wrote until 10721).
 */
async function refreshSupplierCache(client, supplierId) {
  if (!supplierId) return;
  const { rows } = await client.query(
    `UPDATE supplier_master
        SET cached_payables = COALESCE((
              SELECT SUM(amount_ttc - amount_paid)
                FROM supplier_invoice
               WHERE supplier_id = $1
                 AND status IN ('POSTED_LOCKED','PAID')
            ), 0),
            cached_overdue = COALESCE((
              SELECT SUM(amount_ttc - amount_paid)
                FROM supplier_invoice
               WHERE supplier_id = $1
                 AND status IN ('POSTED_LOCKED','PAID')
                 AND due_on IS NOT NULL AND due_on < CURRENT_DATE
            ), 0)
      WHERE supplier_id = $1`,
    [supplierId],
  );
  return rows[0] || null;
}

async function listSI(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.supplier_id) { params.push(q.supplier_id); wh.push("supplier_id = $" + params.length); }
  const { rows } = await client.query("SELECT *, doc_number AS ref FROM supplier_invoice WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertSI, getSI, insertLine, deleteLines, listLines, update, poFacts, grnCountForPO, poLineQty, prTotal, insertPayment, listPayments, paymentsTotal, refreshSupplierCache, listSI };
