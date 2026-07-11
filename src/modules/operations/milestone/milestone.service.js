/**
 * Milestone engine (MOD-31). Versioned templates per service_type; instantiate the
 * active template's stages onto a dossier (due dates from offsets); advance stages
 * with evidence. SQL in the repo. (Client-portal push is Phase 4.)
 */
"use strict";
const repo = require("./milestone.repo");
const events = require("./milestone.events");
const { computeDue, canAdvance } = require("./milestone.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

/** Publish a NEW active version of a template for a service_type (supersedes older). */
async function publishTemplate(client, { serviceTypeId, stages, actor = {} }) {
  if (!Array.isArray(stages) || stages.length === 0) throw new AppError("NO_STAGES", "template needs stages", 422);
  await client.query("BEGIN");
  try {
    const version = await repo.nextVersion(client, serviceTypeId);
    const tpl = await repo.insertTemplate(client, { service_type_id: serviceTypeId, version, is_active: true });
    for (let i = 0; i < stages.length; i += 1) {
      const s = stages[i];
      // eslint-disable-next-line no-await-in-loop
      await repo.insertStage(client, { milestone_template_id: tpl.milestone_template_id, stage_seq: typeof s.stage_seq === "number" ? s.stage_seq : i + 1, code: s.code, label_fr: s.label_fr, label_en: s.label_en || null, default_offset_days: s.default_offset_days || 0 });
    }
    await repo.deactivateOthers(client, serviceTypeId, tpl.milestone_template_id);
    await emitEvent(client, { eventTypeKey: events.TEMPLATE_PUBLISHED, moduleKey: events.MODULE, entityRef: "milestone_template:" + tpl.milestone_template_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.TEMPLATE_PUBLISHED, moduleKey: events.MODULE, entityRef: "milestone_template:" + tpl.milestone_template_id, after: tpl });
    await client.query("COMMIT");
    return getTemplate(client, tpl.milestone_template_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Instantiate the active template's stages onto a dossier. Idempotent (no dup). */
async function instantiate(client, { dossierId, serviceTypeId, baseDate, actor = {} }) {
  if ((await repo.existingInstances(client, dossierId)) > 0) throw new AppError("ALREADY_INSTANTIATED", "dossier already has milestones", 409);
  const tpl = await repo.activeTemplate(client, serviceTypeId);
  if (!tpl) throw new AppError("NO_TEMPLATE", "no active milestone template for this service type", 422);
  const stageRows = await repo.stages(client, tpl.milestone_template_id);
  const base = baseDate || new Date().toISOString().slice(0, 10);
  await client.query("BEGIN");
  try {
    const out = [];
    for (const s of stageRows) {
      // eslint-disable-next-line no-await-in-loop
      const inst = await repo.insertInstance(client, {
        dossier_id: dossierId, stage_seq: s.stage_seq, code: s.code, label: s.label_fr,
        due_date: computeDue(base, s.default_offset_days), status: "PENDING",
      });
      out.push(inst);
    }
    await emitEvent(client, { eventTypeKey: events.INSTANTIATED, moduleKey: events.MODULE, entityRef: "dossier:" + dossierId, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.INSTANTIATED, moduleKey: events.MODULE, entityRef: "dossier:" + dossierId, after: { count: out.length } });
    await client.query("COMMIT");
    return out;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function advance(client, { instanceId, to, evidenceVaultId = null, actor = {} }) {
  const inst = await repo.getInstance(client, instanceId);
  if (!inst) throw new AppError("NOT_FOUND", "Milestone not found", 404);
  if (!canAdvance(inst.status, to)) throw new AppError("BAD_TRANSITION", "Cannot move milestone from " + inst.status + " to " + to, 422);
  const fields = { status: to };
  if (to === "DONE") { fields.completed_at = new Date().toISOString(); fields.completed_by = actor.user_id || null; }
  if (evidenceVaultId) fields.evidence_vault_id = evidenceVaultId;
  const row = await repo.updateInstance(client, instanceId, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.ADVANCED, moduleKey: events.MODULE, entityRef: "milestone_instance:" + instanceId, before: inst, after: row });
  return row;
}

const getTemplate = (client, id) => repo.getTemplate(client, id);
const listTemplates = (client, q) => repo.listTemplates(client, q);
const listByDossier = (client, dossierId) => repo.listByDossier(client, dossierId);

module.exports = { publishTemplate, instantiate, advance, getTemplate, listTemplates, listByDossier };
