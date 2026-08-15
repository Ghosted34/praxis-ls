/** Quote request (MOD-20-intake) — repository. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const TABLE = "quote_request";
const ATTACHMENT_TABLE = "quote_request_attachment";

/**
 * Coerce empty string to null for nullable text columns. The legacy PHP sent
 * `""` for blank form fields and they landed as `""`; we drop them so the
 * status filter `WHERE service_category = $n` matches expected behaviour.
 */
const blankToNull = (v) => (v === "" || v === undefined ? null : v);

function insert(client, data) {
  return insertOne(client, TABLE, {
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
  });
}

function get(client, id) {
  return getById(client, TABLE, "quote_request_id", id);
}

async function update(client, id, fields) {
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, TABLE, "quote_request_id", id, fields, "*", null, { touch: "updated_at" });
}

/**
 * List with filters. Mirrors the legacy `quote_requests/list.php` parameter
 * set (q, status, channel, month, year, sort, page, pageSize) but the KPI
 * computation is the new way: one source of truth, two summaries.
 *
 * Returns { rows, total, kpi }. The KPI is computed from the SAME WHERE
 * clause as the list (minus the `status` filter — that would be tautological),
 * so the five tiles sum to the visible total under any non-status filter.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const wh = [];
  const params = [];

  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.intake_channel) { params.push(q.intake_channel); wh.push("intake_channel = $" + params.length); }
  if (q.service_category) { params.push(q.service_category); wh.push("service_category = $" + params.length); }
  if (q.month) { params.push(Number(q.month)); wh.push("EXTRACT(MONTH FROM created_at) = $" + params.length); }
  if (q.year) { params.push(Number(q.year)); wh.push("EXTRACT(YEAR FROM created_at) = $" + params.length); }
  if (q.q) {
    const pat = "%" + q.q + "%";
    params.push(pat);
    const i = params.length;
    wh.push(
      `(public_ref ILIKE $${i} OR requester_name ILIKE $${i} OR requester_email ILIKE $${i}` +
      ` OR requester_company ILIKE $${i} OR origin_location ILIKE $${i}` +
      ` OR destination_location ILIKE $${i} OR cargo_description ILIKE $${i})`,
    );
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const sortCol = ["created_at", "public_ref", "status", "requester_name"].includes(q.sort) ? q.sort : "created_at";
  const sortDir = q.dir === "asc" ? "ASC" : "DESC";

  const listSql = `SELECT * FROM ${TABLE} ${where} ORDER BY ${sortCol} ${sortDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const listParams = params.concat([limit, offset]);
  const { rows } = await client.query(listSql, listParams);

  // Total under the same filters (with status if given).
  const totalSql = `SELECT COUNT(*)::int AS c FROM ${TABLE} ${where}`;
  const { rows: totalRows } = await client.query(totalSql, params);
  const total = totalRows[0]?.c || 0;

  // KPI tiles: rebuild WHERE without the status filter so RECEIVED, etc. are
  // NOT zeroed by a status=QUOTED filter. Everything else (channel, month,
  // year, q) is applied — that's the whole point of "KPIs under every
  // filter combination". A status filter would still make the corresponding
  // tile = total and the others = 0, which is a tautology the legacy
  // accidentally computed as data.
  const kpiWh = [];
  const kpiParams = [];
  if (q.intake_channel) { kpiParams.push(q.intake_channel); kpiWh.push("intake_channel = $" + kpiParams.length); }
  if (q.service_category) { kpiParams.push(q.service_category); kpiWh.push("service_category = $" + kpiParams.length); }
  if (q.month) { kpiParams.push(Number(q.month)); kpiWh.push("EXTRACT(MONTH FROM created_at) = $" + kpiParams.length); }
  if (q.year) { kpiParams.push(Number(q.year)); kpiWh.push("EXTRACT(YEAR FROM created_at) = $" + kpiParams.length); }
  if (q.q) {
    const pat = "%" + q.q + "%";
    kpiParams.push(pat);
    const i = kpiParams.length;
    kpiWh.push(
      `(public_ref ILIKE $${i} OR requester_name ILIKE $${i} OR requester_email ILIKE $${i}` +
      ` OR requester_company ILIKE $${i} OR origin_location ILIKE $${i}` +
      ` OR destination_location ILIKE $${i} OR cargo_description ILIKE $${i})`,
    );
  }
  const kpiWhere = kpiWh.length ? "WHERE " + kpiWh.join(" AND ") : "";
  const kpiSql = `SELECT status, COUNT(*)::int AS c FROM ${TABLE} ${kpiWhere} GROUP BY status`;
  const { rows: kpiRows } = await client.query(kpiSql, kpiParams);
  const kpi = { TOTAL: 0, RECEIVED: 0, UNDER_REVIEW: 0, QUOTED: 0, CONVERTED_TO_OPPORTUNITY: 0 };
  for (const r of kpiRows) {
    kpi.TOTAL += r.c;
    if (kpi[r.status] !== undefined && kpi[r.status] !== null) kpi[r.status] = r.c;
  }

  return { rows, total, kpi };
}

/* ─── attachments ─────────────────────────────────────────────────────────── */

function addAttachment(client, { quote_request_id, vault_id, kind = "ADDITIONAL", uploaded_by_user_id = null }) {
  return insertOne(client, ATTACHMENT_TABLE, { quote_request_id, vault_id, kind, uploaded_by_user_id });
}

async function listAttachments(client, quote_request_id) {
  const { rows } = await client.query(
    `SELECT a.quote_request_attachment_id AS id, a.kind, a.created_at, a.vault_id, v.storage_path, v.original_name, v.content_hash
     FROM ${ATTACHMENT_TABLE} a
     LEFT JOIN document_vault v ON v.doc_id = a.vault_id
     WHERE a.quote_request_id = $1
     ORDER BY (CASE WHEN a.kind = 'PRIMARY' THEN 0 ELSE 1 END), a.created_at`,
    [quote_request_id],
  );
  return rows;
}

async function removeAttachment(client, { quote_request_id, attachment_id }) {
  const { rowCount } = await client.query(
    `DELETE FROM ${ATTACHMENT_TABLE} WHERE quote_request_attachment_id = $1 AND quote_request_id = $2`,
    [attachment_id, quote_request_id],
  );
  return rowCount > 0;
}

module.exports = { insert, get, update, list, addAttachment, listAttachments, removeAttachment };
