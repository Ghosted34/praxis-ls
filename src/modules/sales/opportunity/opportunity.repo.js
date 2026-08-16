/** Opportunity / pipeline repository (MOD-24). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

/**
 * Columns a caller may set on insert. Listed rather than spread so a stray
 * `status: 'WON'` in a request body cannot settle a deal at creation — the
 * legacy's update.php accepts any status by POST and that is the specific
 * regression F7 refuses to port.
 */
const INSERTABLE = [
  "name", "lead_id", "client_id", "pipeline_stage_id", "estimated_value", "currency",
  "owner_user_id", "probability", "probability_is_manual", "source", "source_ref", "scope_summary",
];

function insert(client, data) {
  const row = {};
  for (const k of INSERTABLE) if (data[k] !== undefined) row[k] = data[k];
  row.status = "OPEN";
  return insertOne(client, "opportunity", row);
}

const get = (client, id) => getById(client, "opportunity", "opportunity_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "opportunity", "opportunity_id", id, fields, "*", null, { touch: "updated_at" });
}

const stage = (client, id) => getById(client, "pipeline_stage", "pipeline_stage_id", id);

async function listStages(client) {
  const { rows } = await client.query("SELECT * FROM pipeline_stage ORDER BY sort_order");
  return rows;
}

/**
 * The first stage a new deal belongs in: lowest sort_order among stages that
 * are neither won nor lost.
 *
 * This exists because F6's convert-to-opportunity created deals with
 * `pipeline_stage_id = NULL`, and a NULL stage belongs to no column — the deal
 * was in the pipeline as far as the database was concerned and invisible on the
 * board. Defaulting here rather than in the caller means every path (UI, AI,
 * conversion) lands in the same place.
 */
async function firstOpenStage(client) {
  const { rows } = await client.query(
    "SELECT * FROM pipeline_stage WHERE is_won = false AND is_lost = false ORDER BY sort_order LIMIT 1",
  );
  return rows[0] || null;
}

/* ── filters shared by list, export and metrics ─────────────────────────────
 * One builder, three consumers. The CSV export must be the rows the user is
 * looking at, and the KPI row must describe the same set — three hand-written
 * WHERE clauses is how those three drift apart.
 */
function buildWhere(q = {}, { includeStatus = true } = {}) {
  const wh = [];
  const params = [];
  if (includeStatus && q.status) { params.push(q.status); wh.push("o.status = $" + params.length); }
  if (q.pipeline_stage_id) { params.push(q.pipeline_stage_id); wh.push("o.pipeline_stage_id = $" + params.length); }
  if (q.owner_user_id) { params.push(q.owner_user_id); wh.push("o.owner_user_id = $" + params.length); }
  if (q.source) { params.push(q.source); wh.push("o.source = $" + params.length); }
  if (q.from) { params.push(q.from); wh.push("o.created_at >= $" + params.length + "::date"); }
  if (q.to) { params.push(q.to); wh.push("o.created_at < ($" + params.length + "::date + interval '1 day')"); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const i = params.length;
    wh.push(`(o.name ILIKE $${i} OR o.source_ref ILIKE $${i} OR o.scope_summary ILIKE $${i})`);
  }
  return { where: wh.length ? "WHERE " + wh.join(" AND ") : "", params };
}

const SELECT_LIST =
  "SELECT o.*, s.name AS stage_name, s.code AS stage_code, s.default_probability AS stage_probability, " +
  "s.is_won AS stage_is_won, s.is_lost AS stage_is_lost, u.full_name AS owner_name " +
  "FROM opportunity o " +
  "LEFT JOIN pipeline_stage s ON s.pipeline_stage_id = o.pipeline_stage_id " +
  "LEFT JOIN app_user u ON u.user_id = o.owner_user_id ";

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const { where, params } = buildWhere(q);
  const { rows } = await client.query(
    SELECT_LIST + where + " ORDER BY o.created_at DESC LIMIT $" + (params.length + 1) + " OFFSET $" + (params.length + 2),
    params.concat([limit, offset]),
  );
  return rows;
}

/**
 * Every row under the current filters, unpaginated, flattened for CSV.
 *
 * Money columns come back as raw numerics with no formatting, no symbol and no
 * thousands separator — the export has to open in Excel with the money typed as
 * a number, and "5 000 000 XAF" does not.
 */
async function listForExport(client, q = {}) {
  const { where, params } = buildWhere(q);
  const { rows } = await client.query(
    "SELECT o.name, o.status, s.code AS stage_code, s.name AS stage_name, " +
      "o.estimated_value, o.currency, o.probability, " +
      "ROUND(COALESCE(o.estimated_value,0) * COALESCE(o.probability,0) / 100.0, 2) AS weighted_value, " +
      "o.source, o.source_ref, o.scope_summary, u.full_name AS owner_name, " +
      "c.name AS client_name, l.company_name AS lead_company, " +
      "o.created_at, o.updated_at, o.settled_at " +
      "FROM opportunity o " +
      "LEFT JOIN pipeline_stage s ON s.pipeline_stage_id = o.pipeline_stage_id " +
      "LEFT JOIN app_user u ON u.user_id = o.owner_user_id " +
      "LEFT JOIN client_master c ON c.client_id = o.client_id " +
      "LEFT JOIN lead l ON l.lead_id = o.lead_id " +
      where + " ORDER BY s.sort_order NULLS LAST, o.created_at DESC",
    params,
  );
  return rows;
}

/** Kanban: opportunities grouped by stage with value and weighted value. */
async function board(client, q = {}) {
  // The board shows the pipeline, so it is scoped by owner/source/date/search
  // like the list — but never by status, because a status filter would empty
  // every column but one and the board would silently stop being a board.
  const { where, params } = buildWhere({ ...q, status: null, pipeline_stage_id: null }, { includeStatus: false });
  const joinWhere = where ? where.replace(/^WHERE /, " AND ") : "";
  const { rows } = await client.query(
    "SELECT s.pipeline_stage_id, s.code AS stage_code, s.name AS stage_name, s.sort_order, " +
      "s.is_won, s.is_lost, s.default_probability, " +
      "COUNT(o.opportunity_id)::int AS count, " +
      "COALESCE(SUM(o.estimated_value),0) AS value, " +
      "COALESCE(SUM(o.estimated_value * COALESCE(o.probability,0)/100.0),0) AS weighted_value " +
      "FROM pipeline_stage s LEFT JOIN opportunity o " +
      "ON o.pipeline_stage_id = s.pipeline_stage_id AND o.status = 'OPEN'" + joinWhere + " " +
      "GROUP BY s.pipeline_stage_id, s.code, s.name, s.sort_order, s.is_won, s.is_lost, s.default_probability " +
      "ORDER BY s.sort_order",
    params,
  );
  return rows.map((r) => ({
    pipeline_stage_id: r.pipeline_stage_id,
    stage_code: r.stage_code,
    stage_name: r.stage_name,
    sort_order: r.sort_order,
    is_won: r.is_won,
    is_lost: r.is_lost,
    default_probability: r.default_probability === null ? null : Number(r.default_probability),
    count: r.count,
    value: Number(r.value),
    weighted_value: Math.round(Number(r.weighted_value) * 100) / 100,
  }));
}

/**
 * The KPI row: pipeline value, weighted forecast, and the counts win rate is
 * computed from. Deliberately ONE query — the legacy fires three (kpis.php) and
 * they are not consistent with each other because each re-states the WHERE.
 *
 * `pipeline_value` is OPEN deals only. The legacy sums every converted row
 * including won and lost ones, which means its "pipeline value" never goes down
 * and a closed year still shows a full pipe. That is a defect, not a
 * definition.
 *
 * The status filter is dropped here for the same reason it is dropped in F6's
 * KPI query: a user filtered to WON must still see how many were lost, or the
 * tiles stop partitioning the set.
 */
async function metrics(client, q = {}) {
  const { where, params } = buildWhere(q, { includeStatus: false });
  const { rows } = await client.query(
    "SELECT " +
      "COUNT(*) FILTER (WHERE o.status = 'OPEN')::int AS open_count, " +
      "COUNT(*) FILTER (WHERE o.status = 'WON')::int  AS won_count, " +
      "COUNT(*) FILTER (WHERE o.status = 'LOST')::int AS lost_count, " +
      "COALESCE(SUM(o.estimated_value) FILTER (WHERE o.status = 'OPEN'), 0) AS pipeline_value, " +
      "COALESCE(SUM(o.estimated_value * COALESCE(o.probability,0)/100.0) FILTER (WHERE o.status = 'OPEN'), 0) AS weighted_value, " +
      "COALESCE(SUM(o.estimated_value) FILTER (WHERE o.status = 'WON'), 0) AS won_value " +
      "FROM opportunity o " + where,
    params,
  );
  const r = rows[0] || {};
  return {
    open_count: r.open_count || 0,
    won_count: r.won_count || 0,
    lost_count: r.lost_count || 0,
    pipeline_value: Number(r.pipeline_value || 0),
    weighted_value: Math.round(Number(r.weighted_value || 0) * 100) / 100,
    won_value: Number(r.won_value || 0),
  };
}

module.exports = { insert, get, update, stage, listStages, firstOpenStage, list, listForExport, board, metrics };
