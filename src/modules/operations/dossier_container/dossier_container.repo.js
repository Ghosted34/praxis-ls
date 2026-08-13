/**
 * SQL for a file's equipment. Reads that join the registry live in
 * `shipment_details.repo` (they are part of the projection); this file owns the
 * writes and the reference checks.
 */
"use strict";

/** Which of these ref_ids are live rows of the given kind. A Set so the caller
 *  can report exactly which ones were not, instead of "something is wrong". */
async function refsOfKind(client, ids, kind) {
  if (!ids.length) return new Set();
  const { rows } = await client.query(
    "SELECT ref_id FROM dictionary_ref WHERE kind = $1 AND is_active AND ref_id = ANY($2::uuid[])",
    [kind, ids],
  );
  return new Set(rows.map((r) => r.ref_id));
}

/** Units cascade from their line, so one delete clears both. */
async function deleteLines(client, dossierId) {
  const { rowCount } = await client.query(
    "DELETE FROM dossier_container_line WHERE dossier_id = $1",
    [dossierId],
  );
  return rowCount;
}

async function insertLine(client, dossierId, l) {
  const { rows } = await client.query(
    `INSERT INTO dossier_container_line
       (dossier_id, seq, container_type_ref_id, load_mode_ref_id, qty, gross_weight_kg, volume_cbm, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      dossierId,
      l.seq ?? 0,
      l.container_type_ref_id,
      l.load_mode_ref_id ?? null,
      l.qty ?? 1,
      l.gross_weight_kg ?? null,
      l.volume_cbm ?? null,
      l.notes ?? null,
    ],
  );
  return rows[0];
}

async function insertUnit(client, dossierId, lineId, u) {
  const { rows } = await client.query(
    `INSERT INTO dossier_container_unit
       (dossier_container_line_id, dossier_id, container_no, seal_no, tare_kg, gross_weight_kg,
        temperature_c, imdg_class, discharged_on, out_of_port_on, returned_on, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      lineId,
      dossierId,
      u.container_no ?? null,
      u.seal_no ?? null,
      u.tare_kg ?? null,
      u.gross_weight_kg ?? null,
      u.temperature_c ?? null,
      u.imdg_class ?? null,
      u.discharged_on ?? null,
      u.out_of_port_on ?? null,
      u.returned_on ?? null,
      u.notes ?? null,
    ],
  );
  return rows[0];
}

module.exports = { refsOfKind, deleteLines, insertLine, insertUnit };
