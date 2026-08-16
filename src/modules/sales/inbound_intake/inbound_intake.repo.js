/** Inbound intake (MOD-25) — repository. All SQL lives here.
 *
 * Two registers share this file today: contact enquiries (F9, rebuilt below)
 * and partnership requests (F10 is moving those into
 * src/modules/sales/partnership_request/ — the functions at the bottom are left
 * exactly as they were so that move is a deletion, not a merge).
 */
"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");

const TABLE = "contact_enquiry";
const RESPONSE_TABLE = "contact_enquiry_response";

/**
 * Coerce empty string to null for nullable text columns. A public contact form
 * posts `""` for every field the visitor left blank, and `""` lands as `""`, so
 * `WHERE company_name = $n` matches nothing and the filter looks broken while
 * the row is plainly on screen.
 */
const blankToNull = (v) => (v === "" || v === undefined ? null : v);

/**
 * Columns a caller may write.
 *
 * `status`, `lead_id`, `partnership_request_id`, `responded_at` and
 * `responded_by_user_id` are NOT here on purpose: each is set by exactly one
 * service operation (transition, triage, respond), and every one of them is the
 * answer to a question the register asks. A generic PATCH that could set
 * `status` directly is how a lifecycle guard gets bypassed, and a PATCH that
 * could set `lead_id` is how "was this triaged" starts having two answers.
 */
const WRITABLE = [
  "name", "email", "phone", "subject", "message", "source",
  "enquiry_type", "company_name", "internal_notes",
];

/* ─── enquiries ───────────────────────────────────────────────────────────── */

function insertEnquiry(client, data) {
  return insertOne(client, TABLE, {
    name: blankToNull(data.name),
    email: blankToNull(data.email),
    phone: blankToNull(data.phone),
    company_name: blankToNull(data.company_name),
    subject: blankToNull(data.subject),
    message: blankToNull(data.message),
    source: data.source || "WEBSITE",
    enquiry_type: data.enquiry_type || "GENERAL_ENQUIRY",
    internal_notes: blankToNull(data.internal_notes),
    status: "NEW",
  });
}

const getEnquiry = (client, id) => getById(client, TABLE, "contact_enquiry_id", id);

/**
 * PERF S19/S20: was a hand-rolled SET builder, which bypassed the identifier
 * validation and writable allow-list in query-helpers.
 *
 * `touch: updated_at` — the column did not exist before 0689, so "when did this
 * last change" was unanswerable and every write looked as old as the message.
 */
async function updEnquiry(client, id, fields) {
  return updateOne(client, TABLE, "contact_enquiry_id", id, fields, "*", null, { touch: "updated_at" });
}

/**
 * ONE WHERE builder, used by the list, the total, the KPI and the export.
 *
 * `includeStatus` is the only difference between them. Four hand-copied WHERE
 * clauses is how a register and its own summary drift apart — which is the
 * defect class F9 is correcting, so they are built from one function and the
 * divergence is a single boolean.
 */
function buildWhere(q = {}, { includeStatus = true } = {}) {
  const wh = [];
  const params = [];
  if (includeStatus && q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.enquiry_type) { params.push(q.enquiry_type); wh.push("enquiry_type = $" + params.length); }
  if (q.source) { params.push(q.source); wh.push("source = $" + params.length); }
  // "Show me the ones that produced something" / "the ones that did not" — the
  // triage question, asked of the FK rather than of a status value.
  if (q.triaged === "true") wh.push("(lead_id IS NOT NULL OR partnership_request_id IS NOT NULL)");
  if (q.triaged === "false") wh.push("(lead_id IS NULL AND partnership_request_id IS NULL)");
  if (q.month) { params.push(Number(q.month)); wh.push("EXTRACT(MONTH FROM created_at) = $" + params.length); }
  if (q.year) { params.push(Number(q.year)); wh.push("EXTRACT(YEAR FROM created_at) = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const i = params.length;
    wh.push(
      `(name ILIKE $${i} OR email::text ILIKE $${i} OR company_name ILIKE $${i}` +
      ` OR subject ILIKE $${i} OR message ILIKE $${i} OR phone ILIKE $${i})`,
    );
  }
  return { where: wh.length ? "WHERE " + wh.join(" AND ") : "", params };
}

const SORTABLE = ["created_at", "status", "enquiry_type", "name"];
const orderBy = (q = {}) =>
  `ORDER BY ${SORTABLE.includes(q.sort) ? q.sort : "created_at"} ${q.dir === "asc" ? "ASC" : "DESC"}`;

/**
 * List + total + the KPI GROUP BY.
 *
 * The KPI drops the STATUS filter and keeps every other one, so a user looking
 * at status=RESPONDED still sees the whole summary rather than one tile equal
 * to the total and the rest at zero (a tautology, not data).
 *
 * It also runs over the WHOLE filtered set, not over the page. The legacy
 * computes its tiles in PHP by looping the rows it just fetched under
 * `LIMIT 200` — so a desk with 300 messages reports "Total: 200", and the
 * number is wrong in the direction that looks plausible.
 */
async function listEnquiries(client, q = {}) {
  const { limit, offset } = page(q);
  const { where, params } = buildWhere(q);

  const { rows } = await client.query(
    `SELECT * FROM ${TABLE} ${where} ${orderBy(q)} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    params.concat([limit, offset]),
  );
  const { rows: totalRows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM ${TABLE} ${where}`, params,
  );

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
 * Separate from listEnquiries on purpose: `page()` clamps to 200 and reads only
 * `limit`/`offset`, so an export that calls the list with a large `pageSize`
 * silently writes the first 50 rows. A truncated export that reports no error
 * is worse than one that refuses — the operator opens it in Excel and believes
 * it. `cap` bounds the statement, and the caller is TOLD when it bites.
 */
async function listEnquiriesForExport(client, q = {}, cap = 10000) {
  const { where, params } = buildWhere(q);
  const { rows } = await client.query(
    `SELECT * FROM ${TABLE} ${where} ${orderBy(q)} LIMIT $${params.length + 1}`,
    params.concat([cap + 1]),
  );
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

/* ─── replies ─────────────────────────────────────────────────────────────── */

/** A reply attempt, written PENDING before the mail engine is called. */
function insertResponse(client, { contact_enquiry_id, to_address, subject, body, created_by_user_id = null }) {
  return insertOne(client, RESPONSE_TABLE, {
    contact_enquiry_id,
    to_address,
    subject: blankToNull(subject),
    body,
    send_status: "PENDING",
    created_by_user_id,
  });
}

/** Settle a PENDING attempt to SENT or FAILED once the transport has answered. */
function settleResponse(client, id, fields) {
  return updateOne(client, RESPONSE_TABLE, "contact_enquiry_response_id", id, fields);
}

async function listResponses(client, contact_enquiry_id) {
  const { rows } = await client.query(
    `SELECT * FROM ${RESPONSE_TABLE} WHERE contact_enquiry_id = $1 ORDER BY created_at DESC`,
    [contact_enquiry_id],
  );
  return rows;
}

/* ─── partnership requests ────────────────────────────────────────────────
 *
 * MOVED in F10 to src/modules/sales/partnership_request/ (basePath
 * /partnership-requests). F9 left these here marked "F10 territory"; this is
 * F10 collecting them.
 *
 * They could not stay: migration 0688 replaces the table's status vocabulary
 * with the legacy API's own NEW / IN_REVIEW / APPROVED / REJECTED, so the
 * `review` validator below — REVIEWING / ACCEPTED / DECLINED — now writes
 * values the CHECK constraint refuses. An endpoint that 23514s on every call
 * is not a back-compatible alias.
 *
 * Triage still raises a partnership request: it does it through
 * partnership_request.repo, above, which is the F10 register.
 */

module.exports = {
  insertEnquiry, getEnquiry, updEnquiry, listEnquiries, listEnquiriesForExport,
  insertResponse, settleResponse, listResponses,
  buildWhere, WRITABLE,
};
