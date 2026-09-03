/** Costing repository (MOD-46). costing + costing_line SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "costing", data);
const get = (client, id) => getById(client, "costing", "costing_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "costing", "costing_id", id, fields, "*", null, { touch: "updated_at" });
}
async function deleteLines(client, costingId) { await client.query("DELETE FROM costing_line WHERE costing_id = $1", [costingId]); }
function insertLine(client, data) { return insertOne(client, "costing_line", data); }
// The reader needs the container name to display without a second round-trip,
// and (§2.2) the line's own VAT rate so totals are HT / VAT / TTC — the rate
// comes from the line's tax code, never a hardcoded number. LEFT JOINs because
// most lines have no equipment dimension and DRAFT lines may carry no tax code;
// a deactivated type must still render its name on a five-year-old sheet.
//
// `di` (12766) rides along so a reader knows whether the line's pass-through
// nature and its VAT were DERIVED from the catalogue or overridden by hand, and
// whether its disbursement should disclose upstream VAT — none of which can be
// re-derived from the line alone once the catalogue moves on.
const LINE_SELECT =
  "SELECT cl.*, dr.code AS container_type_code, dr.name_en AS container_type_en, " +
  "dr.name_fr AS container_type_fr, dr.extra AS container_type_extra, " +
  "tc.rate_percent AS tax_rate_percent, tc.code AS tax_code, " +
  "di.code AS item_code, di.unit_of_measure, di.subcategory, " +
  "di.disbursement_vat_transparent, di.varies_by_equipment " +
  "FROM costing_line cl LEFT JOIN dictionary_ref dr ON dr.ref_id = cl.container_type_ref_id " +
  "LEFT JOIN tax_code tc ON tc.tax_code_id = cl.tax_code_id " +
  "LEFT JOIN dictionary_item di ON di.dictionary_item_id = cl.dictionary_item_id ";
async function listLines(client, costingId) {
  // 12766: `line_no` is the sheet's order. This used to read by
  // `costing_line_id` — a uuid — so the order was arbitrary AND changed on every
  // save, because replaceLines deletes and re-inserts with fresh uuids.
  const { rows } = await client.query(
    LINE_SELECT + "WHERE cl.costing_id = $1 ORDER BY cl.line_no, cl.costing_line_id",
    [costingId],
  );
  return rows;
}

/**
 * The registry query — search, status, period, dossier, with the true match
 * count alongside the page.
 *
 * Legacy's list.php took a text search across ref/file/client and a period
 * filter and reported a real total (`list.php:20-130`); ours took `dossier_id`
 * and `status` and nothing else, returned `SELECT *`, and had no money on the
 * row to show because the totals did not exist as columns until 12766.
 *
 * `TOTAL_COL` rather than a second COUNT query: one round trip, one WHERE
 * clause, and no chance of the two copies drifting.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("c.dossier_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("c.status = $" + params.length); }
  if (q.currency) { params.push(String(q.currency).toUpperCase()); wh.push("c.currency = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    // Doc number, the file's own reference, and the client's name — the three
    // things anyone actually has to hand when looking for a sheet.
    wh.push(
      "(c.doc_number ILIKE $" + params.length +
      " OR d.ref ILIKE $" + params.length +
      " OR cm.name ILIKE $" + params.length + ")",
    );
  }
  // Period is bounded on the SHEET's own date, not created_at: a costing drafted
  // in March for a file that ships in June belongs to March's register.
  if (q.from) { params.push(q.from); wh.push("c.created_at >= $" + params.length); }
  if (q.to) { params.push(q.to); wh.push("c.created_at < ($" + params.length + "::date + 1)"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT c.*, d.ref AS dossier_ref, cm.name AS client_name, " +
      "st.key AS service_type_key, st.name_en AS service_name_en, st.name_fr AS service_name_fr, " +
      TOTAL_COL + " " +
      "FROM costing c " +
      "LEFT JOIN dossier_visible d ON d.dossier_id = c.dossier_id " +
      "LEFT JOIN client_master cm ON cm.client_id = d.client_id " +
      "LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
      where + " ORDER BY c.created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return splitTotal(rows);
}

/**
 * The KPI strip, aggregated over the SAME filter the page used.
 *
 * Legacy called this its "shadow query" and it is the right shape: counts and
 * money computed in SQL over every matching row, not over the 50 the page
 * happens to hold. Ours had no equivalent — the client counted the rows it had
 * been given, so "Approved: 3" meant "3 on this page".
 *
 * Money aggregates on `total_ttc_xaf` only. Summing `total_ttc` would add a USD
 * sheet to an XAF one.
 */
async function kpis(client, q = {}) {
  const params = [];
  const wh = [];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("c.dossier_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("c.status = $" + params.length); }
  if (q.currency) { params.push(String(q.currency).toUpperCase()); wh.push("c.currency = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    wh.push(
      "(c.doc_number ILIKE $" + params.length +
      " OR d.ref ILIKE $" + params.length +
      " OR cm.name ILIKE $" + params.length + ")",
    );
  }
  if (q.from) { params.push(q.from); wh.push("c.created_at >= $" + params.length); }
  if (q.to) { params.push(q.to); wh.push("c.created_at < ($" + params.length + "::date + 1)"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS total, " +
      "COUNT(*) FILTER (WHERE c.status = 'DRAFT')::int AS draft, " +
      "COUNT(*) FILTER (WHERE c.status = 'SUBMITTED_FOR_VALIDATION')::int AS to_validate, " +
      "COUNT(*) FILTER (WHERE c.status = 'SUBMITTED_FOR_APPROVAL')::int AS to_approve, " +
      "COUNT(*) FILTER (WHERE c.status = 'APPROVED_LOCKED')::int AS approved, " +
      "COUNT(*) FILTER (WHERE c.status = 'UNLOCK_REQUESTED')::int AS unlock_requested, " +
      "COALESCE(SUM(c.total_ttc_xaf), 0) AS total_ttc_xaf " +
      "FROM costing c " +
      "LEFT JOIN dossier_visible d ON d.dossier_id = c.dossier_id " +
      "LEFT JOIN client_master cm ON cm.client_id = d.client_id " + where,
    params,
  );
  const r = rows[0] || {};
  return {
    total: Number(r.total || 0),
    draft: Number(r.draft || 0),
    to_validate: Number(r.to_validate || 0),
    to_approve: Number(r.to_approve || 0),
    approved: Number(r.approved || 0),
    unlock_requested: Number(r.unlock_requested || 0),
    total_ttc_xaf: Number(r.total_ttc_xaf || 0),
  };
}

/**
 * The one live costing on a file, if there is one.
 *
 * REJECTED is excluded for the same reason `uq_costing_one_live_per_dossier`
 * excludes it: a rejected sheet is dead and must not present itself as the
 * file's costing. Used to turn the unique-index violation into a sentence that
 * names the sheet already there.
 */
async function liveForDossier(client, dossierId) {
  const { rows } = await client.query(
    "SELECT costing_id, doc_number, status FROM costing " +
      "WHERE dossier_id = $1 AND status <> 'REJECTED' LIMIT 1",
    [dossierId],
  );
  return rows[0] || null;
}

/* ── the approval snapshot (12766) ─────────────────────────────────────────── */

function insertSnapshot(client, data) {
  return insertOne(client, "costing_approval_snapshot", data);
}

/** The most recent approval, or null for a sheet never approved. */
async function latestSnapshot(client, costingId) {
  const { rows } = await client.query(
    "SELECT * FROM costing_approval_snapshot WHERE costing_id = $1 ORDER BY approved_at DESC LIMIT 1",
    [costingId],
  );
  return rows[0] || null;
}

async function snapshotCount(client, costingId) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM costing_approval_snapshot WHERE costing_id = $1",
    [costingId],
  );
  return Number((rows[0] || {}).n || 0);
}

/* ── reads the suggest builder needs (12766) ───────────────────────────────── */

/**
 * The file, with everything a costing needs to price itself: which service it
 * is (so the tiers resolve), which carrier is confirmed (so the rate cascade
 * has a scope), and the cargo figures the quantity drivers read.
 */
async function dossierForCosting(client, dossierId) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.entity_id, d.client_id, d.service_type_id,
            d.rate_provider_id, d.gross_weight, d.weight_unit, d.package_count,
            d.volume_cbm,
            cm.name AS client_name,
            st.key AS service_type_key, st.name_en AS service_name_en, st.name_fr AS service_name_fr,
            rp.name AS rate_provider_name
       FROM dossier_visible d
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
       LEFT JOIN service_type st ON st.service_type_id = d.service_type_id
       LEFT JOIN rate_provider rp ON rp.rate_provider_id = d.rate_provider_id
      WHERE d.dossier_id = $1`,
    [dossierId],
  );
  return rows[0] || null;
}

/**
 * The tiered charge set for a service type — the query that has existed in
 * `financial_dictionary.repo.listItems` since 0630 and has never been reachable
 * from any route.
 *
 * Tiers NEST: asking for ADVANCED yields BASIC + ADVANCED. `tier` rides along
 * on every row so the picker can band them, which is why this is not simply
 * `listItems({ service_type_id, tier })` — that one returns the items and drops
 * which band each came from.
 */
async function tieredItems(client, { serviceTypeId, tier = "FULL" }) {
  const rank = { BASIC: 1, ADVANCED: 2, FULL: 3 }[String(tier).toUpperCase()] || 3;
  const { rows } = await client.query(
    `SELECT di.dictionary_item_id, di.code, di.label_en, di.label_fr, di.description,
            di.direction, di.category, di.subcategory, di.unit_of_measure,
            di.is_disbursement, di.is_billable, di.varies_by_equipment,
            di.disbursement_vat_transparent, di.default_price, di.currency,
            sti.tier, sti.sort_order
       FROM service_type_dictionary_item sti
       JOIN dictionary_item di ON di.dictionary_item_id = sti.dictionary_item_id
      WHERE sti.service_type_id = $1
        AND di.is_active = true
        AND (CASE sti.tier WHEN 'BASIC' THEN 1 WHEN 'ADVANCED' THEN 2 ELSE 3 END) <= $2
      ORDER BY sti.sort_order, di.code`,
    [serviceTypeId, rank],
  );
  return rows;
}

/**
 * The file's equipment, one row per container TYPE with its count.
 *
 * This is what drives quantity on an equipment-varying charge, and it is the
 * same table `marksFromContainers` renders `01*45'HC, 01*40'HC` from — so the
 * costing and the file's marks line can never disagree about what is shipping.
 * A file may hold one type on two lines (different load modes); a charge cares
 * only about the type, so the counts add.
 */
async function containerTypesOnFile(client, dossierId) {
  const { rows } = await client.query(
    `SELECT l.container_type_ref_id,
            SUM(l.qty)::int AS qty,
            MIN(l.seq) AS seq,
            dr.code AS container_type_code,
            dr.name_en AS container_type_en,
            dr.name_fr AS container_type_fr,
            dr.extra AS container_type_extra
       FROM dossier_container_line l
       JOIN dictionary_ref dr ON dr.ref_id = l.container_type_ref_id
      WHERE l.dossier_id = $1
      GROUP BY l.container_type_ref_id, dr.code, dr.name_en, dr.name_fr, dr.extra
      ORDER BY MIN(l.seq)`,
    [dossierId],
  );
  return rows;
}

/**
 * Every expense rate for a set of dictionary items, in one round trip.
 *
 * The suggest builder prices up to ~30 lines. Calling `expense_rate.resolve`
 * per line is 30 queries against the same small table; the cascade itself is
 * pure (`expense_rate.rules.pickRate`), so the rows are fetched once and the
 * cascade applied in memory.
 */
async function ratesForItems(client, itemIds) {
  if (!itemIds || !itemIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT expense_rate_id, dictionary_item_id, rate_provider_id, container_type_ref_id,
            rate, currency, effective_from, effective_to, note
       FROM expense_rate
      WHERE dictionary_item_id = ANY($1::uuid[])`,
    [itemIds],
  );
  const byItem = new Map();
  for (const r of rows) {
    if (!byItem.has(r.dictionary_item_id)) byItem.set(r.dictionary_item_id, []);
    byItem.get(r.dictionary_item_id).push(r);
  }
  return byItem;
}

/**
 * The sales VAT code this entity should default to, at this date.
 *
 * Three layers, and only reading all three gives the right answer (Q24):
 * `entity_tax_registration` says whether this corporate entity is registered
 * for VAT at all and under which regime — a FRANCHISE entity charges none — and
 * `tax_code` holds the versioned rate, so a Finance Law change is a new row
 * rather than a rewrite of history.
 *
 * Returns null when the entity is not VAT-registered, is on FRANCHISE, or no
 * code is effective. Null means "offer no VAT", which is a correct answer and
 * not a failure.
 */
async function defaultSalesTaxCode(client, { entityId, onDate }) {
  if (!entityId) return null;
  const { rows } = await client.query(
    `SELECT tc.tax_code_id, tc.code, tc.rate_percent, etr.regime
       FROM entity_tax_registration etr
       JOIN tax_code tc
         ON tc.jurisdiction_id = etr.jurisdiction_id
        AND tc.kind = 'VAT'
        AND (tc.applies_to IS NULL OR tc.applies_to = 'sales')
        AND tc.effective_from <= $2::date
        AND (tc.effective_to IS NULL OR tc.effective_to >= $2::date)
      WHERE etr.entity_id = $1
        AND etr.tax_kind = 'VAT'
        AND etr.is_active = true
        AND COALESCE(etr.regime, '') <> 'FRANCHISE'
        AND (etr.deregistered_on IS NULL OR etr.deregistered_on >= $2::date)
      ORDER BY etr.is_primary DESC, tc.effective_from DESC
      LIMIT 1`,
    [entityId, onDate],
  );
  return rows[0] || null;
}

module.exports = {
  insert, get, update, deleteLines, insertLine, listLines, list, kpis,
  liveForDossier, insertSnapshot, latestSnapshot, snapshotCount,
  dossierForCosting, tieredItems, containerTypesOnFile, ratesForItems, defaultSalesTaxCode,
};
