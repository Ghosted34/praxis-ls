/** Purchase-order repository (MOD-60). All PO / PO-item SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertPO = (client, data) => insertOne(client, "purchase_order", data);
const getPO = (client, id) => getById(client, "purchase_order", "po_id", id);
const insertItem = (client, data) => insertOne(client, "purchase_order_item", data);

async function deleteItems(client, poId) { await client.query("DELETE FROM purchase_order_item WHERE po_id = $1", [poId]); }
async function listItems(client, poId) {
  const { rows } = await client.query("SELECT * FROM purchase_order_item WHERE po_id = $1 ORDER BY po_item_id", [poId]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getPO(client, id);
  return updateOne(client, "purchase_order", "po_id", id, fields, "*", null);
}
async function listPO(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.supplier_id) { params.push(q.supplier_id); wh.push("supplier_id = $" + params.length); }
  const { rows } = await client.query("SELECT *, doc_number AS ref FROM purchase_order WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}

/**
 * Effective VAT rate per dictionary item, resolved through the item's PURCHASE
 * posting rule (0200/0210): `posting_rule (applies_context='purchase') →
 * tax_code.rate_percent`. `dictionary_item` itself carries no tax code — the
 * rule does, so the lookup follows the same chain the ledger posting uses.
 * Returns a map { [dictionary_item_id]: rate_percent } — absent items are
 * simply not in the map, so the caller's `|| 0` handles them as HT-only.
 */
async function taxRateForItems(client, ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return {};
  const { rows } = await client.query(
    `SELECT di.dictionary_item_id,
            (SELECT tc.rate_percent
               FROM posting_rule pr
               LEFT JOIN tax_code tc ON tc.tax_code_id = pr.tax_code_id
              WHERE pr.dictionary_item_id = di.dictionary_item_id
                AND pr.applies_context = 'purchase'
                AND pr.tax_code_id IS NOT NULL
              ORDER BY pr.posting_rule_id
              LIMIT 1) AS rate_percent
       FROM dictionary_item di
      WHERE di.dictionary_item_id = ANY($1::uuid[])`,
    [uniq],
  );
  const map = {};
  rows.forEach((r) => { map[r.dictionary_item_id] = Number(r.rate_percent) || 0; });
  return map;
}

/** The supplier facts a PO document must print, captured at issue. */
async function supplierSnapshot(client, supplierId) {
  if (!supplierId) return { name: null, niu: null, address: null, city: null };
  const { rows } = await client.query(
    "SELECT name, niu, address, city FROM supplier_master WHERE supplier_id = $1 LIMIT 1",
    [supplierId],
  );
  return rows[0]
    ? { name: rows[0].name, niu: rows[0].niu, address: rows[0].address, city: rows[0].city }
    : { name: null, niu: null, address: null, city: null };
}

/* ── PO payments (10721, legacy po_mark_paid) ────────────────────────────── */
const insertPayment = (client, data) => insertOne(client, "purchase_order_payment", data);
async function listPayments(client, poId) {
  const { rows } = await client.query(
    "SELECT * FROM purchase_order_payment WHERE po_id = $1 ORDER BY paid_on, created_at",
    [poId],
  );
  return rows;
}
/** Σ of the payment children — the source of truth for amount_paid. */
async function paymentsTotal(client, poId) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM purchase_order_payment WHERE po_id = $1",
    [poId],
  );
  return Number(rows[0].total);
}
/** Has a supplier invoice against this PO reached the ledger? (unlock guard) */
async function postedInvoiceForPO(client, poId) {
  const { rows } = await client.query(
    "SELECT supplier_invoice_id, doc_number, status FROM supplier_invoice WHERE po_id = $1 AND status IN ('POSTED_LOCKED','PAID') LIMIT 1",
    [poId],
  );
  return rows[0] || null;
}

module.exports = { insertPO, getPO, insertItem, deleteItems, listItems, update, listPO, taxRateForItems, supplierSnapshot, insertPayment, listPayments, paymentsTotal, postedInvoiceForPO };
