/** Lead repository (MOD-20). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "lead", data);
const get = (client, id) => getById(client, "lead", "lead_id", id);
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "lead", "lead_id", id, fields, "*", null, { touch: "updated_at" });
}
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.owner_user_id) { params.push(q.owner_user_id); wh.push("owner_user_id = $" + params.length); }
  if (q.intake_channel) { params.push(q.intake_channel); wh.push("intake_channel = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("(company_name ILIKE $" + params.length + " OR contact_name ILIKE $" + params.length + " OR email ILIKE $" + params.length + ")"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM lead " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
/**
 * Resolve a client_type CODE ('SHIPPER', 'BOTH', …) to its id.
 *
 * `client_master` has a `client_type_id` FK and NO `client_type` column, so the
 * code the convert drawer collects has to be looked up before the master row is
 * written. Passing the code straight through — which is what the convert path
 * did — reached `insertOne` with an allow-list of null, which puts every key
 * into the INSERT column list verbatim, and Postgres answered 42703 "column
 * client_type of relation client_master does not exist". The conversion failed
 * for every lead, and the unit test did not see it because it mocks
 * clientMaster.create.
 *
 * citext PK on `code`, so the comparison is already case-insensitive.
 */
async function clientTypeIdByCode(client, code) {
  if (!code) return null;
  const { rows } = await client.query(
    "SELECT client_type_id FROM client_type WHERE code = $1", [code],
  );
  return rows[0] ? rows[0].client_type_id : null;
}

/**
 * The tenant's default corporate entity, or null when the choice is genuinely
 * ambiguous. Same rule as the intake register's: one active entity is a
 * default, two is a question. Never "the oldest" — that files a client, and its
 * reference number, under the wrong company.
 */
async function defaultEntityId(client) {
  const { rows } = await client.query(
    "SELECT entity_id FROM corporate_entity WHERE is_active IS NOT false LIMIT 2",
  );
  return rows.length === 1 ? rows[0].entity_id : null;
}

module.exports = { insert, get, update, list, clientTypeIdByCode, defaultEntityId };
