"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");
const { directionLetter, formatCode } = require("./financial_dictionary.rules");

/* ── item + posting rules ──────────────────────────────────────────────────── */
const createItem = (c, d) => insertOne(c, "dictionary_item", d);
const createRule = (c, d) => insertOne(c, "posting_rule", d);
const updateItem = (c, id, patch) => updateOne(c, "dictionary_item", "dictionary_item_id", id, patch);
const getItem = (c, id) => getById(c, "dictionary_item", "dictionary_item_id", id);

/**
 * Mint the next code for a direction: "#<L><NNN>" (R/E/D/A + zero-padded serial).
 * The serial is the max numeric suffix already in use for that letter, +1, so it
 * never collides even with the mixed free-form codes some legacy rows still use.
 * Rolls past 3 digits automatically once a letter passes #_999.
 */
async function nextCode(c, direction) {
  const letter = directionLetter(direction);
  const { rows } = await c.query(
    `SELECT COALESCE(MAX((regexp_replace(code::text, '\\D', '', 'g'))::int), 0) AS maxn
       FROM dictionary_item WHERE code::text ~ $1`,
    [`^#${letter}[0-9]+$`],
  );
  const n = Number(rows[0] && rows[0].maxn ? rows[0].maxn : 0) + 1;
  return formatCode(direction, n);
}

/**
 * Posting rules resolved with account labels, so the 360 can show
 * "6271 — Customs & transit charges" without a second round-trip.
 */
async function listRules(c, id) {
  const { rows } = await c.query(
    `SELECT pr.*, da.label_fr AS debit_label, ca.label_fr AS credit_label,
            da.class AS debit_class, ca.class AS credit_class
       FROM posting_rule pr
       LEFT JOIN chart_of_accounts da ON da.code = pr.debit_account
       LEFT JOIN chart_of_accounts ca ON ca.code = pr.credit_account
      WHERE pr.dictionary_item_id = $1
      ORDER BY pr.applies_context`,
    [id],
  );
  return rows;
}
async function deleteRules(c, id) { await c.query("DELETE FROM posting_rule WHERE dictionary_item_id = $1", [id]); }

/* ── service-type tiers (the Basic/Advanced/Full mapping) ───────────────────── */
async function listTiers(c, id) {
  const { rows } = await c.query(
    `SELECT sti.service_type_id, sti.tier, sti.sort_order,
            st.key AS service_key, st.name_fr, st.name_en, st.territory
       FROM service_type_dictionary_item sti
       JOIN service_type st ON st.service_type_id = sti.service_type_id
      WHERE sti.dictionary_item_id = $1
      ORDER BY sti.tier, st.name_fr`,
    [id],
  );
  return rows;
}
async function replaceTiers(c, id, tiers) {
  await c.query("DELETE FROM service_type_dictionary_item WHERE dictionary_item_id = $1", [id]);
  for (const t of tiers) {
    await c.query(
      `INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (service_type_id, dictionary_item_id) DO UPDATE SET tier = EXCLUDED.tier, sort_order = EXCLUDED.sort_order`,
      [t.service_type_id, id, t.tier || "BASIC", t.sort_order ?? 100],
    );
  }
}

/* ── list with the new facets ──────────────────────────────────────────────── */
async function listItems(c, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.include_inactive === "true" || q.include_inactive === true) { /* all */ } else { wh.push("di.is_active = true"); }
  if (q.category) { params.push(q.category); wh.push("di.category = $" + params.length); }
  if (q.direction) { params.push(String(q.direction).toUpperCase()); wh.push("di.direction = $" + params.length); }
  if (q.applicability_mode) { params.push(String(q.applicability_mode).toUpperCase()); wh.push("di.applicability_mode = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    wh.push("(di.code::text ILIKE $" + params.length + " OR di.label_fr ILIKE $" + params.length + " OR di.label_en ILIKE $" + params.length + ")");
  }
  // Filter by a service type (and optionally a tier bundle: nested — BASIC ⊆
  // ADVANCED ⊆ FULL). rank lets "ADVANCED" pull BASIC+ADVANCED.
  let join = "";
  if (q.service_type_id) {
    params.push(q.service_type_id);
    join = "JOIN service_type_dictionary_item sti ON sti.dictionary_item_id = di.dictionary_item_id AND sti.service_type_id = $" + params.length;
    if (q.tier) {
      const rank = { BASIC: 1, ADVANCED: 2, FULL: 3 }[String(q.tier).toUpperCase()] || 3;
      wh.push("(CASE sti.tier WHEN 'BASIC' THEN 1 WHEN 'ADVANCED' THEN 2 ELSE 3 END) <= " + rank);
    }
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await c.query(
    `SELECT di.* FROM dictionary_item di ${join} ${where} ORDER BY di.code LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/* ── usage across the system (counts now; money rollups are PR2) ────────────── */
async function usageCounts(c, id) {
  const { rows } = await c.query(
    `SELECT
       (SELECT COUNT(*) FROM costing_line          WHERE dictionary_item_id = $1) AS costing_lines,
       (SELECT COUNT(*) FROM cash_request_line     WHERE dictionary_item_id = $1) AS cash_request_lines,
       (SELECT COUNT(*) FROM purchase_order_item   WHERE dictionary_item_id = $1) AS purchase_order_items,
       (SELECT COUNT(*) FROM invoice_line          WHERE dictionary_item_id = $1) AS invoice_lines,
       (SELECT COUNT(*) FROM supplier_invoice_line WHERE dictionary_item_id = $1) AS supplier_invoice_lines,
       (SELECT COUNT(*) FROM cost_entry            WHERE dictionary_item_id = $1) AS cost_entries,
       (SELECT COUNT(*) FROM expense_rate          WHERE dictionary_item_id = $1) AS expense_rates`,
    [id],
  );
  const r = rows[0] || {};
  const out = {};
  for (const k of Object.keys(r)) out[k] = Number(r[k]);
  return out;
}

/* ── dictionary_ref: the seeded-but-editable registry behind dropdowns ──────── */
async function listRefs(c, kind, includeInactive = false) {
  const wh = ["kind = $1"];
  if (!includeInactive) wh.push("is_active = true");
  const { rows } = await c.query(
    `SELECT * FROM dictionary_ref WHERE ${wh.join(" AND ")} ORDER BY sort_order, name_fr`,
    [kind],
  );
  return rows;
}
const createRef = (c, d) => insertOne(c, "dictionary_ref", d);
const updateRef = (c, id, patch) => updateOne(c, "dictionary_ref", "ref_id", id, patch);
const getRef = (c, id) => getById(c, "dictionary_ref", "ref_id", id);

module.exports = {
  createItem, createRule, updateItem, getItem, nextCode,
  listRules, deleteRules, listTiers, replaceTiers,
  listItems, usageCounts,
  listRefs, createRef, updateRef, getRef,
};
