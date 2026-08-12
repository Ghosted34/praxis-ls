/** Operations file (dossier) repository (MOD-29). All dossier SQL lives here. */
"use strict";
const { insertOne, getById, page, TOTAL_COL, splitTotal, updateOne } = require("../../../shared/db/query-helpers");

/**
 * Every column of `dossier` a caller may write, and nothing else.
 *
 * WHY THIS EXISTS. `insertOne`/`updateOne` build their column list from
 * `Object.keys(data)`, and their identifier check only asks whether a key is a
 * legal SQL identifier — it has no idea what columns this table has. So when
 * two services passed `title` (a column `dossier` did not have until migration
 * 0508), the key sailed through the app and Postgres answered 42703 at the very
 * bottom of the stack: an unhandled 500 on `win({createDossier})`, and a
 * dead-lettered outbox row on `opportunity.won` that nobody saw. The
 * sales→operations handoff had never worked by either route.
 *
 * The zod validator already strips unknown keys on the REST and AI paths, but
 * BOTH broken call sites reached `service.create` directly, in process, with no
 * HTTP request anywhere near them. An allow-list here is the layer that covers
 * those: it lives next to the SQL, so it applies to every caller, and it turns
 * "column that does not exist" into a 422 naming the field instead of a
 * database error two layers down.
 *
 * Excludes `dossier_id` (the pk), `created_at` and `updated_at` (the last set
 * by `touch`, code-provided, and exempt from the list by design).
 */
const WRITABLE = new Set([
  "ref", "entity_id", "client_id", "service_type_id", "status", "title",
  "incoterm", "bl_mawb", "vessel_flight",
  "pol", "pod", "pol_place_id", "pod_place_id",
  "customs_regime", "eta", "ata", "details_json",
  // The CLIENT's promise, distinct from `eta` (the carrier's estimate). The
  // milestone engine schedules against this first — see 0650 and
  // milestone.service resolveTarget — so it has to be settable on the file.
  "promised_delivery_date",
  "owner_ops_id", "owner_sales_id",
  // The carrier this job moves on (MOD-10 rate_provider) — feeds every
  // costing line's expense-rate lookup for the dossier.
  "rate_provider_id",
]);

const insert = (client, data) => insertOne(client, "dossier", data, "*", WRITABLE);
const get = (client, id) => getById(client, "dossier", "dossier_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "dossier", "dossier_id", id, fields, "*", WRITABLE, { touch: "updated_at" });
}

/**
 * One page of dossiers, plus how many match the filter in total.
 *
 * `q` searches REF, CLIENT NAME, BL/MAWB and VESSEL — the four fields the
 * Operations screen's search box has always advertised ("Search by ref, client,
 * BL/MAWB, vessel…"). It used to match `ref` only, and the screen made up the
 * difference by filtering in the browser over whatever `page()` had already
 * truncated to 50 rows. On any tenant past its fiftieth dossier that search
 * could not find an older file and said "No operation files" instead — the same
 * shape of defect the Finance hub carried, and a correctness problem rather
 * than a performance one. The client-name join is LEFT so a dossier with no
 * client is still returned.
 *
 * `TOTAL_COL` is a `COUNT(*) OVER()` window function, so the count costs one
 * round trip and shares the WHERE clause rather than duplicating it.
 *
 * @returns {Promise<{rows: Array<object>, total: number}>}
 */
async function listPaged(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("d.entity_id = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("d.client_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("d.status = $" + params.length); }
  if (q.service_type_id) { params.push(q.service_type_id); wh.push("d.service_type_id = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const p = "$" + params.length;
    wh.push(`(d.ref ILIKE ${p} OR cm.name ILIKE ${p} OR d.bl_mawb ILIKE ${p} OR d.vessel_flight ILIKE ${p})`);
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const sql =
    `SELECT d.*, cm.name AS client_name, ${TOTAL_COL}, ` +
    "st.key AS service_key, st.name_en AS service_name_en, st.name_fr AS service_name_fr, st.territory AS service_territory, " +
    "rp.name AS rate_provider_name, rp.kind AS rate_provider_kind, " +
    "(SELECT COALESCE(SUM(cl.qty * cl.unit_cost), 0) FROM costing_line cl JOIN costing c ON c.costing_id = cl.costing_id WHERE c.dossier_id = d.dossier_id) AS costing_total, " +
    "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id) AS milestone_total, " +
    "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status = 'DONE') AS milestone_done, " +
    "(SELECT mi.label FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status IN ('IN_PROGRESS','PENDING') ORDER BY (mi.status = 'IN_PROGRESS') DESC, mi.stage_seq ASC LIMIT 1) AS current_milestone " +
    "FROM dossier d " +
    "LEFT JOIN client_master cm ON cm.client_id = d.client_id " +
    "LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
    "LEFT JOIN rate_provider rp ON rp.rate_provider_id = d.rate_provider_id " +
    where + " ORDER BY d.created_at DESC LIMIT $1 OFFSET $2";
  const { rows } = await client.query(sql, params);
  return splitTotal(rows);
}

/** Rows only. Kept because several callers (the AI adapter, the id→ref maps on
 *  other screens) want a bare array and have no use for the count. */
async function list(client, q = {}) {
  return (await listPaged(client, q)).rows;
}


/**
 * 360 aggregation for a dossier - a set of read-only rollups joining the
 * downstream modules that tag dossier_id (costing, invoices, receivables,
 * actual GL costs, milestones, procurement, transit & delivery docs).
 */
async function overview(client, dossierId) {
  const q = (sql) => client.query(sql, [dossierId]).then((r) => r.rows);

  const [costing] = await q(
    "SELECT COUNT(DISTINCT c.costing_id)::int AS count, " +
      "COALESCE(SUM(cl.qty * cl.unit_cost), 0) AS planned_cost, " +
      "COALESCE(SUM(cl.qty * cl.unit_cost) FILTER (WHERE NOT cl.is_disbursement), 0) AS planned_service_cost, " +
      "COALESCE(SUM(cl.qty * cl.unit_cost) FILTER (WHERE cl.is_disbursement), 0) AS planned_disbursement " +
      "FROM costing c LEFT JOIN costing_line cl ON cl.costing_id = c.costing_id WHERE c.dossier_id = $1",
  );
  const [actual] = await q("SELECT COUNT(*)::int AS entries, COALESCE(SUM(amount), 0) AS actual_cost FROM cost_entry WHERE dossier_id = $1");
  const [invoices] = await q(
    "SELECT COUNT(*)::int AS count, COALESCE(SUM(total_ttc), 0) AS invoiced_ttc, " +
      "COALESCE(SUM(total_ttc) FILTER (WHERE status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')), 0) AS billed_ttc, " +
      "COALESCE(SUM(service_ht) FILTER (WHERE status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')), 0) AS billed_service_ht, " +
      "COALESCE(SUM(disbursement_total) FILTER (WHERE status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')), 0) AS billed_disbursement, " +
      "COALESCE(SUM(vat_total) FILTER (WHERE status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')), 0) AS billed_vat " +
      "FROM invoice WHERE dossier_id = $1 AND type = 'FINAL'",
  );
  const [outstanding] = await q(
    "SELECT COALESCE(SUM(i.total_ttc - COALESCE(a.allocated, 0)), 0) AS outstanding " +
      "FROM invoice i LEFT JOIN (SELECT invoice_id, SUM(amount) AS allocated FROM payment_allocation GROUP BY invoice_id) a ON a.invoice_id = i.invoice_id " +
      "WHERE i.dossier_id = $1 AND i.type = 'FINAL' AND i.status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')",
  );
  const milestones = await q(
    "SELECT status, COUNT(*)::int AS n FROM milestone_instance WHERE dossier_id = $1 GROUP BY status",
  );
  const [procurement] = await q(
    "SELECT COUNT(*)::int AS po_count, COALESCE(SUM(total_ttc), 0) AS po_total FROM purchase_order WHERE dossier_id = $1",
  );
  const [transit] = await q("SELECT COUNT(*)::int AS count FROM transit_order WHERE dossier_id = $1");
  const [delivery] = await q("SELECT COUNT(*)::int AS count FROM delivery_note WHERE dossier_id = $1");

  // People (SoD): who issued/validated/approved on the money documents. Names are
  // joined in the SAME (env) schema — business rows FK app_user per schema, and the
  // sandbox seed mirrors identity users, so a missing mirror just yields null names.
  const [costingPeople] = await q(
    "SELECT c.status, c.doc_number, " +
      "uv.user_id AS validator_id, uv.full_name AS validator_name, " +
      "ua.user_id AS approver_id, ua.full_name AS approver_name " +
      "FROM costing c " +
      "LEFT JOIN app_user uv ON uv.user_id = c.validator_id " +
      "LEFT JOIN app_user ua ON ua.user_id = c.approver_id " +
      "WHERE c.dossier_id = $1 " +
      "ORDER BY (c.status = 'APPROVED_LOCKED') DESC, c.updated_at DESC LIMIT 1",
  );
  const [invoicePeople] = await q(
    "SELECT i.status, i.doc_number, " +
      "ui.user_id AS issuer_id, ui.full_name AS issuer_name, " +
      "uv.user_id AS validator_id, uv.full_name AS validator_name, " +
      "ua.user_id AS approver_id, ua.full_name AS approver_name " +
      "FROM invoice i " +
      "LEFT JOIN app_user ui ON ui.user_id = i.issued_by " +
      "LEFT JOIN app_user uv ON uv.user_id = i.validated_by " +
      "LEFT JOIN app_user ua ON ua.user_id = i.approved_by " +
      "WHERE i.dossier_id = $1 AND i.type = 'FINAL' " +
      "ORDER BY (i.status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')) DESC, i.updated_at DESC LIMIT 1",
  );

  // Document rows for the 360° Documents tab (counts above stay for back-compat).
  const transitRows = await q(
    "SELECT transit_order_id, ot_number AS ref, customs_regime, service_direction, declared_value, created_at " +
      "FROM transit_order WHERE dossier_id = $1 ORDER BY created_at DESC LIMIT 20",
  );
  const deliveryRows = await q(
    "SELECT delivery_note_id, doc_number AS ref, consignee, city_zone, created_at " +
      "FROM delivery_note WHERE dossier_id = $1 ORDER BY created_at DESC LIMIT 20",
  );
  const vaultRows = await q(
    "SELECT doc_id, doc_type, status, entity_ref, version_no, created_at " +
      "FROM document_vault WHERE dossier_id = $1 AND status <> 'ARCHIVED' ORDER BY created_at DESC LIMIT 20",
  );
  const invoiceRows = await q(
    "SELECT invoice_id, doc_number AS ref, status, total_ttc, type, created_at " +
      "FROM invoice WHERE dossier_id = $1 ORDER BY created_at DESC LIMIT 20",
  );

  return {
    costing, actual, invoices, outstanding, milestones, procurement, transit, delivery,
    people: { costing: costingPeople || null, invoice: invoicePeople || null },
    documentRows: { invoices: invoiceRows, transit: transitRows, delivery: deliveryRows, vault: vaultRows },
  };
}

// WRITABLE is exported for tests/unit/dossier-columns.test.js, which reconciles
// it against the columns the migrations actually declare. That test is the link
// between this file and the schema — the link whose absence let `title` be
// written for months against a column that did not exist.
module.exports = { insert, get, update, list, listPaged, overview, WRITABLE };
