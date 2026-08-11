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
 * The shared finder's query (MOD-05). One endpoint behind one component, used
 * from costing, quotation, cash request, supplier invoice and the dictionary
 * itself — so "what is this charge called in the system?" has one answer
 * everywhere.
 *
 * WHY THIS IS NOT `listItems({ q })`. That one is `ILIKE '%q%'` over code +
 * label_fr + label_en: it finds nothing unless you already know roughly what
 * the catalogue calls the thing. Operations staff do not. They type
 * "surestarie" for Demurrage, "demurage" with one r, "gasoil" for Fuel, "BAD"
 * for the delivery order, or the legacy "#-1119" off a filed document.
 *
 * Four matchers, unioned, then ranked:
 *   1. an exact keyword hit (`keywords &&`) — the alternates seeded in 9081,
 *      including every superseded and legacy code. Indexed GIN, and the
 *      strongest signal there is, so it outranks everything.
 *   2. a code prefix/substring — someone pasting a code wants that line.
 *   3. a plain substring on either label — the old behaviour, kept.
 *   4. trigram similarity over label_fr / label_en / description, which is what
 *      survives a typo. `%` uses pg_trgm's threshold and the GIN indexes from
 *      0633.
 *
 * `similarity()` and `%` are unqualified: pg_trgm lives in `public` (0504) and
 * the runtime search_path is `<schema>, public` (middleware/tenant-context).
 *
 * Inactive lines are excluded unless asked for — a superseded duplicate must
 * stop appearing in pickers while staying readable on the documents that
 * already reference it.
 */
async function searchItems(c, { q, limit = 20, service_type_id = null, direction = null, include_inactive = false } = {}) {
  const term = String(q || "").trim();
  if (!term) return [];
  const params = [term, term.toLowerCase(), Math.min(Number(limit) || 20, 50)];
  const wh = [];
  if (!include_inactive) wh.push("di.is_active = true");
  if (direction) { params.push(String(direction).toUpperCase()); wh.push(`di.direction = $${params.length}`); }
  let join = "";
  if (service_type_id) {
    params.push(service_type_id);
    join = `JOIN service_type_dictionary_item sti
              ON sti.dictionary_item_id = di.dictionary_item_id
             AND sti.service_type_id = $${params.length}`;
  }
  const { rows } = await c.query(
    `SELECT di.dictionary_item_id, di.code, di.label_fr, di.label_en, di.description,
            di.direction, di.category, di.subcategory, di.unit_of_measure,
            di.is_disbursement, di.is_billable, di.varies_by_equipment, di.is_active,
            GREATEST(
              CASE WHEN di.keywords && ARRAY[$2] THEN 1.0 ELSE 0 END,
              CASE WHEN di.code::text ILIKE '%' || $1 || '%' THEN 0.95 ELSE 0 END,
              similarity(di.label_en, $1), similarity(di.label_fr, $1),
              similarity(COALESCE(di.description, ''), $1) * 0.6
            ) AS score
       FROM dictionary_item di ${join}
      ${wh.length ? "WHERE " + wh.join(" AND ") + " AND" : "WHERE"} (
            di.keywords && ARRAY[$2]
         OR di.code::text ILIKE '%' || $1 || '%'
         OR di.label_en ILIKE '%' || $1 || '%'
         OR di.label_fr ILIKE '%' || $1 || '%'
         OR di.label_en % $1 OR di.label_fr % $1 OR COALESCE(di.description, '') % $1)
      ORDER BY score DESC, di.label_en
      LIMIT $3`,
    params,
  );
  return rows;
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

/* ── SPEND OVER A PERIOD — three lenses, one item, grouped by month ─────────
 *
 * Each lens reads the document that owns that stage of the money, and dates it
 * by the field that stage is actually keyed on. Getting the DATE right matters
 * more than the amount: a costing drafted in March for a job posted in June
 * belongs in March's estimate and June's actual, and a naive created_at on all
 * three would pile the whole story into one month.
 *
 *   estimated  costing_line.qty * unit_cost, dated by its costing.created_at
 *   committed  purchase_order_item (qty * unit_price) on a non-CANCELLED PO,
 *              dated by the PO; PLUS cash_request_line.budget_amount on a
 *              SUBMITTED/APPROVED (or later) cash request
 *   actual     cost_entry.amount, dated by the journal_entry's entry_date —
 *              the REAL posting date — falling back to cost_entry.created_at
 *              when the entry is missing (a cost recorded outside a posting).
 *
 * All three are `>= from AND < to + 1 day` so an inclusive `to` really includes
 * that whole day regardless of the column's timestamptz/date type.
 */
const MONTH = (expr) => `to_char((${expr})::date, 'YYYY-MM')`;

async function spendEstimated(c, id, from, to) {
  const { rows } = await c.query(
    `SELECT ${MONTH("co.created_at")} AS month,
            COALESCE(SUM(cl.qty * cl.unit_cost), 0) AS amount,
            COUNT(*) AS count
       FROM costing_line cl
       JOIN costing co ON co.costing_id = cl.costing_id
      WHERE cl.dictionary_item_id = $1
        AND co.created_at >= $2::date AND co.created_at < ($3::date + 1)
      GROUP BY 1 ORDER BY 1`,
    [id, from, to],
  );
  return rows;
}

async function spendCommitted(c, id, from, to) {
  const { rows } = await c.query(
    `SELECT month, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(cnt), 0) AS count FROM (
       SELECT ${MONTH("po.created_at")} AS month, SUM(poi.qty * poi.unit_price) AS amount, COUNT(*) AS cnt
         FROM purchase_order_item poi
         JOIN purchase_order po ON po.po_id = poi.po_id
        WHERE poi.dictionary_item_id = $1
          AND po.status <> 'CANCELLED'
          AND po.created_at >= $2::date AND po.created_at < ($3::date + 1)
        GROUP BY 1
       UNION ALL
       SELECT ${MONTH("cr.created_at")} AS month, SUM(crl.budget_amount) AS amount, COUNT(*) AS cnt
         FROM cash_request_line crl
         JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
        WHERE crl.dictionary_item_id = $1
          AND cr.status IN ('SUBMITTED','APPROVED','DISBURSED','JUSTIFIED')
          AND cr.created_at >= $2::date AND cr.created_at < ($3::date + 1)
        GROUP BY 1
     ) u GROUP BY month ORDER BY month`,
    [id, from, to],
  );
  return rows;
}

async function spendActual(c, id, from, to) {
  const { rows } = await c.query(
    `SELECT ${MONTH("COALESCE(je.entry_date, ce.created_at)")} AS month,
            COALESCE(SUM(ce.amount), 0) AS amount,
            COUNT(*) AS count
       FROM cost_entry ce
       LEFT JOIN journal_entry je ON je.entry_id = ce.entry_id
      WHERE ce.dictionary_item_id = $1
        AND COALESCE(je.entry_date, ce.created_at::date) >= $2::date
        AND COALESCE(je.entry_date, ce.created_at::date) <= $3::date
      GROUP BY 1 ORDER BY 1`,
    [id, from, to],
  );
  return rows;
}

/**
 * The documents behind the numbers — what a drill-in opens.
 *
 * Deliberately capped and ordered newest-first rather than paged: this is the
 * "show me the receipts" list under a chart, not a browsable ledger. The module
 * that owns each document is where a user goes to page through them, and each
 * row carries the ref the deep-link needs.
 */
async function spendDocuments(c, id, from, to, limit = 100) {
  const { rows } = await c.query(
    `SELECT * FROM (
       SELECT 'estimated' AS lens, 'costing' AS doc_type, co.costing_id AS doc_id,
              co.doc_number, co.status, co.dossier_id, d.ref AS dossier_ref,
              (cl.qty * cl.unit_cost) AS amount, co.currency, co.created_at::date AS doc_date, cl.label
         FROM costing_line cl
         JOIN costing co ON co.costing_id = cl.costing_id
         LEFT JOIN dossier d ON d.dossier_id = co.dossier_id
        WHERE cl.dictionary_item_id = $1 AND co.created_at >= $2::date AND co.created_at < ($3::date + 1)
       UNION ALL
       SELECT 'committed', 'purchase_order', po.po_id, po.doc_number, po.status, po.dossier_id, d.ref,
              (poi.qty * poi.unit_price), NULL, po.created_at::date, poi.label
         FROM purchase_order_item poi
         JOIN purchase_order po ON po.po_id = poi.po_id
         LEFT JOIN dossier d ON d.dossier_id = po.dossier_id
        WHERE poi.dictionary_item_id = $1 AND po.status <> 'CANCELLED'
          AND po.created_at >= $2::date AND po.created_at < ($3::date + 1)
       UNION ALL
       SELECT 'committed', 'cash_request', cr.cash_request_id, cr.doc_number, cr.status, cr.dossier_id, d.ref,
              crl.budget_amount, NULL, cr.created_at::date, crl.label
         FROM cash_request_line crl
         JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
         LEFT JOIN dossier d ON d.dossier_id = cr.dossier_id
        WHERE crl.dictionary_item_id = $1 AND cr.status IN ('SUBMITTED','APPROVED','DISBURSED','JUSTIFIED')
          AND cr.created_at >= $2::date AND cr.created_at < ($3::date + 1)
       UNION ALL
       SELECT 'actual', 'cost_entry', ce.cost_entry_id, je.source_doc_ref, je.status, ce.dossier_id, d.ref,
              ce.amount, NULL, COALESCE(je.entry_date, ce.created_at::date), ce.category
         FROM cost_entry ce
         LEFT JOIN journal_entry je ON je.entry_id = ce.entry_id
         LEFT JOIN dossier d ON d.dossier_id = ce.dossier_id
        WHERE ce.dictionary_item_id = $1
          AND COALESCE(je.entry_date, ce.created_at::date) >= $2::date
          AND COALESCE(je.entry_date, ce.created_at::date) <= $3::date
     ) docs ORDER BY doc_date DESC, lens LIMIT $4`,
    [id, from, to, limit],
  );
  return rows;
}

/* ── COST EVOLUTION — the effective-dated rate history per item + provider ─── */
async function rateHistory(c, id) {
  const { rows } = await c.query(
    `SELECT er.*, rp.name AS provider_name, rp.kind AS provider_kind_resolved,
            ct.code AS container_type_code, COALESCE(ct.name_en, ct.name_fr) AS container_type_name
       FROM expense_rate er
       LEFT JOIN rate_provider rp ON rp.rate_provider_id = er.rate_provider_id
       LEFT JOIN dictionary_ref ct ON ct.ref_id = er.container_type_ref_id
      WHERE er.dictionary_item_id = $1
      ORDER BY er.effective_from ASC, er.created_at ASC`,
    [id],
  );
  return rows;
}
/** The open (never-expired) rate for one provider/container-type series. */
async function openRate(c, id, { rateProviderId = null, containerTypeRefId = null }) {
  const { rows } = await c.query(
    `SELECT * FROM expense_rate
      WHERE dictionary_item_id = $1
        AND effective_to IS NULL
        AND rate_provider_id IS NOT DISTINCT FROM $2
        AND container_type_ref_id IS NOT DISTINCT FROM $3
      ORDER BY effective_from DESC LIMIT 1`,
    [id, rateProviderId, containerTypeRefId],
  );
  return rows[0] || null;
}
const insertRate = (c, d) => insertOne(c, "expense_rate", d);
const expireRate = (c, rateId, effectiveTo) =>
  updateOne(c, "expense_rate", "expense_rate_id", rateId, { effective_to: effectiveTo });

/* ── IMPORT — the reference data a row is validated against ─────────────────
 * One round-trip per catalogue rather than one per row: a 500-row upload
 * validated row-by-row would be 1500 lookups against three small tables. */
async function postableAccounts(c) {
  const { rows } = await c.query(
    "SELECT code, label_fr, class FROM chart_of_accounts WHERE is_postable = true AND is_active IS DISTINCT FROM false ORDER BY code",
  );
  return rows;
}
async function taxCodeIndex(c) {
  const { rows } = await c.query("SELECT tax_code_id, code, rate_percent FROM tax_code ORDER BY code");
  return rows;
}
async function serviceTypeIndex(c) {
  const { rows } = await c.query("SELECT service_type_id, key, name_fr, name_en FROM service_type WHERE is_active ORDER BY key");
  return rows;
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
  listItems, searchItems, usageCounts,
  spendEstimated, spendCommitted, spendActual, spendDocuments,
  rateHistory, openRate, insertRate, expireRate,
  postableAccounts, taxCodeIndex, serviceTypeIndex,
  listRefs, createRef, updateRef, getRef,
};
