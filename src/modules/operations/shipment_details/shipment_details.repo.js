/**
 * Reads behind the Shared Shipment/Service Detail Component.
 *
 * Everything here answers one of two questions: "what form does this service
 * type define?" and "what does this dossier hold for it?". The composition and
 * the meaning live in `.rules` and `.service`; this file is only SQL.
 */
"use strict";

const { insertOne, updateOne } = require("../../../shared/db/query-helpers");

/**
 * Column list for a field. `service_type_field.*` would work, but naming them
 * keeps the projection's contract visible at the point the data is fetched —
 * and stops a column added later leaking into an API response by accident.
 */
const FIELD_COLS = `
  f.service_type_field_id, f.service_type_field_set_id,
  f.group_code, f.group_label_fr, f.group_label_en, f.group_seq,
  f.seq, f.key, f.label_fr, f.label_en, f.help_text_fr, f.help_text_en,
  f.placeholder, f.data_type, f.options_json, f.ref_kind, f.validation_json,
  f.default_value, f.is_required, f.is_client_visible, f.is_readonly, f.is_active, f.is_system,
  f.facet_role, f.column_name, f.width`;

/** The ACTIVE field set for a service type, or null when its owner has not
 *  defined one. Null is a normal state, not an error — the file still opens. */
async function activeFieldSet(client, serviceTypeId) {
  if (!serviceTypeId) return null;
  const { rows } = await client.query(
    `SELECT * FROM service_type_field_set
      WHERE service_type_id = $1 AND is_active LIMIT 1`,
    [serviceTypeId],
  );
  return rows[0] || null;
}

async function fieldSetById(client, fieldSetId) {
  if (!fieldSetId) return null;
  const { rows } = await client.query(
    "SELECT * FROM service_type_field_set WHERE service_type_field_set_id = $1",
    [fieldSetId],
  );
  return rows[0] || null;
}

/** Every version of a service type's form, newest first, each with its field
 *  count — the list the Service Type screen's Fields tab renders. */
async function fieldSetsFor(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT fs.*,
            (SELECT COUNT(*)::int FROM service_type_field f
              WHERE f.service_type_field_set_id = fs.service_type_field_set_id
                AND f.is_active) AS field_count,
            (SELECT COUNT(*)::int FROM dossier_visible d
              WHERE d.service_type_field_set_id = fs.service_type_field_set_id) AS dossier_count
       FROM service_type_field_set fs
      WHERE fs.service_type_id = $1
      ORDER BY fs.version DESC`,
    [serviceTypeId],
  );
  return rows;
}

/** Fields of one set, in render order. Inactive fields are included: a value
 *  captured before a field was retired must still be readable on old files. */
async function fieldsOf(client, fieldSetId, { activeOnly = false } = {}) {
  if (!fieldSetId) return [];
  const { rows } = await client.query(
    `SELECT ${FIELD_COLS} FROM service_type_field f
      WHERE f.service_type_field_set_id = $1
        ${activeOnly ? "AND f.is_active" : ""}
      ORDER BY f.group_seq, f.seq, f.key`,
    [fieldSetId],
  );
  return rows;
}

/**
 * The dossier, plus the two things the projection cannot render without: which
 * service type it is (for the panel's title) and the CARRIER'S NAME rather than
 * its uuid — a document that printed a uuid where the shipping line goes would
 * be worse than one that printed nothing.
 */
async function dossierFor(client, dossierId) {
  const { rows } = await client.query(
    `SELECT d.*,
            st.key   AS service_type_key,
            st.name_fr AS service_name_fr,
            st.name_en AS service_name_en,
            st.captures_containers,
            st.container_detail_mode,
            rp.name  AS rate_provider_name,
            cm.name  AS client_name
       FROM dossier d
       LEFT JOIN service_type   st ON st.service_type_id   = d.service_type_id
       LEFT JOIN rate_provider  rp ON rp.rate_provider_id  = d.rate_provider_id
       LEFT JOIN client_master  cm ON cm.client_id         = d.client_id
      WHERE d.dossier_id = $1`,
    [dossierId],
  );
  return rows[0] || null;
}

/**
 * The equipment on a file: grouped lines with their type resolved, plus the
 * per-box units when any have been recorded.
 *
 * `extra` from the registry rides along because it carries `teu` and `size` —
 * the facts anything charging per container computes on, and the reason the
 * lines point at `dictionary_ref` rather than storing a string.
 */
async function containersFor(client, dossierId) {
  const { rows } = await client.query(
    `SELECT l.dossier_container_line_id, l.dossier_id, l.seq, l.qty,
            l.gross_weight_kg, l.volume_cbm, l.notes,
            l.container_type_ref_id, l.load_mode_ref_id,
            ct.code AS container_type_code,
            ct.name_fr AS container_type_fr,
            ct.name_en AS container_type_en,
            ct.extra AS container_type_extra,
            lm.code AS load_mode_code,
            lm.name_fr AS load_mode_fr,
            lm.name_en AS load_mode_en,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'dossier_container_unit_id', u.dossier_container_unit_id,
                       'container_no', u.container_no,
                       'seal_no', u.seal_no,
                       'tare_kg', u.tare_kg,
                       'gross_weight_kg', u.gross_weight_kg,
                       'temperature_c', u.temperature_c,
                       'imdg_class', u.imdg_class,
                       'discharged_on', u.discharged_on,
                       'out_of_port_on', u.out_of_port_on,
                       'returned_on', u.returned_on,
                       'notes', u.notes)
                     ORDER BY u.container_no NULLS LAST, u.created_at)
                FROM dossier_container_unit u
               WHERE u.dossier_container_line_id = l.dossier_container_line_id
            ), '[]'::jsonb) AS units
       FROM dossier_container_line l
       JOIN dictionary_ref ct ON ct.ref_id = l.container_type_ref_id
       LEFT JOIN dictionary_ref lm ON lm.ref_id = l.load_mode_ref_id
      WHERE l.dossier_id = $1
      ORDER BY l.seq, ct.sort_order`,
    [dossierId],
  );
  return rows;
}

/* ── Writes: field sets and fields ─────────────────────────────────────────── */

/** Next version number for a service type's form. */
async function nextVersion(client, serviceTypeId) {
  const { rows } = await client.query(
    "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM service_type_field_set WHERE service_type_id = $1",
    [serviceTypeId],
  );
  return Number(rows[0].v);
}

async function insertFieldSet(client, data) {
  const { rows } = await client.query(
    `INSERT INTO service_type_field_set
       (service_type_id, version, is_active, name, source_version, is_system, published_at, created_by)
     VALUES ($1,$2,$3,$4,$5,false,$6,$7) RETURNING *`,
    [
      data.service_type_id, data.version, data.is_active === true, data.name || null,
      data.source_version || null, data.published_at || null, data.created_by || null,
    ],
  );
  return rows[0];
}

/**
 * Make one version the live one.
 *
 * Both statements, always, in the caller's transaction: the partial unique
 * index `ux_service_type_field_set_active` permits exactly one active row per
 * service type, so activating without first standing the others down raises
 * 23505 rather than silently doing nothing.
 */
async function activateFieldSet(client, serviceTypeId, fieldSetId) {
  await client.query(
    `UPDATE service_type_field_set SET is_active = false
      WHERE service_type_id = $1 AND is_active AND service_type_field_set_id <> $2`,
    [serviceTypeId, fieldSetId],
  );
  const { rows } = await client.query(
    `UPDATE service_type_field_set
        SET is_active = true, published_at = COALESCE(published_at, now())
      WHERE service_type_field_set_id = $1 RETURNING *`,
    [fieldSetId],
  );
  return rows[0] || null;
}

/** Copy every field of one set onto another — the clone behind "edit the live
 *  form", which never mutates a published version in place. */
async function copyFields(client, fromSetId, toSetId) {
  const { rowCount } = await client.query(
    `INSERT INTO service_type_field (
        service_type_field_set_id, group_code, group_label_fr, group_label_en, group_seq,
        seq, key, label_fr, label_en, help_text_fr, help_text_en, placeholder,
        data_type, options_json, ref_kind, validation_json, default_value,
        is_required, is_client_visible, is_active, is_system, facet_role, column_name, width)
     SELECT $2, group_code, group_label_fr, group_label_en, group_seq,
        seq, key, label_fr, label_en, help_text_fr, help_text_en, placeholder,
        data_type, options_json, ref_kind, validation_json, default_value,
        is_required, is_client_visible, is_active, is_system, facet_role, column_name, width
       FROM service_type_field WHERE service_type_field_set_id = $1`,
    [fromSetId, toSetId],
  );
  return rowCount;
}

const FIELD_WRITABLE = new Set([
  "group_code", "group_label_fr", "group_label_en", "group_seq", "seq", "key",
  "label_fr", "label_en", "help_text_fr", "help_text_en", "placeholder",
  "data_type", "options_json", "ref_kind", "validation_json", "default_value",
  // `is_readonly` (0670): the system fills this field in — marks & numbers is
  // the one that does today. Editable by the tenant like every other property
  // of a definition, rather than a magic facet_role check in the renderer.
  "is_required", "is_client_visible", "is_readonly", "is_active", "facet_role", "column_name", "width",
]);

/**
 * What `insertField` may write: every field property, PLUS the parent key it
 * supplies itself and never takes from a caller's payload.
 *
 * IT USED TO BE THE PARENT KEY ALONE — `new Set(["service_type_field_set_id"])`
 * — while the comment above it said "plus". `insertOne` runs `assertWritable`
 * over EVERY key of the object it is given, which is the parent key AND the
 * cleaned field properties, so every real column was rejected and adding a
 * field to a draft field set answered 422 every single time:
 *
 *   FIELD_NOT_WRITABLE: data_type, facet_role, group_code, key, label_en,
 *                       label_fr, seq
 *   POST /service-types/:id/field-sets/:setId/fields
 *
 * `updateField` below passes `FIELD_WRITABLE` and always worked, which is why
 * editing a field was fine and only creating one was impossible — an asymmetry
 * that reads as a puzzling UI bug rather than as one wrong argument.
 *
 * Derived from FIELD_WRITABLE rather than re-listed, so the two cannot drift:
 * a column added to one is a column the other accepts.
 */
const INSERT_WRITABLE = new Set([...FIELD_WRITABLE, "service_type_field_set_id"]);

async function insertField(client, fieldSetId, data) {
  // Through the shared helper, not a hand-rolled column list.
  //
  // WHY. `insertOne`/`updateOne` are the ONE place that validates every
  // identifier against a strict pattern and double-quotes it (SEC H3), and they
  // take the allow-list as an argument so mass assignment is closed too. The
  // first version of this file built `INSERT INTO … (${cols})` itself from
  // Object.entries — allow-listed, so safe in fact, but it re-created by hand
  // exactly the construction query-helpers exists to centralise, and a static
  // analyser cannot tell the two apart. A shared helper that some repos bypass
  // is a helper that protects nothing.
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (FIELD_WRITABLE.has(k)) clean[k] = v;
  }
  return insertOne(
    client,
    "service_type_field",
    { service_type_field_set_id: fieldSetId, ...clean },
    "*",
    INSERT_WRITABLE,
  );
}

async function updateField(client, fieldId, patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (FIELD_WRITABLE.has(k)) clean[k] = v;
  }
  if (!Object.keys(clean).length) return getField(client, fieldId);
  return updateOne(client, "service_type_field", "service_type_field_id", fieldId, clean, "*", FIELD_WRITABLE);
}

async function getField(client, fieldId) {
  const { rows } = await client.query(
    `SELECT ${FIELD_COLS} FROM service_type_field f WHERE f.service_type_field_id = $1`,
    [fieldId],
  );
  return rows[0] || null;
}

async function deleteField(client, fieldId) {
  const { rows } = await client.query(
    "DELETE FROM service_type_field WHERE service_type_field_id = $1 RETURNING *",
    [fieldId],
  );
  return rows[0] || null;
}

/** Is this version referenced by any file? Drives whether an edit may happen in
 *  place or has to become a new version. */
async function fieldSetInUse(client, fieldSetId) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM dossier_visible WHERE service_type_field_set_id = $1",
    [fieldSetId],
  );
  return Number(rows[0].n) > 0;
}

module.exports = {
  activeFieldSet,
  fieldSetById,
  fieldSetsFor,
  fieldsOf,
  dossierFor,
  containersFor,
  nextVersion,
  insertFieldSet,
  activateFieldSet,
  copyFields,
  insertField,
  updateField,
  getField,
  deleteField,
  fieldSetInUse,
};
