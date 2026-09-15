/**
 * Opportunity / Sales pipeline (MOD-24). A Kanban of opportunities across
 * pipeline_stage. Moving to a won/lost stage settles the opportunity; `win` can
 * spin up the delivery dossier and link it. All SQL is in the repo.
 *
 * F7 (doc/SALES_CRM_FEATURES.md#F7) added, on top of what was already here:
 *   - a default stage on create, so a deal is never in the pipeline and off the
 *     board at the same time
 *   - probability derived from the stage, with a manual override that survives
 *     stage moves (see opportunity.rules.deriveProbability)
 *   - source / source_ref / scope_summary, the card fields the legacy renders
 *   - the KPI row: pipeline value and BOTH win rates, computed server-side
 *
 * What was NOT ported, deliberately: the legacy accepts any stage by POST with
 * no transition guard and no settled lock (api/sales_pipeline/update.php). This
 * system's guards stay.
 */
"use strict";
const repo = require("./opportunity.repo");
const events = require("./opportunity.events");
const rules = require("./opportunity.rules");
const dossierSvc = require("../../operations/operations_file/operations_file.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { atomically } = require("../../../shared/db/tx");
const ref = (id) => "opportunity:" + id;

async function create(client, { data, actor = {} }) {
  return atomically(client, async () => {
    // A deal with no stage renders in no column. Default to the first open
    // stage rather than leaving it NULL — F6's convert-to-opportunity created
    // exactly that row and it was invisible on the board.
    let stageRow = null;
    if (data.pipeline_stage_id) {
      stageRow = await repo.stage(client, data.pipeline_stage_id);
      if (!stageRow) throw new AppError("BAD_STAGE", "Unknown pipeline stage", 422);
    } else {
      stageRow = await repo.firstOpenStage(client);
    }

    const derived = rules.deriveProbability({
      stage: stageRow,
      current: null,
      isManual: false,
      explicit: data.probability ?? undefined,
    });

    const row = await repo.insert(client, {
      name: data.name,
      lead_id: data.lead_id || null,
      client_id: data.client_id || null,
      pipeline_stage_id: stageRow ? stageRow.pipeline_stage_id : null,
      estimated_value: data.estimated_value ?? null,
      currency: data.currency || "XAF",
      owner_user_id: data.owner_user_id || actor.user_id || null,
      probability: derived ? derived.probability : null,
      probability_is_manual: derived ? derived.probability_is_manual : false,
      source: data.source || "MANUAL",
      source_ref: data.source_ref || null,
      scope_summary: data.scope_summary || null,
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.opportunity_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.opportunity_id), after: row });
    return row;
  });
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  rules.assertOpen(before, "be edited");
  const fields = {};
  for (const k of ["name", "estimated_value", "currency", "owner_user_id", "source", "source_ref", "scope_summary"]) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  // Typing a probability by hand claims it: from here the stage stops
  // overwriting it. Clearing it (explicit null) hands it back to the stage.
  if (patch.probability !== undefined) {
    if (patch.probability === null) {
      const stageRow = before.pipeline_stage_id ? await repo.stage(client, before.pipeline_stage_id) : null;
      const derived = rules.deriveProbability({ stage: stageRow, current: null, isManual: false });
      fields.probability = derived ? derived.probability : null;
      fields.probability_is_manual = false;
    } else {
      fields.probability = patch.probability;
      fields.probability_is_manual = true;
    }
  }
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/** Move to a stage; a won/lost stage auto-settles the opportunity. */
async function moveStage(client, { id, pipelineStageId, actor = {} }) {
  const opp = await repo.get(client, id);
  rules.assertOpen(opp, "move");
  const st = await repo.stage(client, pipelineStageId);
  if (!st) throw new AppError("BAD_STAGE", "Unknown pipeline stage", 422);
  const fields = { pipeline_stage_id: pipelineStageId };
  if (st.is_won) fields.status = "WON";
  if (st.is_lost) fields.status = "LOST";

  // The stage carries a probability; the deal inherits it unless a human has
  // claimed the number. A won/lost stage overrides even a manual value — a
  // closed deal is 100 or 0, not somebody's guess from three weeks ago.
  const derived = rules.deriveProbability({
    stage: st,
    current: opp.probability,
    isManual: opp.probability_is_manual === true && !st.is_won && !st.is_lost,
  });
  if (derived) Object.assign(fields, derived);

  const row = await repo.update(client, id, fields);
  await emitEvent(client, { eventTypeKey: st.is_won ? events.WON : st.is_lost ? events.LOST : events.STAGE_MOVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.STAGE_MOVED, moduleKey: events.MODULE, entityRef: ref(id), before: { stage: opp.pipeline_stage_id, status: opp.status }, after: { stage: st.code, status: row.status } });
  return row;
}

/** Win an opportunity, optionally opening the delivery dossier. */
async function win(client, { id, createDossier = false, entityId = null, serviceTypeId = null, actor = {} }) {
  const opp = await repo.get(client, id);
  rules.assertOpen(opp, "be won");

  let createdDossier = null;
  const result = await atomically(client, async () => {
    let dossierId = opp.dossier_id;
    if (createDossier && !dossierId) {
      if (!entityId) throw new AppError("ENTITY_REQUIRED", "entity_id required to open an operations file", 422);
      createdDossier = await dossierSvc.insertForCreate(client, {
        data: { entity_id: entityId, client_id: opp.client_id, service_type_id: serviceTypeId, title: opp.name },
        actor,
      });
      dossierId = createdDossier.dossier_id;
    }

    const wonStage = (await repo.listStages(client)).find((s) => s.is_won === true) || null;
    const fields = { status: "WON", dossier_id: dossierId, probability: 100, probability_is_manual: false };
    if (wonStage) fields.pipeline_stage_id = wonStage.pipeline_stage_id;
    const row = await repo.update(client, id, fields);
    await emitEvent(client, { eventTypeKey: events.WON, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.WON, moduleKey: events.MODULE, entityRef: ref(id), after: { dossier_id: dossierId } });
    return { opportunity: row, dossier_id: dossierId };
  });

  // Only initialize after the dossier and opportunity link have both committed.
  if (createdDossier) {
    await dossierSvc.initializeCreated(client, { dossier: createdDossier, actor });
  }
  return result;
}

async function lose(client, { id, actor = {} }) {
  const opp = await repo.get(client, id);
  rules.assertOpen(opp, "be lost");
  const lostStage = (await repo.listStages(client)).find((s) => s.is_lost === true) || null;
  const fields = { status: "LOST", probability: 0, probability_is_manual: false };
  if (lostStage) fields.pipeline_stage_id = lostStage.pipeline_stage_id;
  const row = await repo.update(client, id, fields);
  await emitEvent(client, { eventTypeKey: events.LOST, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.LOST, moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}

/**
 * The KPI row. Pipeline value (open deals), weighted forecast, and BOTH win
 * rates — see opportunity.rules.winRate for why both are returned rather than
 * one being chosen for the reader.
 */
async function metrics(client, q = {}) {
  const m = await repo.metrics(client, q);
  const rate = rules.winRate({ won: m.won_count, lost: m.lost_count, open: m.open_count });
  return {
    pipeline_value: m.pipeline_value,
    weighted_value: m.weighted_value,
    won_value: m.won_value,
    open_count: m.open_count,
    won_count: m.won_count,
    lost_count: m.lost_count,
    settled_count: rate.settled_count,
    total_count: m.open_count + m.won_count + m.lost_count,
    // Headline: decided deals only. Secondary: the legacy's denominator.
    win_rate_settled: rate.settled,
    win_rate_all_deals: rate.all_deals,
  };
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
const listForExport = (client, q) => repo.listForExport(client, q);
const stages = (client) => repo.listStages(client);
const board = (client, q) => repo.board(client, q);

module.exports = { create, update, moveStage, win, lose, get, list, listForExport, stages, board, metrics };
