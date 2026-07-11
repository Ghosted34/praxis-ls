/**
 * Opportunity / Sales pipeline (MOD-24). A Kanban of opportunities across
 * pipeline_stage. Moving to a won/lost stage settles the opportunity; `win` can
 * spin up the delivery dossier and link it. All SQL is in the repo.
 */
"use strict";
const repo = require("./opportunity.repo");
const events = require("./opportunity.events");
const dossierSvc = require("../../operations/operations_file/operations_file.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const ref = (id) => "opportunity:" + id;

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, {
      name: data.name, lead_id: data.lead_id || null, client_id: data.client_id || null, pipeline_stage_id: data.pipeline_stage_id || null,
      estimated_value: data.estimated_value || null, currency: data.currency || "XAF", owner_user_id: data.owner_user_id || actor.user_id || null,
      probability: data.probability ?? null, status: "OPEN",
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.opportunity_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.opportunity_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Opportunity not found", 404);
  if (before.status !== "OPEN") throw new AppError("LOCKED", "A settled opportunity cannot be edited", 422);
  const fields = {};
  for (const k of ["name", "estimated_value", "currency", "owner_user_id", "probability"]) if (patch[k] !== undefined) fields[k] = patch[k];
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}
/** Move to a stage; a won/lost stage auto-settles the opportunity. */
async function moveStage(client, { id, pipelineStageId, actor = {} }) {
  const opp = await repo.get(client, id);
  if (!opp) throw new AppError("NOT_FOUND", "Opportunity not found", 404);
  if (opp.status !== "OPEN") throw new AppError("LOCKED", "A settled opportunity cannot move", 422);
  const st = await repo.stage(client, pipelineStageId);
  if (!st) throw new AppError("BAD_STAGE", "Unknown pipeline stage", 422);
  const fields = { pipeline_stage_id: pipelineStageId };
  if (st.is_won) fields.status = "WON";
  if (st.is_lost) fields.status = "LOST";
  const row = await repo.update(client, id, fields);
  await emitEvent(client, { eventTypeKey: st.is_won ? events.WON : st.is_lost ? events.LOST : events.STAGE_MOVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.STAGE_MOVED, moduleKey: events.MODULE, entityRef: ref(id), after: { stage: st.code, status: row.status } });
  return row;
}
/** Win an opportunity, optionally opening the delivery dossier. */
async function win(client, { id, createDossier = false, entityId = null, serviceTypeId = null, actor = {} }) {
  const opp = await repo.get(client, id);
  if (!opp) throw new AppError("NOT_FOUND", "Opportunity not found", 404);
  await client.query("BEGIN");
  try {
    let dossierId = opp.dossier_id;
    if (createDossier && !dossierId) {
      if (!entityId) throw new AppError("ENTITY_REQUIRED", "entity_id required to open a dossier", 422);
      const d = await dossierSvc.create(client, { data: { entity_id: entityId, client_id: opp.client_id, service_type_id: serviceTypeId, title: opp.name }, actor });
      dossierId = d.dossier_id;
    }
    const row = await repo.update(client, id, { status: "WON", dossier_id: dossierId });
    await emitEvent(client, { eventTypeKey: events.WON, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.WON, moduleKey: events.MODULE, entityRef: ref(id), after: { dossier_id: dossierId } });
    await client.query("COMMIT");
    return { opportunity: row, dossier_id: dossierId };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function lose(client, { id, actor = {} }) {
  const opp = await repo.get(client, id);
  if (!opp) throw new AppError("NOT_FOUND", "Opportunity not found", 404);
  const row = await repo.update(client, id, { status: "LOST" });
  await emitEvent(client, { eventTypeKey: events.LOST, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.LOST, moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}
const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
const stages = (client) => repo.listStages(client);
const board = (client) => repo.board(client);
module.exports = { create, update, moveStage, win, lose, get, list, stages, board };
