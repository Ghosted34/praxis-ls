/** Transit-order repository (MOD-30). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertTO = (client, data) => insertOne(client, "transit_order", data);
const getTO = (client, id) => getById(client, "transit_order", "transit_order_id", id);
const insertLine = (client, data) => insertOne(client, "transit_order_line", data);
const listLines = async (client, id) =>
  (await client.query(
    "SELECT * FROM transit_order_line WHERE transit_order_id = $1 ORDER BY line_no NULLS LAST, transit_order_line_id",
    [id],
  )).rows;
const deleteLines = (client, id) =>
  client.query("DELETE FROM transit_order_line WHERE transit_order_id = $1", [id]);

/**
 * The row plus the facts a reader needs to make sense of it, resolved in ONE
 * query rather than by the caller fetching a dossier and a client separately.
 *
 * `dossier_ref` and `client_name` are the two things the legacy screen showed
 * read-only from the file (get_file.php) and every consumer of this row wants.
 * They are JOINed, never stored — a client renaming themselves must not leave a
 * stale name on an order, and the frozen copy for a locked document is
 * `shipment_details_snapshot`, which is a different mechanism with a different
 * purpose (0661).
 */
/**
 * `dossier_visible`, not `dossier` (0671). This decorates a LIST as well as a
 * single row, so it enumerates: a transit order attached to a half-finished
 * wizard draft must not pull that draft's placeholder `DRAFT-…` reference into
 * an operator's list. On a real file the view and the base table are the same
 * row, so nothing is lost.
 */
const SELECT_FULL = `
  SELECT t.*,
         t.ot_number AS ref,
         d.ref       AS dossier_ref,
         COALESCE(c.name, c.legal_name) AS client_name,
         e.legal_name AS entity_name
    FROM transit_order t
    LEFT JOIN dossier_visible d ON d.dossier_id = t.dossier_id
    LEFT JOIN client_master   c ON c.client_id  = d.client_id
    LEFT JOIN corporate_entity e ON e.entity_id = t.entity_id`;

async function getFull(client, id) {
  const { rows } = await client.query(`${SELECT_FULL} WHERE t.transit_order_id = $1`, [id]);
  return rows[0] || null;
}

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getTO(client, id);
  return updateOne(client, "transit_order", "transit_order_id", id, fields, "*", null);
}

/**
 * List with the filters the screen actually offers.
 *
 * `status`, `entity_id` and `q` are new; the legacy list had none of them and
 * the rebuild's had only `dossier_id`, which is the one filter a user browsing
 * the transit-order list does NOT have to hand (they are looking for an order,
 * not standing inside a file). `q` searches the OT number, the file reference
 * and the declaration reference — the three strings anyone quotes on the phone.
 */
async function listTO(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if (q.dossier_id) wh.push(`t.dossier_id = ${add(q.dossier_id)}`);
  if (q.entity_id) wh.push(`t.entity_id = ${add(q.entity_id)}`);
  if (q.status) {
    const list = String(q.status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (list.length) wh.push(`t.status = ANY(${add(list)})`);
  }
  if (q.customs_regime) wh.push(`t.customs_regime = ${add(q.customs_regime)}`);
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    wh.push(`(t.ot_number ILIKE ${add(like)} OR d.ref ILIKE ${add(like)} OR t.declaration_ref ILIKE ${add(like)})`);
  }

  const { rows } = await client.query(
    `${SELECT_FULL} WHERE ${wh.join(" AND ")} ORDER BY t.created_at DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/**
 * Counts per status for the KPI row, computed in the database.
 *
 * The screen previously derived its tiles by filtering the loaded page in
 * JavaScript, which counts one page and calls it the total — it reads "3
 * import" on a tenant with four hundred. One grouped query is both correct and
 * cheaper than the page it was guessing from.
 */
async function statusCounts(client, q = {}) {
  const params = [];
  const wh = ["1=1"];
  if (q.entity_id) { params.push(q.entity_id); wh.push(`entity_id = $${params.length}`); }
  const { rows } = await client.query(
    `SELECT status, COUNT(*)::int AS n FROM transit_order WHERE ${wh.join(" AND ")} GROUP BY status`,
    params,
  );
  const out = { DRAFT: 0, ISSUED: 0, SIGNED: 0, LODGED: 0, CANCELLED: 0, TOTAL: 0 };
  for (const r of rows) { out[r.status] = r.n; out.TOTAL += r.n; }
  return out;
}

/** Orders already raised on a dossier — the duplicate guard reads this. */
async function liveForDossier(client, dossierId) {
  const { rows } = await client.query(
    "SELECT transit_order_id, ot_number, status FROM transit_order WHERE dossier_id = $1 AND status <> 'CANCELLED' ORDER BY created_at DESC",
    [dossierId],
  );
  return rows;
}

/**
 * The dossier facts an order needs at create time (entity fallback, default
 * regime, the reference quoted back in the duplicate message).
 *
 * `dossier_visible` here too, and that is a RULE rather than a precaution: a
 * DRAFT is half-finished wizard state that has not got a real reference yet
 * (0671 constrains it to `DRAFT-…`), and a customs authorisation must not be
 * raised against one. Reading through the view makes `create` answer "file not
 * found" for a draft, which is the correct refusal and needs no extra check.
 */
async function dossierBrief(client, dossierId) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.entity_id, d.client_id, d.customs_regime, d.details_json,
            COALESCE(c.name, c.legal_name) AS client_name
       FROM dossier_visible d
       LEFT JOIN client_master c ON c.client_id = d.client_id
      WHERE d.dossier_id = $1`,
    [dossierId],
  );
  return rows[0] || null;
}

module.exports = {
  insertTO, getTO, getFull, update, listTO, statusCounts,
  insertLine, listLines, deleteLines, liveForDossier, dossierBrief,
};
