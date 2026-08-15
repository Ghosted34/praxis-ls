/** Quote request (MOD-20-intake) — repository. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const TABLE = "quote_request";
const ATTACHMENT_TABLE = "quote_request_attachment";

/**
 * Coerce empty string to null for nullable text columns. The legacy PHP sent
 * `""` for blank form fields and they landed as `""`, so `WHERE
 * service_category = $n` matched nothing and the filter looked broken.
 */
const blankToNull = (v) => (v === "" || v === undefined ? null : v);

/** Columns a caller may write. Everything else is set by the service or a trigger. */
const WRITABLE = [
  "entity_id", "public_ref", "lead_id", "intake_channel",
  "requester_name", "requester_company", "requester_email", "requester_phone",
  "service_category", "service_type", "origin_location", "destination_location",
  "warehouse_location", "warehouse_duration", "estimated_weight",
  "project_cargo_flag", "cargo_description", "incoterm", "owner_user_id",
];

/**
 * INSERT.
 *
 * `public_ref` is written HERE, in the same statement as the row — not by a
 * follow-up UPDATE. The previous shape inserted the row, allocated the number,
 * then updated; `public_ref` was also absent from this field map, so a
 * caller-supplied reference was silently discarded and the column relied
 * entirely on the second write landing. One statement, one row, one number.
 */
function insert(client, data) {
  const row = {
    entity_id: blankToNull(data.entity_id),
    public_ref: blankToNull(data.public_ref),
    lead_id: blankToNull(data.lead_id),
    intake_channel: data.intake_channel || "MANUAL",
    requester_name: blankToNull(data.requester_name),
    requester_company: blankToNull(data.requester_company),
    requester_email: blankToNull(data.requester_email),
    requester_phone: blankToNull(data.requester_phone),
    service_category: blankToNull(data.service_category),
    service_type: blankToNull(data.service_type),
    origin_location: blankToNull(data.origin_location),
    destination_location: blankToNull(data.destination_location),
    warehouse_location: blankToNull(data.warehouse_location),
    warehouse_duration: blankToNull(data.warehouse_duration),
    estimated_weight: data.estimated_weight ?? null,
    project_cargo_flag: data.project_cargo_flag || false,
    cargo_description: blankToNull(data.cargo_description),
    incoterm: data.incoterm,
    status: "RECEIVED",
    owner_user_id: blankToNull(data.owner_user_id),
    created_by_user_id: blankToNull(data.created_by_user_id),
  };
  return insertOne(client, TABLE, row);
}

function get(client, id) {
  return getById(client, TABLE, "quote_request_id", id);
}

async function update(client, id, fields) {
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, TABLE, "quote_request_id", id, fields, "*", null, { touch: "updated_at" });
}

/**
 * The tenant's default corporate entity, for numbering.
 *
 * Returns the single active entity, or null when there are none or more than
 * one. Null is deliberate and is NOT "pick the oldest": a tenant trading
 * through two entities has no default, and guessing would file an enquiry — and
 * its reference number — under the wrong company. The service turns null into a
 * 422 naming the field, so the operator chooses.
 */
async function defaultEntityId(client) {
  const { rows } = await client.query(
    "SELECT entity_id FROM corporate_entity WHERE is_active IS NOT false LIMIT 2",
  );
  return rows.length === 1 ? rows[0].entity_id : null;
}

/* ─── filtering ───────────────────────────────────────────────────────────── */

/**
 * ONE WHERE builder, used by the list, the total, the KPI and the export.
 *
 * `includeStatus` is the only difference between them. Four hand-copied WHERE
 * clauses is how the list and its own summary drift apart, which is the defect
 * class this feature is correcting — so they are built from one function and
 * the divergence is a single boolean.
 */
function buildWhere(q = {}, { includeStatus = true } = {}) {
  const wh = [];
  const params = [];
  if (includeStatus && q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.intake_channel) { params.push(q.intake_channel); wh.push("intake_channel = $" + params.length); }
  if (q.service_category) { params.push(q.service_category); wh.push("service_category = $" + params.length); }
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.month) { params.push(Number(q.month)); wh.push("EXTRACT(MONTH FROM created_at) = $" + params.length); }
  if (q.year) { params.push(Number(q.year)); wh.push("EXTRACT(YEAR FROM created_at) = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const i = params.length;
    wh.push(
      `(public_ref ILIKE $${i} OR requester_name ILIKE $${i} OR requester_email ILIKE $${i}` +
      ` OR requester_company ILIKE $${i} OR origin_location ILIKE $${i}` +
      ` OR destination_location ILIKE $${i} OR cargo_description ILIKE $${i})`,
    );
  }
  return { where: wh.length ? "WHERE " + wh.join(" AND ") : "", params };
}

const SORTABLE = ["created_at", "public_ref", "status", "requester_name"];
const orderBy = (q = {}) =>
  `ORDER BY ${SORTABLE.includes(q.sort) ? q.sort : "created_at"} ${q.dir === "asc" ? "ASC" : "DESC"}`;

/**
 * List + total + the KPI GROUP BY.
 *
 * The KPI drops the STATUS filter and keeps every other one, so a user looking
 * at status=QUOTED still sees the whole summary rather than one tile equal to
 * the total and the rest at zero (which is a tautology, not data). It groups by
 * status with no hand-written list of which statuses count — the fold in
 * `rules.kpiFrom` owns that, and it is proven to partition.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const { where, params } = buildWhere(q);

  const { rows } = await client.query(
    `SELECT * FROM ${TABLE} ${where} ${orderBy(q)} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    params.concat([limit, offset]),
  );

  const { rows: totalRows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${TABLE} ${where}`, params);

  const kpiQ = buildWhere(q, { includeStatus: false });
  const { rows: kpiRows } = await client.query(
    `SELECT status, COUNT(*)::int AS c FROM ${TABLE} ${kpiQ.where} GROUP BY status`,
    kpiQ.params,
  );

  return { rows, total: totalRows[0] ? totalRows[0].c : 0, kpiRows, limit, offset };
}

/**
 * Every matching row, unpaginated — for the CSV export ONLY.
 *
 * Separate from list() on purpose. The export used to call list() with
 * `pageSize: 100000`, and `page()` reads `limit`/`offset` and clamps to 200, so
 * `pageSize` was ignored entirely and the export silently wrote the first 50
 * rows. A truncated export that reports no error is worse than one that
 * refuses: the operator opens it in Excel and believes it.
 *
 * `cap` bounds the statement so an export cannot become an unbounded scan; the
 * caller is told when it bites (see the service) rather than being handed a
 * prefix.
 */
async function listForExport(client, q = {}, cap = 10000) {
  const { where, params } = buildWhere(q);
  const { rows } = await client.query(
    `SELECT * FROM ${TABLE} ${where} ${orderBy(q)} LIMIT $${params.length + 1}`,
    params.concat([cap + 1]),
  );
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

/* ─── attachments ─────────────────────────────────────────────────────────── */

function addAttachment(client, { quote_request_id, vault_id, kind = "ADDITIONAL", uploaded_by_user_id = null }) {
  return insertOne(client, ATTACHMENT_TABLE, { quote_request_id, vault_id, kind, uploaded_by_user_id });
}

async function listAttachments(client, quote_request_id) {
  const { rows } = await client.query(
    `SELECT a.quote_request_attachment_id AS id, a.kind, a.created_at, a.vault_id,
            v.storage_path, v.original_name, v.content_hash
       FROM ${ATTACHMENT_TABLE} a
       LEFT JOIN document_vault v ON v.doc_id = a.vault_id
      WHERE a.quote_request_id = $1
      ORDER BY (CASE WHEN a.kind = 'PRIMARY' THEN 0 ELSE 1 END), a.created_at`,
    [quote_request_id],
  );
  return rows;
}

async function getAttachment(client, { quote_request_id, attachment_id }) {
  const { rows } = await client.query(
    `SELECT * FROM ${ATTACHMENT_TABLE} WHERE quote_request_attachment_id = $1 AND quote_request_id = $2`,
    [attachment_id, quote_request_id],
  );
  return rows[0] || null;
}

async function removeAttachment(client, { quote_request_id, attachment_id }) {
  const { rowCount } = await client.query(
    `DELETE FROM ${ATTACHMENT_TABLE} WHERE quote_request_attachment_id = $1 AND quote_request_id = $2`,
    [attachment_id, quote_request_id],
  );
  return rowCount > 0;
}

/** Demote whatever is currently PRIMARY, so at most one ever is. */
async function demotePrimary(client, quote_request_id) {
  await client.query(
    `UPDATE ${ATTACHMENT_TABLE} SET kind = 'ADDITIONAL' WHERE quote_request_id = $1 AND kind = 'PRIMARY'`,
    [quote_request_id],
  );
}

module.exports = {
  insert, get, update, list, listForExport, defaultEntityId,
  addAttachment, listAttachments, getAttachment, removeAttachment, demotePrimary,
  buildWhere, WRITABLE,
};
