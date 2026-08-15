/** Marketing campaigns (MOD-22) — repository. All SQL lives here. */
"use strict";

const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");
const TABLE = "marketing_campaign";

/**
 * Columns a caller may write through create or patch.
 *
 * `status` is NOT here, and neither are the approval stamps. Both are set by
 * the service on the one path that is allowed to set them, so a PATCH cannot
 * put a campaign into ACTIVE and skip the approval the lifecycle exists to
 * impose — the same hole `requireLifecyclePermissionOnPatch` closes at the
 * route layer, shut a second time at the layer that writes.
 *
 * WHICH of these a given state accepts is `rules.assertEditable`, not this
 * list: this is "a caller may ever write it", that is "a caller may write it
 * now".
 */
const WRITABLE = [
  "name", "channel", "platform", "target_service", "owner_user_id",
  "starts_on", "ends_on", "budget_amount", "budget_currency", "remarks",
  "assets_json", "target_leads", "target_opportunities", "target_won",
  "actual_leads", "actual_opportunities", "actual_won",
];

/** Empty string to null, so a blank <select> does not land as '' and break `= $n`. */
const blankToNull = (v) => (v === "" || v === undefined ? null : v);

function insert(client, data) {
  return insertOne(client, TABLE, {
    name: data.name,
    channel: blankToNull(data.channel),
    platform: data.platform || "OTHER",
    target_service: data.target_service || "ALL",
    owner_user_id: blankToNull(data.owner_user_id),
    status: "DRAFT",
    starts_on: blankToNull(data.starts_on),
    ends_on: blankToNull(data.ends_on),
    budget_amount: data.budget_amount ?? 0,
    budget_currency: data.budget_currency || "XAF",
    remarks: blankToNull(data.remarks),
    assets_json: JSON.stringify(data.assets || {}),
    target_leads: data.target_leads ?? 0,
    target_opportunities: data.target_opportunities ?? 0,
    target_won: data.target_won ?? 0,
  });
}

const get = (client, id) => getById(client, TABLE, "campaign_id", id);

/** The row plus its owner's name — what the register and the drawer render. */
async function getWithOwner(client, id) {
  const { rows } = await client.query(
    `SELECT c.*, u.full_name AS owner_name
       FROM ${TABLE} c LEFT JOIN app_user u ON u.user_id = c.owner_user_id
      WHERE c.campaign_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  return updateOne(client, TABLE, "campaign_id", id, fields, "*", null, { touch: "updated_at" });
}

/* ─── filtering ───────────────────────────────────────────────────────────── */

/**
 * ONE WHERE builder, shared by the list, the count, the KPI aggregate and the
 * export. Four hand-copied WHERE clauses is how a register and its own summary
 * drift apart — the defect class the F6/F7/F8 slices exist to correct — so the
 * only difference between the four callers is which SELECT they put in front.
 *
 * The search covers the campaign name AND the owner's name, which is what the
 * legacy searches (api/marketing_campaign/list.php: `mc.name LIKE ? OR
 * mc.owner_name LIKE ?`). Here the owner is a relation rather than a denormalised
 * string, so the join is what makes the same search possible.
 */
function buildWhere(q = {}) {
  const wh = [];
  const params = [];
  if (q.status) { params.push(q.status); wh.push("c.status = $" + params.length); }
  if (q.platform) { params.push(q.platform); wh.push("c.platform = $" + params.length); }
  if (q.target_service) { params.push(q.target_service); wh.push("c.target_service = $" + params.length); }
  if (q.owner_user_id) { params.push(q.owner_user_id); wh.push("c.owner_user_id = $" + params.length); }
  if (q.month) { params.push(Number(q.month)); wh.push("EXTRACT(MONTH FROM COALESCE(c.starts_on, c.created_at::date)) = $" + params.length); }
  if (q.year) { params.push(Number(q.year)); wh.push("EXTRACT(YEAR FROM COALESCE(c.starts_on, c.created_at::date)) = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const i = params.length;
    wh.push(`(c.name ILIKE $${i} OR u.full_name ILIKE $${i} OR c.remarks ILIKE $${i})`);
  }
  return { where: wh.length ? "WHERE " + wh.join(" AND ") : "", params };
}

const FROM = `FROM ${TABLE} c LEFT JOIN app_user u ON u.user_id = c.owner_user_id`;

const SORTABLE = { created_at: "c.created_at", starts_on: "c.starts_on", name: "c.name", status: "c.status", budget_amount: "c.budget_amount" };
function orderBy(q = {}) {
  const col = SORTABLE[q.sort] || "c.starts_on";
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  // Start date first, creation as the tie-break — the legacy's ORDER BY, and the
  // order a marketer thinks in. NULLS LAST so an undated plan does not sit on top.
  return `ORDER BY ${col} ${dir} NULLS LAST, c.created_at DESC`;
}

/**
 * List + total + the KPI aggregate, in one round trip's worth of statements.
 *
 * THE KPI KEEPS THE STATUS FILTER, unlike the quote-request register's, and the
 * difference is deliberate. There the tiles are a PARTITION of the status
 * vocabulary, so filtering by status would make one tile equal the total and
 * the rest zero — a tautology. Here the tiles are sums of money and of counts
 * over whatever is on screen, so "total budget of the ACTIVE campaigns" is a
 * question with a real answer, and a summary that ignored the filter would
 * describe a set the operator is not looking at.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const { where, params } = buildWhere(q);

  const { rows } = await client.query(
    `SELECT c.*, u.full_name AS owner_name ${FROM} ${where} ${orderBy(q)}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    params.concat([limit, offset]),
  );

  const { rows: totalRows } = await client.query(
    `SELECT COUNT(*)::int AS c ${FROM} ${where}`, params,
  );

  // COALESCE on every aggregate: SUM over no rows is NULL, and a tile reading
  // "null" where it should read 0 is how an empty register looks broken.
  const { rows: aggRows } = await client.query(
    `SELECT COUNT(*)::int                        AS campaigns,
            COALESCE(SUM(c.budget_amount), 0)    AS total_budget,
            COALESCE(SUM(c.actual_leads), 0)::int         AS total_leads,
            COALESCE(SUM(c.actual_opportunities), 0)::int AS total_opportunities,
            COALESCE(SUM(c.actual_won), 0)::int           AS total_won,
            COALESCE(SUM(c.target_leads), 0)::int         AS target_leads,
            COALESCE(SUM(c.target_won), 0)::int           AS target_won
       ${FROM} ${where}`,
    params,
  );

  return {
    rows,
    total: totalRows[0] ? totalRows[0].c : 0,
    agg: aggRows[0] || {},
    limit,
    offset,
  };
}

/**
 * Every matching row, unpaginated — for the CSV export ONLY.
 *
 * Separate from list() for the reason quote_request.repo records at length:
 * `page()` clamps to 200 and reads only limit/offset, so an export that called
 * list() with a large `pageSize` would silently write the first page. `cap`
 * bounds the statement and the caller is TOLD when it bites.
 */
async function listForExport(client, q = {}, cap = 10000) {
  const { where, params } = buildWhere(q);
  const { rows } = await client.query(
    `SELECT c.*, u.full_name AS owner_name ${FROM} ${where} ${orderBy(q)} LIMIT $${params.length + 1}`,
    params.concat([cap + 1]),
  );
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

/* ─── newsletter audience ─────────────────────────────────────────────────── */

async function subscribe(client, { email, name, source }) {
  return (await client.query(
    "INSERT INTO newsletter_subscriber (email, name, source, is_subscribed) VALUES ($1,$2,$3,true) " +
      "ON CONFLICT (email) DO UPDATE SET is_subscribed = true, name = COALESCE(EXCLUDED.name, newsletter_subscriber.name) RETURNING *",
    [email, name || null, source || "website"])).rows[0];
}
async function unsubscribe(client, email) {
  return (await client.query("UPDATE newsletter_subscriber SET is_subscribed = false WHERE email = $1 RETURNING *", [email])).rows[0] || null;
}
async function listSubscribers(client, q = {}) {
  const { limit, offset } = page(q);
  return (await client.query("SELECT * FROM newsletter_subscriber WHERE is_subscribed = true ORDER BY subscribed_at DESC LIMIT $1 OFFSET $2", [limit, offset])).rows;
}
// All active recipients (no pagination) — for a campaign send fan-out.
const listActiveSubscriberEmails = (client) =>
  client.query("SELECT email, name FROM newsletter_subscriber WHERE is_subscribed = true").then((r) => r.rows);

// --- Sending identities (campaign_sender) + email templates (campaign_template), MOD-22 ---
const listSenders = (client) => client.query("SELECT * FROM campaign_sender ORDER BY created_at DESC").then((r) => r.rows);
const getSender = (client, id) => getById(client, "campaign_sender", "sender_id", id);
const insertSender = (client, data) => insertOne(client, "campaign_sender", data);
async function verifySender(client, id) {
  return (await client.query("UPDATE campaign_sender SET verified_at = now() WHERE sender_id = $1 RETURNING *", [id])).rows[0] || null;
}
async function deleteSender(client, id) {
  return (await client.query("DELETE FROM campaign_sender WHERE sender_id = $1 RETURNING *", [id])).rows[0] || null;
}

const listTemplates = (client) => client.query("SELECT * FROM campaign_template ORDER BY updated_at DESC").then((r) => r.rows);
const getTemplate = (client, id) => getById(client, "campaign_template", "template_id", id);
const insertTemplate = (client, data) => insertOne(client, "campaign_template", data);
async function updateTemplate(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  if (!Object.keys(fields).length) return getById(client, "campaign_template", "template_id", id);
  return updateOne(client, "campaign_template", "template_id", id, fields, "*", null, { touch: "updated_at" });
}
async function deleteTemplate(client, id) {
  return (await client.query("DELETE FROM campaign_template WHERE template_id = $1 RETURNING *", [id])).rows[0] || null;
}

module.exports = {
  insert, get, getWithOwner, update, list, listForExport, buildWhere, WRITABLE,
  subscribe, unsubscribe, listSubscribers, listActiveSubscriberEmails,
  listSenders, getSender, insertSender, verifySender, deleteSender,
  listTemplates, getTemplate, insertTemplate, updateTemplate, deleteTemplate,
};
