/** Cost tracking repository (MOD-47). cost_entry + budget/actual SQL lives here. */
"use strict";
const { insertOne, page } = require("../../../shared/db/query-helpers");

const insertCostEntry = (client, data) => insertOne(client, "cost_entry", data);

async function purchaseRuleAccount(client, dictionaryItemId) {
  if (!dictionaryItemId) return null;
  const { rows } = await client.query(
    "SELECT debit_account FROM posting_rule WHERE dictionary_item_id = $1 AND applies_context = 'purchase' ORDER BY created_at ASC LIMIT 1",
    [dictionaryItemId],
  );
  return rows[0] ? rows[0].debit_account : null;
}

async function actualTotal(client, dossierId) {
  const { rows } = await client.query("SELECT COALESCE(SUM(amount), 0) AS total FROM cost_entry WHERE dossier_id = $1", [dossierId]);
  return Number(rows[0].total);
}

async function approvedBudgetTotal(client, dossierId) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(cl.qty * cl.unit_cost), 0) AS total FROM costing_line cl " +
      "JOIN costing c ON c.costing_id = cl.costing_id WHERE c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'",
    [dossierId],
  );
  return Number(rows[0].total);
}

async function listByDossier(client, dossierId, q = {}) {
  const { limit, offset } = page(q);
  const { rows } = await client.query(
    "SELECT * FROM cost_entry WHERE dossier_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    [dossierId, limit, offset],
  );
  return rows;
}

/**
 * Advances received against a dossier (Landing D §4).
 *
 * The legacy carried `advance_received` on every cost LINE and totalled it per
 * file. This system models the same money better and elsewhere: `advance`
 * (0230:38) is a real per-dossier row with its own `entry_id` and
 * `applied_amount`, because cash from a client is a liability (Cr 4191) that is
 * later drawn down by the final invoice — not an attribute of a cost line. A
 * client does not advance money "against Demurrage"; they advance it against
 * the file.
 *
 * So the gap was never the data, it was the READ: nothing joined `advance` to
 * the cost-tracking surface, so `total_advance`, `total_balance` and
 * `coverage_percentage` had no equivalent. This is that join.
 */
async function advanceTotals(client, dossierId) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(amount), 0) AS received, COALESCE(SUM(applied_amount), 0) AS applied " +
      "FROM advance WHERE dossier_id = $1",
    [dossierId],
  );
  return { received: Number(rows[0].received), applied: Number(rows[0].applied) };
}

/**
 * The portfolio sheet — one row per dossier that has a costing or a cost entry.
 *
 * WHY THIS EXISTS. Both cost-tracking routes were `/dossier/:dossierId/…`, so
 * the module could only ever answer "this one file". The legacy's master sheet
 * and KPI view were portfolio-wide, and "which files are over budget" is not a
 * question you can ask a per-dossier endpoint without N round-trips.
 *
 * WHY ONE QUERY WITH THREE SUBQUERIES rather than a view: the legacy's three
 * DATABASE VIEWS are exactly what could not be recovered (no schema dump was
 * ever committed — see doc/COST_TRACKING_LEGACY_COMPARISON.md §0), and a view
 * here would have to be maintained in a migration while this evolves. The
 * aggregates are scoped per dossier in scalar subqueries rather than joined and
 * grouped, because three LEFT JOINs against costing_line, cost_entry and
 * advance would multiply rows and silently inflate every SUM — the classic
 * fan-out. Each subquery is independently correct.
 *
 * `budget` counts APPROVED_LOCKED costings only, matching approvedBudgetTotal:
 * an unapproved draft is not an authorised budget to be measured against.
 *
 * Reads `dossier_visible` (0671:82), not the base table. This ENUMERATES, and a
 * DRAFT dossier is half-finished wizard state rather than a file — it has no
 * business appearing on a cost sheet. tests/unit/dossier-draft-isolation
 * enforces this and caught the first draft of this query reading `dossier`.
 */
async function portfolio(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("d.dossier_id = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("d.client_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("d.status = $" + params.length); }
  const where = wh.length ? " AND " + wh.join(" AND ") : "";

  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.status AS dossier_status, d.bl_mawb, d.eta, d.ata,
            d.pol, d.pod, c.name AS client_name, st.name_fr AS service_type,
            COALESCE(b.total, 0)  AS budget,
            COALESCE(a.total, 0)  AS actual,
            COALESCE(adv.received, 0) AS advance_received,
            COALESCE(adv.applied, 0)  AS advance_applied
       FROM dossier_visible d
       LEFT JOIN client_master c ON c.client_id = d.client_id
       LEFT JOIN service_type st ON st.service_type_id = d.service_type_id
       LEFT JOIN LATERAL (
         SELECT SUM(cl.qty * cl.unit_cost) AS total
           FROM costing_line cl JOIN costing cg ON cg.costing_id = cl.costing_id
          WHERE cg.dossier_id = d.dossier_id AND cg.status = 'APPROVED_LOCKED'
       ) b ON true
       LEFT JOIN LATERAL (
         SELECT SUM(ce.amount) AS total FROM cost_entry ce WHERE ce.dossier_id = d.dossier_id
       ) a ON true
       LEFT JOIN LATERAL (
         SELECT SUM(av.amount) AS received, SUM(av.applied_amount) AS applied
           FROM advance av WHERE av.dossier_id = d.dossier_id
       ) adv ON true
      WHERE (b.total IS NOT NULL OR a.total IS NOT NULL)${where}
      ORDER BY d.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

module.exports = { insertCostEntry, purchaseRuleAccount, actualTotal, approvedBudgetTotal, advanceTotals, portfolio, listByDossier };
