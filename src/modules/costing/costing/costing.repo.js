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
function insertLine(client, data) { return insertOne(client, "costing_line", data); }

/* ── Line identity, and why it now has to survive an amendment (12771) ────────
 *
 * `replaceLines` used to delete every line and re-insert, so every
 * `costing_line_id` changed on every DRAFT save. Once a cash request claims a
 * budget line by its id, that is a link which breaks at exactly the moment it
 * matters — the amendment. The service therefore upserts in place, and these
 * three are what it needs.
 */

/** One line's columns, by id. Used by the in-place upsert. */
function updateLine(client, lineId, fields) {
  return updateOne(client, "costing_line", "costing_line_id", lineId, fields);
}

/** Drop the lines an amendment did not keep. `keepIds` may be empty (all go). */
async function deleteLinesExcept(client, costingId, keepIds = []) {
  await client.query(
    "DELETE FROM costing_line WHERE costing_id = $1 AND NOT (costing_line_id = ANY($2::uuid[]))",
    [costingId, keepIds],
  );
}

/**
 * Which of these budget lines are already claimed by a cash request, and by
 * which requests.
 *
 * The FK is RESTRICT, so deleting a claimed line raises a raw 23503 from inside
 * a transaction. This turns that into a sentence naming the requests, so the
 * author is told to reduce the line to zero rather than reading a constraint
 * name. Only LIVE claims count — a rejected request holds nothing.
 */
async function claimsOnLines(client, lineIds = []) {
  if (!lineIds.length) return [];
  const { rows } = await client.query(
    `SELECT crl.costing_line_id,
            COUNT(*)::int                                   AS claim_count,
            ARRAY_AGG(DISTINCT COALESCE(cr.doc_number, LEFT(cr.cash_request_id::text, 8))) AS doc_numbers
       FROM cash_request_line crl
       JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
      WHERE crl.costing_line_id = ANY($1::uuid[])
        AND cr.status <> 'REJECTED'
      GROUP BY crl.costing_line_id`,
    [lineIds],
  );
  return rows;
}

/* ── The budget ledger (12771) ───────────────────────────────────────────────
 *
 * The four numbers a costing line is worth, in one query, with the claim
 * arithmetic done in SQL so the page does not fetch every cash request to add
 * them up.
 *
 * BUDGET is the line's TTC, and the expression below is `costing.rules.lineTtc`
 * transcribed — the two must not drift.
 *
 * COMMITTED counts a claim from the moment its request is APPROVED, not from
 * the moment cash moves (owner decision Q2). Between approval and payment the
 * budget must NOT read as free, or a second request is approved against
 * headroom the first was already promised. A request settled short
 * (CLOSED_SHORT) commits only `settled_amount`, which CLOSE_BALANCE writes.
 *
 * PENDING is the same sum over requests still awaiting a decision. It consumes
 * nothing — it is there so a validator can see that headroom is spoken for
 * before they add to the queue.
 *
 * DISBURSED is APPORTIONED. Instalments are paid against the request, not
 * against its lines (owner decision Q15), so a line's share is its claim scaled
 * by how much of the request has been paid. It is a display figure and the
 * response names it as such; nothing is gated on it.
 *
 * `excludeCashRequestId` leaves ONE request out of every total — the answer to
 * "what was available to this request", as distinct from "what is left now".
 * Without it a request counts against itself the moment it is approved: its own
 * claim lands in `committed`, `remaining` drops by it, and the same claim then
 * reads as a breach of the budget it was approved against. Every caller that
 * asks on behalf of a particular request passes its id.
 */
const COMMITTING_STATUSES = ["APPROVED", "PARTIALLY_DISBURSED", "DISBURSED", "CLOSED_SHORT", "JUSTIFIED"];
const PENDING_STATUSES = ["SUBMITTED", "VALIDATED"];

// The line's own VAT: a débours carries the supplier's as an amount, a service
// line derives it from its tax code. Written once and used three times below.
const LINE_VAT_SQL =
  "CASE WHEN cl.is_disbursement THEN COALESCE(cl.upstream_vat_amount, 0) " +
  "ELSE cl.qty * cl.unit_cost * COALESCE(tc.rate_percent, 0) / 100 END";

async function budgetForCosting(client, costingId, { excludeCashRequestId = null } = {}) {
  const { rows } = await client.query(
    `SELECT cl.costing_line_id, cl.line_no, cl.label, cl.dictionary_item_id,
            cl.is_disbursement, cl.container_type_ref_id, cl.qty, cl.unit_cost,
            di.code  AS item_code,
            dr.code  AS container_type_code,
            ROUND(cl.qty * cl.unit_cost, 2)                       AS net,
            ROUND(${LINE_VAT_SQL}, 2)                             AS vat,
            ROUND(cl.qty * cl.unit_cost + ${LINE_VAT_SQL}, 2)     AS budget,
            claims.committed, claims.pending, claims.disbursed
       FROM costing_line cl
       LEFT JOIN tax_code       tc ON tc.tax_code_id = cl.tax_code_id
       LEFT JOIN dictionary_item di ON di.dictionary_item_id = cl.dictionary_item_id
       LEFT JOIN dictionary_ref  dr ON dr.ref_id = cl.container_type_ref_id
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(SUM(k.claim) FILTER (WHERE k.status = ANY($2::text[])), 0) AS committed,
           COALESCE(SUM(k.claim) FILTER (WHERE k.status = ANY($3::text[])), 0) AS pending,
           COALESCE(SUM(ROUND(k.claim * k.paid_ratio, 2))
                    FILTER (WHERE k.status = ANY($2::text[])), 0)              AS disbursed
           FROM (
             SELECT cr.status,
                    COALESCE(crl.settled_amount,
                             ROUND(crl.budget_amount * (1 + COALESCE(crl.vat_percent, 0) / 100), 2)) AS claim,
                    CASE
                      -- A SETTLED line's claim IS its share of the cash that
                      -- moved (CLOSE_BALANCE wrote it that way), so scaling it
                      -- by the request's paid ratio would discount it twice and
                      -- report less cash than the treasury actually issued.
                      WHEN crl.settled_amount IS NOT NULL THEN 1
                      WHEN cr.amount > 0 THEN cr.disbursed_amount / cr.amount
                      ELSE 0
                    END AS paid_ratio
               FROM cash_request_line crl
               JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
              WHERE crl.costing_line_id = cl.costing_line_id
                AND ($4::uuid IS NULL OR crl.cash_request_id <> $4::uuid)
           ) k
       ) claims ON TRUE
      WHERE cl.costing_id = $1
      ORDER BY cl.line_no, cl.costing_line_id`,
    [costingId, COMMITTING_STATUSES, PENDING_STATUSES, excludeCashRequestId],
  );
  return rows;
}
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
/**
 * Just enough of each line to compute its logical identity (`rules.lineKey`)
 * and address it — the in-place upsert's read.
 *
 * Not `listLines`: that carries four LEFT JOINs so a reader can render the
 * sheet, and the upsert needs none of them. It runs on every DRAFT save.
 */
async function lineIdentities(client, costingId) {
  const { rows } = await client.query(
    "SELECT costing_line_id, dictionary_item_id, container_type_ref_id, label, line_no " +
      "FROM costing_line WHERE costing_id = $1 ORDER BY line_no, costing_line_id",
    [costingId],
  );
  return rows;
}

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
      // An APPROVED sheet first, then the most recent: `LIMIT 1` with no order
      // was non-deterministic, so a file that had been through an unlock could
      // answer with either version depending on the plan. One costing per file
      // is the intent, but nothing in the schema enforces it (12774 note).
      "WHERE dossier_id = $1 AND status <> 'REJECTED' "
      + "ORDER BY (status = 'APPROVED_LOCKED') DESC, created_at DESC LIMIT 1",
    [dossierId],
  );
  return rows[0] || null;
}

/**
 * The costing gate for one operations file (12774) — everything the cash
 * request screen needs to answer "can this file be funded, and if not, who is
 * holding it up?" in one round trip.
 *
 * WHY IT IS ONE QUERY AND NOT THREE. This runs the moment somebody picks a file
 * in a dialog, before they have typed anything. Three sequential round trips to
 * paint a status line is how a dialog comes to feel slow, and the join is
 * cheap: the sheet, the person named to validate it, and the pending approval
 * task that names whoever must approve it.
 *
 * `awaiting_role_id` matters as much as `awaiting_user_id`: a workflow step can
 * be assigned to a ROLE, and then the person to chase is everyone holding it
 * rather than nobody.
 */
async function gateForDossier(client, dossierId) {
  const { rows } = await client.query(
    `SELECT c.costing_id, c.doc_number, c.status, c.total_ttc, c.currency,
            c.validator_id,
            COALESCE(e_v.signatory_name, v.full_name) AS validator_name,
            t.assigned_user_id AS awaiting_user_id,
            t.assigned_role_id AS awaiting_role_id,
            COALESCE(e_a.signatory_name, a.full_name) AS awaiting_user_name,
            r.name AS awaiting_role_name,
            (SELECT count(*) FROM costing_nudge n
              WHERE n.costing_id = c.costing_id AND n.sent_on = current_date) AS nudges_today
       FROM costing c
       LEFT JOIN app_user v ON v.user_id = c.validator_id
       LEFT JOIN employee e_v ON e_v.employee_id = v.employee_id
       -- The oldest PENDING step is the one actually blocking; a chain with two
       -- open steps is waiting on the first of them.
       LEFT JOIN LATERAL (
         SELECT assigned_user_id, assigned_role_id
           FROM approval_task
          WHERE entity_ref = 'costing:' || c.costing_id AND status = 'PENDING'
          ORDER BY created_at LIMIT 1
       ) t ON true
       LEFT JOIN app_user a ON a.user_id = t.assigned_user_id
       LEFT JOIN employee e_a ON e_a.employee_id = a.employee_id
       LEFT JOIN role r ON r.role_id = t.assigned_role_id
      WHERE c.dossier_id = $1 AND c.status <> 'REJECTED'
      ORDER BY (c.status = 'APPROVED_LOCKED') DESC, c.created_at DESC
      LIMIT 1`,
    [dossierId],
  );
  return rows[0] || null;
}

/**
 * Everyone holding a role — the recipients when a step names a role, not a
 * person. Roles are a JOIN table (`user_role`), not a column on `app_user`, and
 * a suspended or locked account is not somebody to chase.
 */
async function usersInRole(client, roleId) {
  if (!roleId) return [];
  const { rows } = await client.query(
    "SELECT u.user_id FROM app_user u "
      + "JOIN user_role ur ON ur.user_id = u.user_id "
      + "WHERE ur.role_id = $1 AND u.status = 'ACTIVE'",
    [roleId],
  );
  return rows.map((r) => r.user_id);
}

/** Reminders sent about this sheet today. The quota's numerator (12774). */
async function nudgesToday(client, costingId) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM costing_nudge WHERE costing_id = $1 AND sent_on = current_date",
    [costingId],
  );
  return rows[0] ? rows[0].n : 0;
}

const insertNudge = (client, data) => insertOne(client, "costing_nudge", data);

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
  insert, get, update, deleteLinesExcept, insertLine, updateLine, listLines, list, kpis,
  claimsOnLines, budgetForCosting, lineIdentities, COMMITTING_STATUSES, PENDING_STATUSES,
  liveForDossier, gateForDossier, usersInRole, nudgesToday, insertNudge,
  insertSnapshot, latestSnapshot, snapshotCount,
  dossierForCosting, tieredItems, containerTypesOnFile, ratesForItems, defaultSalesTaxCode,
};
