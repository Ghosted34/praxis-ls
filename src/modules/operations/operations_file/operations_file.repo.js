/** Operations file (dossier) repository (MOD-29). All dossier SQL lives here. */
"use strict";
const { insertOne, getById, page, TOTAL_COL, splitTotal, updateOne } = require("../../../shared/db/query-helpers");
const { normaliseReference } = require("../../../services/documents/operation-reference");

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
  // Cargo, promoted onto the dossier by 0660 because every service type has it
  // and every printed document reads it. Written through the shipment-details
  // service (a field definition binds to the column), never typed in by hand.
  "commodity", "commodity_desc", "gross_weight", "weight_unit",
  "package_count", "volume_cbm", "marks_numbers", "place_receipt", "place_delivery",
  // Marks & numbers is GENERATED from the file's containers on every equipment
  // write (0670), the way legacy did it. This flag is the override: set when
  // somebody types over the field, and it stops the regeneration from
  // discarding what they wrote. Set by the shipment-details service, never
  // typed in.
  "marks_numbers_is_manual",
  // When the creation wizard opened this as a DRAFT (0671), so the sweeper can
  // find one nobody came back to finish. Written by `createDraft`, never by a
  // caller's payload — but it goes through the same insert, so it must be here.
  "draft_started_at",
  // Which VERSION of its service type's detail form this file was created
  // against. Set once, on create; it is what keeps an open file rendering and
  // validating against the form it was opened with after the form is
  // republished (0660).
  "service_type_field_set_id",
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
    const clauses = [`d.ref ILIKE ${p}`, `cm.name ILIKE ${p}`, `d.bl_mawb ILIKE ${p}`, `d.vessel_flight ILIKE ${p}`];
    // Operation references are STORED without separators (`SL7Z3K9QW2M4XBSM`)
    // and DISPLAYED with them (`SL-7Z3K9QW2M4XB-SM`), so the form a person
    // copies off a screen or an email is not the form the column holds and the
    // ILIKE above cannot match it. This adds the canonical spelling as an exact
    // alternative — only when normalising actually changed something, so the
    // ordinary search still costs one parameter.
    const canonical = normaliseReference(q.q);
    if (canonical && canonical !== String(q.q).trim().toUpperCase()) {
      params.push(canonical);
      clauses.push(`upper(d.ref) = $${params.length}`);
    }
    wh.push("(" + clauses.join(" OR ") + ")");
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
    "FROM dossier_visible d " +
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

  /*
   * The file's BUDGET — and two defects fixed in 12766.
   *
   * IT SUMMED EVERY COSTING ON THE FILE, whatever its status. A rejected sheet
   * beside its replacement, or a draft beside the approved one, double-counted
   * the budget — so budget-vs-actual was wrong on exactly the files somebody
   * had had to re-cost. `uq_costing_one_live_per_dossier` now makes at most one
   * costing live, and `status <> 'REJECTED'` is what "live" means.
   *
   * AND IT IGNORED CURRENCY, adding a USD sheet's raw line amounts to an XAF
   * one's. `service_type.repo.moneyRollup` grouped by currency and therefore
   * reported a DIFFERENT figure for the same money. Converting at the costing's
   * own stored rate — the rate its approver saw — is the answer both should
   * have been giving; `exchange_rate_to_xaf` is NOT NULL DEFAULT 1, so an
   * XAF sheet is unaffected.
   */
  const [costing] = await q(
    "SELECT COUNT(DISTINCT c.costing_id)::int AS count, " +
      "COALESCE(SUM(cl.qty * cl.unit_cost * c.exchange_rate_to_xaf), 0) AS planned_cost, " +
      "COALESCE(SUM(cl.qty * cl.unit_cost * c.exchange_rate_to_xaf) FILTER (WHERE NOT cl.is_disbursement), 0) AS planned_service_cost, " +
      "COALESCE(SUM(cl.qty * cl.unit_cost * c.exchange_rate_to_xaf) FILTER (WHERE cl.is_disbursement), 0) AS planned_disbursement " +
      "FROM costing c LEFT JOIN costing_line cl ON cl.costing_id = c.costing_id " +
      "WHERE c.dossier_id = $1 AND c.status <> 'REJECTED'",
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
  // TRUE counts for the vault and the query tickets, not `documentRows.length`.
  // The row lists below are capped at 20, so counting them is a number that is
  // right until a busy file makes it silently wrong — and the 360's tab strip
  // publishes these as "Documents 24 / Queries 3". A count that lies is worse
  // than no count, so it is counted rather than measured. Archived scans are
  // excluded on the same reasoning `vaultDocuments` excludes them: an archived
  // document is no longer evidence.
  const [vault] = await q("SELECT COUNT(*)::int AS count FROM document_vault WHERE dossier_id = $1 AND status <> 'ARCHIVED'");
  const [queries] = await q(
    "SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE status <> 'RESOLVED')::int AS open FROM q_ticket WHERE dossier_id = $1",
  );

  // People (SoD): who issued/validated/approved on the money documents. Names are
  // joined in the SAME (env) schema — business rows FK app_user per schema, and the
  // sandbox seed mirrors identity users, so a missing mirror just yields null names.
  // 12766: `costing_id` rides along so the 360 can LINK to the sheet. It could
  // not before — the block returned a count and a number, so the one screen
  // that tells you a file has a costing was the one place you could not open
  // it. The totals come too, so the card shows HT/VAT/TTC without a second
  // fetch. `validated_by` is who actually validated; `validator_id` is who it
  // was addressed to, and they are not always the same person.
  const [costingPeople] = await q(
    "SELECT c.costing_id, c.status, c.doc_number, c.currency, " +
      "c.total_ht, c.total_vat, c.total_ttc, c.total_ttc_xaf, " +
      "c.validated_at, c.approved_at, " +
      "uv.user_id AS validator_id, uv.full_name AS validator_name, " +
      "ud.user_id AS validated_by_id, ud.full_name AS validated_by_name, " +
      "ua.user_id AS approver_id, ua.full_name AS approver_name " +
      "FROM costing c " +
      "LEFT JOIN app_user uv ON uv.user_id = c.validator_id " +
      "LEFT JOIN app_user ud ON ud.user_id = c.validated_by " +
      "LEFT JOIN app_user ua ON ua.user_id = c.approver_id " +
      "WHERE c.dossier_id = $1 AND c.status <> 'REJECTED' " +
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
    costing, actual, invoices, outstanding, milestones, procurement, transit, delivery, vault, queries,
    people: { costing: costingPeople || null, invoice: invoicePeople || null },
    documentRows: { invoices: invoiceRows, transit: transitRows, delivery: deliveryRows, vault: vaultRows },
  };
}

/**
 * What the ids on a file MEAN — client name, service-type names and milestone
 * progress, for one file.
 *
 * The 360's header used to carry ids only, which was fine while the only thing
 * rendering it was a modal opened from the list: the row was already in hand,
 * so the screen knew the client name and the service label without asking. The
 * 360 is a PAGE now, reachable from a pasted link with nothing but a uuid, and
 * a header reading "Operations file · SBX-2026-0001 · undefined" is what that
 * costs. One extra query on a request that already makes a dozen.
 *
 * Deliberately NOT `get` with joins bolted on. `get` is what decides whether
 * the caller may see this file at all; this only resolves what its ids mean,
 * and keeping them apart means a change to either cannot quietly alter the
 * other's semantics.
 */
async function headerJoins(client, dossierId) {
  const { rows } = await client.query(
    "SELECT cm.name AS client_name, " +
      "st.key AS service_key, st.name_en AS service_name_en, st.name_fr AS service_name_fr, " +
      "st.captures_containers AS captures_containers, st.container_detail_mode AS container_detail_mode, " +
      "(SELECT COALESCE(SUM(l.qty), 0)::int FROM dossier_container_line l WHERE l.dossier_id = d.dossier_id) AS container_boxes, " +
      "rp.name AS rate_provider_name, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id) AS milestone_total, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status = 'DONE') AS milestone_done, " +
      "(SELECT mi.label FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status IN ('IN_PROGRESS','PENDING') ORDER BY (mi.status = 'IN_PROGRESS') DESC, mi.stage_seq ASC LIMIT 1) AS current_milestone " +
      "FROM dossier d " +
      "LEFT JOIN client_master cm ON cm.client_id = d.client_id " +
      "LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
      "LEFT JOIN rate_provider rp ON rp.rate_provider_id = d.rate_provider_id " +
      "WHERE d.dossier_id = $1",
    [dossierId],
  );
  return rows[0] || {};
}

/**
 * The file's own vault documents, for the pickers that must show them (the
 * transit-order checklist previews what is actually attached before an operator
 * ticks a box). Named columns rather than `*`, so the response contract stays
 * explicit. Non-archived only: an archived scan is no longer evidence.
 */
async function vaultDocuments(client, dossierId) {
  const { rows } = await client.query(
    "SELECT doc_id, doc_type, status, entity_ref, version_no, created_at " +
      "FROM document_vault WHERE dossier_id = $1 AND status <> 'ARCHIVED' ORDER BY created_at DESC LIMIT 50",
    [dossierId],
  );
  return rows;
}

// WRITABLE is exported for tests/unit/dossier-columns.test.js, which reconciles
// it against the columns the migrations actually declare. That test is the link
// between this file and the schema — the link whose absence let `title` be
// written for months against a column that did not exist.
module.exports = { insert, get, update, list, listPaged, overview, headerJoins, vaultDocuments, WRITABLE };
