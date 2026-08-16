/** Partnership request (MOD-25) — repository. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const TABLE = "partnership_request";

/**
 * Empty string to null. The legacy PHP posts `""` for every blank field on the
 * public form, and `""` lands as `""`, so `WHERE country_of_origin = $1` then
 * matches nothing and the filter looks broken while the column looks populated.
 */
const blankToNull = (v) => (v === "" || v === undefined ? null : v);

/**
 * The memberships, normalised on the way in.
 *
 * Accepts an array (the API shape), a JSON string, or the legacy's
 * comma-separated text — because F13 will point a website at this and the
 * website is the legacy's form. Always STORES an array, so no consumer has to
 * carry the legacy's two-branch decode. Entries are trimmed, de-duplicated
 * case-insensitively, and capped: a membership list is WCA, JCTrans and maybe
 * three more, and an unbounded array on a public endpoint is a free write
 * amplifier.
 */
const MAX_MEMBERSHIPS = 25;
function normaliseMemberships(value) {
  let list = value;
  if (list === null || list === undefined || list === "") return [];
  if (typeof list === "string") {
    const trimmed = list.trim();
    if (trimmed.startsWith("[")) {
      try { list = JSON.parse(trimmed); } catch { list = trimmed.split(","); }
    } else list = trimmed.split(",");
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const s = String(raw === null ? "" : raw).trim().slice(0, 60);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= MAX_MEMBERSHIPS) break;
  }
  return out;
}

/** Columns a caller may write. Everything else is set by the service or a trigger. */
const WRITABLE = [
  "company_name", "country_of_origin", "website", "contact_name", "contact_title",
  "email", "contact_phone", "proposal_type", "intake_channel", "network_memberships",
  "proposal_text", "internal_notes",
];

/** Applicant-facing fields — frozen once the application is decided. */
const APPLICANT_FIELDS = WRITABLE.filter((c) => c !== "internal_notes");

function shape(data = {}) {
  const row = {};
  for (const k of WRITABLE) {
    if (data[k] === undefined) continue;
    row[k] = k === "network_memberships"
      ? JSON.stringify(normaliseMemberships(data[k]))
      : blankToNull(data[k]);
  }
  return row;
}

function insert(client, data) {
  return insertOne(client, TABLE, {
    ...shape(data),
    company_name: blankToNull(data.company_name),
    proposal_type: data.proposal_type || "AGENCY_PARTNERSHIP",
    intake_channel: data.intake_channel || "MANUAL",
    network_memberships: JSON.stringify(normaliseMemberships(data.network_memberships)),
    status: "NEW",
  });
}

const get = (client, id) => getById(client, TABLE, "partnership_request_id", id);

async function update(client, id, fields) {
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, TABLE, "partnership_request_id", id, fields, "*", null, { touch: "updated_at" });
}

/* ─── filtering ───────────────────────────────────────────────────────────── */

/**
 * ONE WHERE builder for the list, the total, both KPI GROUP BYs and the export.
 *
 * `includeStatus` / `includeType` are the only differences between them: each
 * partition drops its OWN filter so that a user looking at status=APPROVED
 * still sees the whole status summary rather than one tile equal to the total
 * and the rest at zero. Four hand-copied WHERE clauses is how a register and
 * its own counters drift apart.
 */
function buildWhere(q = {}, { includeStatus = true, includeType = true } = {}) {
  const wh = [];
  const params = [];
  if (includeStatus && q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (includeType && q.proposal_type) { params.push(q.proposal_type); wh.push("proposal_type = $" + params.length); }
  if (q.intake_channel) { params.push(q.intake_channel); wh.push("intake_channel = $" + params.length); }
  // "Which application produced this supplier" — the reverse of the back-link,
  // so the supplier register can point at its own origin without a column on
  // supplier_master pointing back into sales.
  if (q.supplier_id) { params.push(q.supplier_id); wh.push("supplier_id = $" + params.length); }
  if (q.country_of_origin) { params.push(q.country_of_origin); wh.push("country_of_origin = $" + params.length); }
  // "Which applicants claim WCA" — the vetting question the field exists for.
  // jsonb containment, so it rides ix_partnership_request_networks (GIN).
  if (q.network) { params.push(JSON.stringify([q.network])); wh.push("network_memberships @> $" + params.length + "::jsonb"); }
  if (q.month) { params.push(Number(q.month)); wh.push("EXTRACT(MONTH FROM created_at) = $" + params.length); }
  if (q.year) { params.push(Number(q.year)); wh.push("EXTRACT(YEAR FROM created_at) = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const i = params.length;
    wh.push(`(company_name ILIKE $${i} OR country_of_origin ILIKE $${i}`
      + ` OR contact_name ILIKE $${i} OR email ILIKE $${i})`);
  }
  return { where: wh.length ? "WHERE " + wh.join(" AND ") : "", params };
}

const SORTABLE = ["created_at", "company_name", "status", "proposal_type", "country_of_origin"];
const orderBy = (q = {}) =>
  `ORDER BY ${SORTABLE.includes(q.sort) ? q.sort : "created_at"} ${q.dir === "asc" ? "ASC" : "DESC"}`;

/** Rows, total, and BOTH partitions — one round trip's worth of register. */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const { where, params } = buildWhere(q);

  const { rows } = await client.query(
    `SELECT * FROM ${TABLE} ${where} ${orderBy(q)} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    params.concat([limit, offset]),
  );
  const { rows: totalRows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${TABLE} ${where}`, params);

  const s = buildWhere(q, { includeStatus: false });
  const { rows: statusRows } = await client.query(
    `SELECT status, COUNT(*)::int AS c FROM ${TABLE} ${s.where} GROUP BY status`, s.params);

  const t = buildWhere(q, { includeType: false });
  const { rows: typeRows } = await client.query(
    `SELECT proposal_type, COUNT(*)::int AS c FROM ${TABLE} ${t.where} GROUP BY proposal_type`, t.params);

  return { rows, total: totalRows[0] ? totalRows[0].c : 0, statusRows, typeRows, limit, offset };
}

/**
 * Every matching row, unpaginated — CSV export ONLY, and deliberately not
 * `list()` with a big page size: `page()` clamps to 200 and ignores anything
 * else, so that shape silently exports a prefix. `cap` bounds the statement and
 * the caller is TOLD when it bites.
 */
async function listForExport(client, q = {}, cap = 10000) {
  const { where, params } = buildWhere(q);
  const { rows } = await client.query(
    `SELECT * FROM ${TABLE} ${where} ${orderBy(q)} LIMIT $${params.length + 1}`,
    params.concat([cap + 1]),
  );
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

/* ─── the supplier side of the approval ───────────────────────────────────── */

/**
 * An existing supplier with this exact normalised name.
 *
 * DETERMINISTIC, not the fuzzy scorer in master/_shared/dedup.service.js. That
 * one is advisory by design ("possible duplicates", shown to a human, never
 * blocking) and the approval path needs a yes/no it can act on without asking:
 * approving the same company twice must not produce two payable parties. An
 * exact `name_norm` match is the one signal strong enough to reuse a record
 * silently; anything weaker stays the operator's call, and the register's
 * duplicate warning is where they make it.
 *
 * Archived suppliers are skipped — reviving one by side-effect of an unrelated
 * approval is not something the approver asked for.
 */
async function findSupplierByNameNorm(client, nameNorm) {
  if (!nameNorm) return null;
  const { rows } = await client.query(
    `SELECT supplier_id, ref, name, registration_status
       FROM supplier_master
      WHERE name_norm = $1
        AND (registration_status IS NULL OR registration_status <> 'ARCHIVED')
      ORDER BY created_at
      LIMIT 1`,
    [nameNorm],
  );
  return rows[0] || null;
}

/** The tenant's only active corporate entity, or null when there is a choice to make. */
async function defaultEntityId(client) {
  const { rows } = await client.query(
    "SELECT entity_id FROM corporate_entity WHERE is_active IS NOT false LIMIT 2",
  );
  return rows.length === 1 ? rows[0].entity_id : null;
}

module.exports = {
  insert, get, update, list, listForExport,
  findSupplierByNameNorm, defaultEntityId,
  buildWhere, shape, normaliseMemberships,
  WRITABLE, APPLICANT_FIELDS, MAX_MEMBERSHIPS,
};
