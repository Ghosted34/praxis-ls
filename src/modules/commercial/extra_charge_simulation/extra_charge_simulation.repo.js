/** Extra-charge simulation repository (MOD-28). All SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertSim = (client, data) => insertOne(client, "extra_charge_simulation", data);
const getSim = (client, id) => getById(client, "extra_charge_simulation", "extra_charge_simulation_id", id);

async function listSims(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM extra_charge_simulation WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

/** §3.2 prefill — the file's own facts, so nobody retypes what the system
 *  already knows: ATA from the dossier, the shipping line from the file's
 *  rate provider, and the container list from dossier_container_line joined
 *  to the container-type registry (the same rows the rate card prices). */
async function dossierPrefill(client, dossierId) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.ata, d.eta, d.vessel_flight, d.bl_mawb,
            rp.name AS shipping_line
       FROM dossier d
       LEFT JOIN rate_provider rp ON rp.rate_provider_id = d.rate_provider_id
      WHERE d.dossier_id = $1`,
    [dossierId],
  );
  return rows[0] || null;
}

async function dossierContainers(client, dossierId) {
  const { rows } = await client.query(
    `SELECT dr.code, l.qty
       FROM dossier_container_line l
       JOIN dictionary_ref dr ON dr.ref_id = l.container_type_ref_id
      WHERE l.dossier_id = $1
      ORDER BY l.seq, l.created_at`,
    [dossierId],
  );
  return rows;
}

module.exports = { insertSim, getSim, listSims, dossierPrefill, dossierContainers };
