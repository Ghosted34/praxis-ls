/**
 * Asset repository (MOD-54). Fixed assets + their depreciation schedule rows.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "asset", data);
const findById = (client, id) => getById(client, "asset", "asset_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE asset SET " + set + " WHERE asset_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT * FROM asset ${where} ORDER BY acquired_on DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

const insertScheduleRow = (client, row) => insertOne(client, "depreciation_schedule", row);

async function listSchedule(client, assetId) {
  const { rows } = await client.query(
    "SELECT * FROM depreciation_schedule WHERE asset_id = $1 ORDER BY period_code",
    [assetId],
  );
  return rows;
}

async function scheduleRow(client, assetId, periodCode) {
  const { rows } = await client.query(
    "SELECT * FROM depreciation_schedule WHERE asset_id = $1 AND period_code = $2",
    [assetId, periodCode],
  );
  return rows[0] || null;
}

async function markPosted(client, depreciationId, entryId) {
  const { rows } = await client.query(
    "UPDATE depreciation_schedule SET posted = true, entry_id = $2 WHERE depreciation_id = $1 RETURNING *",
    [depreciationId, entryId],
  );
  return rows[0] || null;
}

/** Accumulated depreciation already posted for an asset. */
async function accumulatedPosted(client, assetId) {
  const { rows } = await client.query(
    "SELECT coalesce(sum(amount),0) AS acc FROM depreciation_schedule WHERE asset_id = $1 AND posted = true",
    [assetId],
  );
  return Number(rows[0].acc || 0);
}

module.exports = { insert, findById, update, list, insertScheduleRow, listSchedule, scheduleRow, markPosted, accumulatedPosted };
