"use strict";

const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");

const ELIGIBLE_STATUSES = ["COMPLETED", "FINANCIALLY_PENDING", "CLOSED"];
const insert = (client, data) => insertOne(client, "success_story", data);
const get = (client, id) => getById(client, "success_story", "success_story_id", id);
const update = (client, id, fields) => updateOne(client, "success_story", "success_story_id", id, fields, "*", null);

async function replaceDossiers(client, id, ids) {
  await client.query("DELETE FROM success_story_dossier WHERE success_story_id = $1", [id]);
  for (const dossierId of ids) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      "INSERT INTO success_story_dossier(success_story_id, dossier_id) VALUES($1, $2) ON CONFLICT DO NOTHING",
      [id, dossierId],
    );
  }
}

async function dossiers(client, id) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.client_id, d.status, d.pol, d.pod,
            d.created_at, d.updated_at, st.key AS service_category,
            COALESCE(cm.name, cm.legal_name) AS client_name
       FROM success_story_dossier x
       JOIN dossier_visible d USING(dossier_id)
       LEFT JOIN service_type st USING(service_type_id)
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
      WHERE x.success_story_id = $1
      ORDER BY d.updated_at DESC`,
    [id],
  );
  return rows;
}

/** Direct, unpaginated eligibility lookup used as the authoritative save gate. */
async function eligibleByIds(client, ids) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.client_id, d.status, d.pol, d.pod,
            d.created_at, d.updated_at, st.key AS service_category,
            COALESCE(cm.name, cm.legal_name) AS client_name
       FROM dossier_visible d
       LEFT JOIN service_type st USING(service_type_id)
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
      WHERE d.dossier_id = ANY($1::uuid[])
        AND d.status = ANY($2::text[])`,
    [ids, ELIGIBLE_STATUSES],
  );
  return rows;
}

/** Searchable, page-aware picker. Financial columns are deliberately absent. */
async function eligible(client, query = {}) {
  const { limit, offset } = page(query);
  const q = String(query.q || "").trim();
  const params = [ELIGIBLE_STATUSES];
  let search = "";
  if (q) {
    params.push(`%${q}%`);
    search = ` AND (d.ref ILIKE $2 OR COALESCE(cm.name, cm.legal_name, '') ILIKE $2
                    OR COALESCE(d.pol, '') ILIKE $2 OR COALESCE(d.pod, '') ILIKE $2
                    OR COALESCE(st.key, '') ILIKE $2)`;
  }
  const count = await client.query(
    `SELECT count(*)::int AS total
       FROM dossier_visible d
       LEFT JOIN service_type st USING(service_type_id)
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
      WHERE d.status = ANY($1::text[])${search}`,
    params,
  );
  const pageParams = [...params, limit, offset];
  const li = pageParams.length - 1;
  const oi = pageParams.length;
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.client_id, d.status, d.pol, d.pod,
            d.created_at, d.updated_at, st.key AS service_category,
            COALESCE(cm.name, cm.legal_name) AS client_name
       FROM dossier_visible d
       LEFT JOIN service_type st USING(service_type_id)
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
      WHERE d.status = ANY($1::text[])${search}
      ORDER BY d.updated_at DESC, d.dossier_id
      LIMIT $${li} OFFSET $${oi}`,
    pageParams,
  );
  return { rows, total: count.rows[0]?.total || 0, limit, offset };
}

async function list(client, query = {}) {
  const { limit, offset } = page(query);
  const where = [];
  const params = [];
  if (query.published_only === "true" || query.published_only === true) where.push("is_published = true");
  if (query.q) {
    params.push(`%${String(query.q).trim()}%`);
    where.push(`(title ILIKE $${params.length} OR COALESCE(headline, '') ILIKE $${params.length})`);
  }
  params.push(limit, offset);
  const { rows } = await client.query(
    `SELECT * FROM success_story ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(published_at, created_at) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

module.exports = {
  ELIGIBLE_STATUSES,
  insert,
  get,
  update,
  list,
  replaceDossiers,
  dossiers,
  eligible,
  eligibleByIds,
};
