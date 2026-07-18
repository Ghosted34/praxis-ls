/** Operations file (dossier) repository (MOD-29). All dossier SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "dossier", data);
const get = (client, id) => getById(client, "dossier", "dossier_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE dossier SET " + set + ", updated_at = now() WHERE dossier_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("client_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.service_type_id) { params.push(q.service_type_id); wh.push("service_type_id = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("ref ILIKE $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const sql =
    "SELECT d.*, cm.name AS client_name, " +
    "st.key AS service_key, st.name_en AS service_name_en, st.name_fr AS service_name_fr, st.territory AS service_territory, " +
    "(SELECT COALESCE(SUM(cl.qty * cl.unit_cost), 0) FROM costing_line cl JOIN costing c ON c.costing_id = cl.costing_id WHERE c.dossier_id = d.dossier_id) AS costing_total, " +
    "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id) AS milestone_total, " +
    "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status = 'DONE') AS milestone_done, " +
    "(SELECT mi.label FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status IN ('IN_PROGRESS','PENDING') ORDER BY (mi.status = 'IN_PROGRESS') DESC, mi.stage_seq ASC LIMIT 1) AS current_milestone " +
    "FROM dossier d " +
    "LEFT JOIN client_master cm ON cm.client_id = d.client_id " +
    "LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
    where + " ORDER BY d.created_at DESC LIMIT $1 OFFSET $2";
  const { rows } = await client.query(sql, params);
  return rows;
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
      "COALESCE(SUM(cl.qty * cl.unit_cost), 0) AS planned_cost " +
      "FROM costing c LEFT JOIN costing_line cl ON cl.costing_id = c.costing_id WHERE c.dossier_id = $1",
  );
  const [actual] = await q("SELECT COUNT(*)::int AS entries, COALESCE(SUM(amount), 0) AS actual_cost FROM cost_entry WHERE dossier_id = $1");
  const [invoices] = await q(
    "SELECT COUNT(*)::int AS count, COALESCE(SUM(total_ttc), 0) AS invoiced_ttc, " +
      "COALESCE(SUM(total_ttc) FILTER (WHERE status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')), 0) AS billed_ttc " +
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

  return { costing, actual, invoices, outstanding, milestones, procurement, transit, delivery };
}

module.exports = { insert, get, update, list, overview };
