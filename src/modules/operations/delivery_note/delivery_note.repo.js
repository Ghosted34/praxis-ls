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
            /*
             * TWO ARRAYS, not one.
             *
             * already_on lumped both cases together in the same neutral tone,
             * so handing over a box the client has ALREADY SIGNED FOR was
             * exactly as easy as splitting a load across two live notes. They
             * are different acts: the first is nearly always a mistake and
             * occasionally a genuine return; the second is routine.
             *
             * already_on is kept as the union, so a caller not yet migrated
             * receives what it has always received.
             */
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT other.doc_number), NULL) AS already_on,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT other.doc_number)
              FILTER (WHERE other.status = 'DELIVERED'), NULL) AS delivered_on,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT other.doc_number)
              FILTER (WHERE other.status = 'ISSUED'), NULL) AS issued_on
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
            NULL::text[] AS already_on,
            NULL::text[] AS delivered_on,
            NULL::text[] AS issued_on
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

/**
 * HOW MUCH OF THIS FILE HAS ACTUALLY BEEN DELIVERED.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠  DERIVED FROM THE NOTES. There is no `delivered_on` column anywhere and
 *    there must not be one.
 *
 *    The delivery notes already ARE the record of what was handed over: each
 *    one snapshots its boxes and carries a signature and a receiver's name. A
 *    date stamped onto `dossier_container_unit` beside them would be a second
 *    source of truth, and it drifts the first time a note is cancelled — at
 *    which point the file says a box was delivered and no signed document
 *    agrees.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── The three states, and why "issued" is its own ──────────────────────────
 *   DELIVERED  a note covering this box has been signed for. Done.
 *   ISSUED     a note covering it is numbered and out with a driver. NOT done,
 *              and not outstanding either — sending a second truck for it is
 *              the mistake this state exists to prevent.
 *   OUTSTANDING no live note covers it. This is what "4 still to go" means.
 *
 * A CANCELLED note counts for nothing, which is what makes cancelling the
 * correct way to undo a mistaken note.
 *
 * ── Two shapes, because a file has two ─────────────────────────────────────
 * A file that itemised its boxes reports per UNIT. A file still at "3 × 40' HC"
 * (10708) has no units, so it reports per container LINE, counting the QUANTITY
 * handed over against the line's own qty. Both are returned; a file mid-way
 * through itemisation legitimately has some of each.
 *
 * ⚠ NOT to be confused with `linesOnDossier`'s `remaining`, which is the line's
 *   qty minus how many units have been BROKEN OUT of it. That is itemisation
 *   progress — how much of the booking has container numbers yet — and it says
 *   nothing about delivery. Two different questions, similar arithmetic, and
 *   mixing them up reports a file as fully delivered the moment somebody types
 *   in its container numbers.
 */
async function progressForDossier(client, dossierId) {
  const { rows: units } = await client.query(
    `SELECT u.dossier_container_unit_id AS id,
            u.container_no,
            u.seal_no,
            ct.code AS container_type_code,
            -- The note that SIGNED for it, if any. MAX over a set that the
            -- unique index keeps to one row per note; a box on two delivered
            -- notes (a genuine re-delivery) reports the latest.
            MAX(dn.doc_number) FILTER (WHERE dn.status = 'DELIVERED')  AS delivered_on_note,
            MAX(dn.received_at) FILTER (WHERE dn.status = 'DELIVERED') AS delivered_at,
            MAX(dn.doc_number) FILTER (WHERE dn.status = 'ISSUED')     AS issued_on_note,
            bool_or(dn.status = 'DELIVERED') AS is_delivered,
            bool_or(dn.status = 'ISSUED')    AS is_issued
       FROM dossier_container_unit u
       JOIN dossier_container_line l
         ON l.dossier_container_line_id = u.dossier_container_line_id
       JOIN dictionary_ref ct ON ct.ref_id = l.container_type_ref_id
       LEFT JOIN delivery_note_container dnc
         ON dnc.dossier_container_unit_id = u.dossier_container_unit_id
       LEFT JOIN delivery_note dn
         ON dn.delivery_note_id = dnc.delivery_note_id
        AND dn.status <> 'CANCELLED'
      WHERE u.dossier_id = $1
      GROUP BY u.dossier_container_unit_id, u.container_no, u.seal_no, ct.code
      ORDER BY u.container_no NULLS LAST`,
    [dossierId],
  );

  const { rows: lines } = await client.query(
    `SELECT l.dossier_container_line_id AS id,
            ct.code AS container_type_code,
            l.qty,
            -- How many units have been itemised out of this line. Those boxes
            -- report individually above, so only the un-itemised remainder is
            -- this line's to account for.
            (SELECT count(*)::int FROM dossier_container_unit u
              WHERE u.dossier_container_line_id = l.dossier_container_line_id) AS itemised,
            COALESCE(SUM(dnc.qty) FILTER (WHERE dn.status = 'DELIVERED'), 0)::int AS delivered_qty,
            COALESCE(SUM(dnc.qty) FILTER (WHERE dn.status = 'ISSUED'), 0)::int    AS issued_qty
       FROM dossier_container_line l
       JOIN dictionary_ref ct ON ct.ref_id = l.container_type_ref_id
       LEFT JOIN delivery_note_container dnc
         ON dnc.dossier_container_line_id = l.dossier_container_line_id
       LEFT JOIN delivery_note dn
         ON dn.delivery_note_id = dnc.delivery_note_id
        AND dn.status <> 'CANCELLED'
      WHERE l.dossier_id = $1
      GROUP BY l.dossier_container_line_id, ct.code, l.qty, l.seq
      ORDER BY l.seq, l.dossier_container_line_id`,
    [dossierId],
  );

  return { units, lines };
}

/**
 * Does this file's SERVICE TYPE capture containers at all?
 *
 * The toggle has existed since 0660 and the delivery note never asked: the
 * container picker rendered on every file, so a customs-brokerage note offered
 * an empty box list and a sea note offered a real one, with nothing to explain
 * the difference. `dossier_container.service` already reads exactly this pair;
 * this is the same question asked from the document side.
 *
 * Defaults to FALSE for a file whose service type cannot be resolved, because
 * "no containers" renders a plain delivery note and the alternative renders an
 * empty manifest on a document a client signs. A DRAFT file resolves to false
 * for the same reason every other read in this repo goes through
 * `dossier_visible`: a note cannot be raised against one anyway.
 */
async function capturesContainers(client, dossierId) {
  const { rows } = await client.query(
    `SELECT st.captures_containers
       FROM dossier_visible d
       JOIN service_type st ON st.service_type_id = d.service_type_id
      WHERE d.dossier_id = $1`,
    [dossierId],
  );
  return rows[0] ? rows[0].captures_containers === true : false;
}

/**
 * Which delivery this note is on its file, and how many there are.
 *
 * Counted over the LIVE notes in issue order, so a cancelled note does not
 * leave a hole in a sequence the client can see — "delivery 2 of 3" reads as a
 * fact about the shipment, not about our filing.
 *
 * A note not yet issued has no place in the sequence and reports null: it is
 * not one of the deliveries until it has a number.
 */
async function sequenceOnDossier(client, { dossierId, noteId }) {
  const { rows } = await client.query(
    `WITH live AS (
       SELECT delivery_note_id,
              row_number() OVER (ORDER BY issued_at, doc_number) AS seq,
              count(*) OVER () AS total
         FROM delivery_note
        WHERE dossier_id = $1 AND status <> 'CANCELLED' AND doc_number IS NOT NULL
     )
     SELECT seq, total FROM live WHERE delivery_note_id = $2`,
    [dossierId, noteId],
  );
  const r = rows[0];
  return { sequence: r ? Number(r.seq) : null, ofNotes: r ? Number(r.total) : null };
}

/**
 * Which of these boxes has already been SIGNED FOR, and on which note.
 *
 * The guard behind `redelivery_reason`. Asked at write time rather than trusted
 * from the picker's `delivered_on`: the picker's answer is as old as the page,
 * and a box can be signed for by another operator between opening the form and
 * saving it. The rule is enforced where the row is written.
 *
 * `excludeNoteId` is the note being edited — re-saving a note that already
 * carries the box must not accuse it of re-delivering it.
 */
async function deliveredUnits(client, { unitIds = [], excludeNoteId = null } = {}) {
  if (!unitIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT dnc.dossier_container_unit_id AS id,
            MAX(dn.doc_number) AS doc_number,
            MAX(dn.received_at) AS received_at
       FROM delivery_note_container dnc
       JOIN delivery_note dn ON dn.delivery_note_id = dnc.delivery_note_id
      WHERE dnc.dossier_container_unit_id = ANY($1::uuid[])
        AND dn.status = 'DELIVERED'
        AND ($2::uuid IS NULL OR dn.delivery_note_id <> $2)
      GROUP BY dnc.dossier_container_unit_id`,
    [unitIds, excludeNoteId],
  );
  return new Map(rows.map((r) => [r.id, r]));
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
  /*
   * EVERYTHING THE NOTE COULD POSSIBLY WANT, in one read.
   *
   * This used to select six columns, and the form asked the operator for the
   * rest — the issuing entity it already knew, the delivery address it already
   * held, the weight it had on the file. The rule the screen now follows is
   * that a field is asked ONLY when the file genuinely cannot answer it, so
   * this query is the list of what the file can answer.
   *
   * `captures_containers` and the cargo-role probe come along because they
   * decide the SHAPE of the form: a sea file gets a container manifest, an air
   * file gets packages, and a representation retainer gets neither. Asking here
   * costs one join on a query the form already makes.
   */
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.title, d.entity_id, d.client_id,
            d.commodity, d.commodity_desc, d.package_count,
            d.gross_weight, d.weight_unit, d.marks_numbers,
            d.place_delivery, d.place_receipt,
            d.bl_mawb, d.vessel_flight, d.pol, d.pod, d.eta, d.ata,
            d.promised_delivery_date, d.created_at,
            cm.name AS client_name, cm.email AS client_email,
            -- The client's PRIMARY contact, for the gate. client_master has no
            -- phone of its own; the person a driver rings is a contact row, and
            -- this is the one the register marks as primary.
            (SELECT cc.name FROM client_contact cc
              WHERE cc.client_id = d.client_id AND cc.is_active
              ORDER BY cc.is_primary DESC, cc.name LIMIT 1) AS contact_name,
            (SELECT cc.phone FROM client_contact cc
              WHERE cc.client_id = d.client_id AND cc.is_active AND cc.phone IS NOT NULL
              ORDER BY cc.is_primary DESC, cc.name LIMIT 1) AS contact_phone,
            ce.legal_name AS entity_name,
            st.key AS service_key, st.name_en AS service_name_en, st.name_fr AS service_name_fr,
            COALESCE(st.captures_containers, false) AS captures_containers,
            -- Does this service type describe CARGO at all? A freight file does;
            -- a business-representation or brokerage retainer does not, and a
            -- delivery note for one has nothing to list. Read off the field set
            -- rather than a new column, so a tenant's own profile answers too.
            EXISTS (
              SELECT 1 FROM service_type_field_set fs
              JOIN service_type_field f
                ON f.service_type_field_set_id = fs.service_type_field_set_id
             WHERE fs.service_type_id = d.service_type_id
               AND fs.is_active AND f.is_active IS NOT false
               AND f.facet_role IN ('CARGO_DESC','CARGO_WEIGHT','CARGO_VOLUME',
                                    'CARGO_PACKAGES','CARGO_MARKS')
            ) AS captures_cargo
       FROM dossier_visible d
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
       LEFT JOIN corporate_entity ce ON ce.entity_id = d.entity_id
       LEFT JOIN service_type st ON st.service_type_id = d.service_type_id
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
  containersForDossier, progressForDossier, capturesContainers, deliveredUnits, sequenceOnDossier,
  unitsOnDossier, linesOnDossier,
  dossierBrief, dossierForPrefill,
};
