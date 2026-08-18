/** Goods-received-note repository (MOD-61). All GRN SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertGRN = (client, data) => insertOne(client, "goods_received_note", data);
const getGRN = (client, id) => getById(client, "goods_received_note", "grn_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getGRN(client, id);
  return updateOne(client, "goods_received_note", "grn_id", id, fields, "*", null);
}
async function getForPO(client, poId) {
  const { rows } = await client.query("SELECT * FROM goods_received_note WHERE po_id = $1 ORDER BY created_at DESC", [poId]);
  return rows;
}
async function listGRN(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.po_id) { params.push(q.po_id); wh.push("grn.po_id = $" + params.length); }
  // Line count rides along so the list screen can show a Lines column without a
  // query per row (same shape as the cash-request list's total_budget).
  const { rows } = await client.query(
    `SELECT grn.*, grn.doc_number AS ref,
            COALESCE((SELECT COUNT(*) FROM goods_received_line grl WHERE grl.grn_id = grn.grn_id), 0)::int AS line_count
       FROM goods_received_note grn
      WHERE ${wh.join(" AND ")}
      ORDER BY grn.created_at DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}
// PO status peek (read-only; PO writes belong to the PO repo/service).
async function poStatus(client, poId) {
  const { rows } = await client.query("SELECT po_id, status, total_ttc, supplier_id, currency, entity_id, dossier_id FROM purchase_order WHERE po_id = $1", [poId]);
  return rows[0] || null;
}

/* ── received lines (10720) ─────────────────────────────────────────────── */
const insertLine = (client, data) => insertOne(client, "goods_received_line", data);
async function deleteLines(client, grnId) { await client.query("DELETE FROM goods_received_line WHERE grn_id = $1", [grnId]); }
async function listLines(client, grnId) {
  const { rows } = await client.query("SELECT * FROM goods_received_line WHERE grn_id = $1 ORDER BY grn_line_id", [grnId]);
  return rows;
}
/** Σ received per dictionary item across a PO's GRNs — the quantity the
 *  three-way match compares against ordered and invoiced. */
async function receivedQtyForPO(client, poId) {
  const { rows } = await client.query(
    `SELECT grl.dictionary_item_id, SUM(grl.received) AS received
       FROM goods_received_line grl
       JOIN goods_received_note grn ON grn.grn_id = grl.grn_id
      WHERE grn.po_id = $1
      GROUP BY grl.dictionary_item_id`,
    [poId],
  );
  const map = {};
  rows.forEach((r) => { map[r.dictionary_item_id] = Number(r.received) || 0; });
  return map;
}

/** The WMS inbound a procurement GRN was handed to, if any (10721). */
async function wmsInboundForGRN(client, grnId) {
  const { rows } = await client.query(
    "SELECT grn_inbound_id, qa_status, putaway_location FROM grn_inbound WHERE source_grn_id = $1 LIMIT 1",
    [grnId],
  );
  return rows[0] || null;
}

module.exports = { insertGRN, getGRN, update, getForPO, listGRN, poStatus, insertLine, deleteLines, listLines, receivedQtyForPO, wmsInboundForGRN };
