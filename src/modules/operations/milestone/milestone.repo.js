/** Milestone repository (MOD-31). template/stage/instance SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

function insertTemplate(client, data) { return insertOne(client, "milestone_template", data); }
function insertStage(client, data) { return insertOne(client, "milestone_template_stage", data); }

async function nextVersion(client, serviceTypeId) {
  const { rows } = await client.query("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM milestone_template WHERE service_type_id = $1", [serviceTypeId]);
  return rows[0].v;
}
async function activeTemplate(client, serviceTypeId) {
  const { rows } = await client.query(
    "SELECT * FROM milestone_template WHERE service_type_id = $1 AND is_active = true ORDER BY version DESC LIMIT 1",
    [serviceTypeId],
  );
  return rows[0] || null;
}
async function stages(client, templateId) {
  const { rows } = await client.query("SELECT * FROM milestone_template_stage WHERE milestone_template_id = $1 ORDER BY stage_seq", [templateId]);
  return rows;
}
async function deactivateOthers(client, serviceTypeId, keepId) {
  await client.query("UPDATE milestone_template SET is_active = false WHERE service_type_id = $1 AND milestone_template_id <> $2", [serviceTypeId, keepId]);
}
const getTemplate = (client, id) => getById(client, "milestone_template", "milestone_template_id", id);

function insertInstance(client, data) { return insertOne(client, "milestone_instance", data); }
const getInstance = (client, id) => getById(client, "milestone_instance", "milestone_instance_id", id);
async function updateInstance(client, id, fields) {
  const keys = Object.keys(fields);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE milestone_instance SET " + set + " WHERE milestone_instance_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function listByDossier(client, dossierId) {
  const { rows } = await client.query("SELECT * FROM milestone_instance WHERE dossier_id = $1 ORDER BY stage_seq", [dossierId]);
  return rows;
}
async function existingInstances(client, dossierId) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM milestone_instance WHERE dossier_id = $1", [dossierId]);
  return rows[0].n;
}
async function listTemplates(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.service_type_id) { params.push(q.service_type_id); wh.push("service_type_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM milestone_template " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}

module.exports = { insertTemplate, insertStage, nextVersion, activeTemplate, stages, deactivateOthers, getTemplate, insertInstance, getInstance, updateInstance, listByDossier, existingInstances, listTemplates };
