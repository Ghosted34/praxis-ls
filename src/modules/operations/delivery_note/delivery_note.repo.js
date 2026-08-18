/** Delivery-note repository (MOD-32). All SQL lives here. */
"use strict";
const { insertOne, getById, updateOne, page } = require("../../../shared/db/query-helpers");

/**
 * The list/detail projection.
 *
 * Joins `dossier_visible`, not `dossier`: a DRAFT file is half-finished wizard
 * state whose reference is still a `DRAFT-…` placeholder (0671), and that
 * placeholder must never decorate a delivery note. Reading through the view
 * means a draft file simply does not resolve, which is the correct answer.
 */
const SELECT_FULL = `
  SELECT dn.*, dn.doc_number AS ref,
         d.ref AS dossier_ref,
         c.name AS client_name
    FROM delivery_note dn
    LEFT JOIN dossier_visible d ON d.dossier_id = dn.dossier_id
    LEFT JOIN client_master c ON c.client_id = d.client_id`;

const insertDN = (client, data) => insertOne(client, "delivery_note", data);
const getDN = (client, id) => getById(client, "delivery_note", "delivery_note_id", id);

async function getFull(client, id) {
  const { rows } = await client.query(`${SELECT_FULL} WHERE dn.delivery_note_id = $1`, [id]);
  return rows[0] || null;
}

async function update(client, id, fields) {
  if (!Object.keys(fields).length) return getDN(client, id);
  return updateOne(client, "delivery_note", "delivery_note_id", id, fields, "*", null);
}

const insertLine = (client, data) => insertOne(client, "delivery_note_line", data);
const listLines = async (client, id) =>
  (await client.query(
    "SELECT * FROM delivery_note_line WHERE delivery_note_id = $1 ORDER BY delivery_note_line_id",
    [id],
  )).rows;
const deleteLines = (client, id) =>
  client.query("DELETE FROM delivery_note_line WHERE delivery_note_id = $1", [id]);

const insertContainer = (client, data) => insertOne(client, "delivery_note_container", data);
const listContainers = async (client, id) =>
  (await client.query(
    "SELECT * FROM delivery_note_container WHERE delivery_note_id = $1 ORDER BY seq, created_at",
    [id],
  )).rows;
const deleteContainers = (client, id) =>
  client.query("DELETE FROM delivery_note_container WHERE delivery_note_id = $1", [id]);

/**
 * The file's containers, as the picker offers them (10708: grouped lines as
 * well as per-box units).
 *
 * A GROUPED file ("3 × 40' HC") has container LINES and no units at all —
 * before 10708 the picker (and the prefill) read only `dossier_container_unit`
 * and so offered nothing from exactly the files the picker exists to serve.
 * A grouped line appears as one row carrying `kind: 'line'` and its remaining
 * quantity; a per-box unit appears as `kind: 'unit'`.
 *
 * `already_on` is the point of the LEFT JOIN: a container already covered by
 * another delivery note on the same file is still selectable (part-deliveries
 * of the same box do happen, and split loads are normal), but the UI can say so
 * rather than letting somebody silently deliver it twice.
 */
async function containersForDossier(client, dossierId, { excludeNoteId = null } = {}) {
  const { rows: units } = await client.query(
    `SELECT 'unit' AS kind, u.dossier_container_unit_id, NULL::uuid AS dossier_container_line_id,
            u.container_no, u.seal_no,
            u.gross_weight_kg, u.tare_kg, u.discharged_on,
            ct.code AS container_type_code,
            ct.name_en AS container_type_en,
            ct.name_fr AS container_type_fr,
            NULL::int AS qty,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT other.doc_number), NULL) AS already_on
       FROM dossier_container_unit u
       JOIN dossier_container_line l
         ON l.dossier_container_line_id = u.dossier_container_line_id
       JOIN dictionary_ref ct ON ct.ref_id = l.container_type_ref_id
       LEFT JOIN delivery_note_container dnc
         ON dnc.dossier_container_unit_id = u.dossier_container_unit_id
       LEFT JOIN delivery_note other
         ON other.delivery_note_id = dnc.delivery_note_id
        AND other.status <> 'CANCELLED'
        AND ($2::uuid IS NULL OR other.delivery_note_id <> $2)
      WHERE u.dossier_id = $1
      GROUP BY u.dossier_container_unit_id, u.container_no, u.seal_no,
               u.gross_weight_kg, u.tare_kg, u.discharged_on,
               ct.code, ct.name_en, ct.name_fr
      ORDER BY u.container_no NULLS LAST`,
    [dossierId, excludeNoteId],
  );
  const { rows: lines } = await client.query(
    `SELECT 'line' AS kind, NULL::uuid AS dossier_container_unit_id,
            l.dossier_container_line_id, NULL AS container_no, NULL AS seal_no,
            NULL::numeric AS gross_weight_kg, NULL::numeric AS tare_kg, NULL::date AS discharged_on,
            ct.code AS container_type_code,
            ct.name_en AS container_type_en,
            ct.name_fr AS container_type_fr,
            (l.qty - (SELECT count(*)::int FROM dossier_container_unit u
                       WHERE u.dossier_container_line_id = l.dossier_container_line_id)) AS qty,
            NULL::text[] AS already_on
       FROM dossier_container_line l
       JOIN dictionary_ref ct ON ct.ref_id = l.container_type_ref_id
      WHERE l.dossier_id = $1
      ORDER BY l.seq, l.dossier_container_line_id`,
    [dossierId],
  );
  // Only the part of each line that has no per-box unit yet — a line fully
  // broken out into units is represented by its units, not by a "0 remaining"
  // row nobody can pick.
  return [
    ...lines.filter((l) => (Number(l.qty) || 0) > 0),
    ...units,
  ];
}

/** Verify picked units really belong to this file — one query, not per row. */
async function unitsOnDossier(client, dossierId, unitIds) {
  if (!unitIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT u.dossier_container_unit_id, u.container_no, u.seal_no, u.gross_weight_kg
       FROM dossier_container_unit u
      WHERE u.dossier_id = $1 AND u.dossier_container_unit_id = ANY($2::uuid[])`,
    [dossierId, unitIds],
  );
  return new Map(rows.map((r) => [r.dossier_container_unit_id, r]));
}

/**
 * Verify picked container LINES really belong to this file, and hand back the
 * type code and the remaining quantity to snapshot onto the note (10708).
 * The remaining count is read at pick time — the same snapshot rule as the
 * unit link: a later correction to the file cannot rewrite what was signed
 * for.
 */
async function linesOnDossier(client, dossierId, lineIds) {
  if (!lineIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT l.dossier_container_line_id, ct.code AS container_type_code,
            (l.qty - (SELECT count(*)::int FROM dossier_container_unit u
                       WHERE u.dossier_container_line_id = l.dossier_container_line_id)) AS remaining
       FROM dossier_container_line l
       JOIN dictionary_ref ct ON ct.ref_id = l.container_type_ref_id
      WHERE l.dossier_id = $1 AND l.dossier_container_line_id = ANY($2::uuid[])`,
    [dossierId, lineIds],
  );
  return new Map(rows.map((r) => [r.dossier_container_line_id, r]));
}

/**
 * The dossier facts a note needs (entity fallback, the client's name, the
 * reference printed on the document).
 *
 * `dossier_visible` again, and for a stronger reason than the list join: a
 * delivery note raised against a DRAFT file would carry a placeholder reference
 * onto a document a client signs. Reading through the view makes `create`
 * answer "file not found", which is the correct refusal.
 */
async function dossierBrief(client, dossierId) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.entity_id, d.client_id, d.details_json,
            c.name AS client_name
       FROM dossier_visible d
       LEFT JOIN client_master c ON c.client_id = d.client_id
      WHERE d.dossier_id = $1`,
    [dossierId],
  );
  return rows[0] || null;
}

/**
 * The file and ALL its container units, for prefilling a new note.
 *
 * Distinct from `unitsOnDossier`, which resolves a set the caller already named:
 * this is the opposite direction — "what is on this file?" — because the form
 * has not been given any units yet, it is being offered them.
 *
 * `dossier_visible` for the same reason as `dossierBrief`. Named columns for the
 * same reason as the transit-order version: this feeds a document.
 */
async function dossierForPrefill(client, dossierId) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.entity_id, d.commodity, d.commodity_desc,
            d.package_count, d.place_delivery
       FROM dossier_visible d
      WHERE d.dossier_id = $1`,
    [dossierId],
  );
  if (!rows[0]) return null;
  const { rows: containers } = await client.query(
    // Ordered so the note lists the boxes the way the yard reads them, and so
    // two prefills of the same file never differ in row order.
    // `already_on` rides along so the form can offer the free boxes without
    // silently putting a twice-delivered unit on a new note (10708).
    `SELECT u.dossier_container_unit_id, u.container_no, u.seal_no, u.gross_weight_kg,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT other.doc_number), NULL) AS already_on
       FROM dossier_container_unit u
       LEFT JOIN delivery_note_container dnc
         ON dnc.dossier_container_unit_id = u.dossier_container_unit_id
       LEFT JOIN delivery_note other
         ON other.delivery_note_id = dnc.delivery_note_id
        AND other.status <> 'CANCELLED'
      WHERE u.dossier_id = $1
      GROUP BY u.dossier_container_unit_id
      ORDER BY u.container_no NULLS LAST, u.dossier_container_unit_id`,
    [dossierId],
  );
  // The grouped lines — the only container shape a GROUPED file has (10708).
  const { rows: lines } = await client.query(
    `SELECT l.dossier_container_line_id, ct.code AS container_type_code,
            ct.name_en AS container_type_en, ct.name_fr AS container_type_fr,
            (l.qty - (SELECT count(*)::int FROM dossier_container_unit u
                       WHERE u.dossier_container_line_id = l.dossier_container_line_id)) AS qty
       FROM dossier_container_line l
       JOIN dictionary_ref ct ON ct.ref_id = l.container_type_ref_id
      WHERE l.dossier_id = $1
      ORDER BY l.seq, l.dossier_container_line_id`,
    [dossierId],
  );
  return {
    dossier: rows[0],
    containers,
    lines: lines.filter((l) => (Number(l.qty) || 0) > 0),
  };
}

async function listDN(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if (q.dossier_id) wh.push(`dn.dossier_id = ${add(q.dossier_id)}`);
  if (q.status) {
    const list = String(q.status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (list.length) wh.push(`dn.status = ANY(${add(list)})`);
  }
  // The three strings anyone quotes down a phone: the note number, the file
  // reference, and who signed for it.
  if (q.q) {
    const p = add(`%${String(q.q).trim()}%`);
    wh.push(`(dn.doc_number ILIKE ${p} OR d.ref ILIKE ${p} OR dn.consignee ILIKE ${p} OR dn.received_by_name ILIKE ${p})`);
  }

  const { rows } = await client.query(
    `${SELECT_FULL} WHERE ${wh.join(" AND ")} ORDER BY dn.created_at DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

async function statusCounts(client, q = {}) {
  const params = [];
  const wh = ["1=1"];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push(`dossier_id = $${params.length}`); }
  const { rows } = await client.query(
    `SELECT status, COUNT(*)::int AS n FROM delivery_note WHERE ${wh.join(" AND ")} GROUP BY status`,
    params,
  );
  return rows.reduce((a, r) => ({ ...a, [r.status]: r.n }), {});
}

module.exports = {
  SELECT_FULL,
  insertDN, getDN, getFull, update, listDN, statusCounts,
  insertLine, listLines, deleteLines,
  insertContainer, listContainers, deleteContainers,
  containersForDossier, unitsOnDossier, linesOnDossier, dossierBrief, dossierForPrefill,
};
