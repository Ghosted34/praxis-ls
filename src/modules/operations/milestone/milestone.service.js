/**
 * Milestone engine (MOD-31).
 *
 * Versioned templates per service_type; instantiate the active template onto a
 * dossier; advance stages with evidence; and — new in the weighted engine —
 * re-baseline the whole chain every time reality moves, attributing the slip to
 * whoever caused it.
 *
 * WHAT LIVES WHERE, deliberately: all scheduling decisions are made by the pure
 * functions in milestone.schedule.js and milestone.calendar.js. This file's job
 * is to resolve the INPUTS (which calendar, which target date, which policy),
 * persist the OUTPUTS, and emit the events. That split is what lets the rules a
 * client is judged on be tested without a database.
 *
 * THE TARGET-DATE CASCADE, resolved here in `resolveTarget`:
 *   1. the file's own `promised_delivery_date` — the client SLA;
 *   2. `eta` — the carrier's estimate, which is NOT the same promise;
 *   3. the service type's `default_duration_days`, in working days.
 * A dossier with none of the three keeps the offset dates and is scheduled with
 * no horizon, rather than being given an invented one.
 */
"use strict";
const repo = require("./milestone.repo");
const events = require("./milestone.events");
const { computeDue, canAdvance } = require("./milestone.rules");
const cal = require("./milestone.calendar");
const scheduler = require("./milestone.schedule");
const { getSetting } = require("../../../shared/config/settings");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { atomically } = require("../../../shared/db/tx");

const MIN_STAGES = 3;
const MAX_STAGES = 15;

const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/* ── Input resolution ───────────────────────────────────────────────────── */

/**
 * The scheduling policy in force, resolved in three layers.
 *
 *   engine defaults  →  the tenant's setting  →  this service type's override
 *
 * Per-service override matters because the answers genuinely differ by service:
 * a sea import wants the delivery date held and the breach shouted about, while
 * a warehousing retainer would rather auto-release and re-plan. Storing the
 * overrides INSIDE the one setting (`by_service`) rather than as a second
 * settings key keeps "what is my scheduling policy" a single read, and a single
 * thing to edit.
 */
async function resolvePolicy(client, serviceTypeId = null) {
  const raw = await getSetting(client, "operations", "milestone_policy", null);
  const stored = raw && typeof raw === "object" ? raw : {};
  const { by_service: byService, ...tenantWide } = stored;
  const override = serviceTypeId && byService && typeof byService === "object"
    ? byService[serviceTypeId]
    : null;
  return {
    ...scheduler.DEFAULT_POLICY,
    ...tenantWide,
    ...(override && typeof override === "object" ? override : {}),
  };
}

/** The calendar governing this dossier, compiled into a spec. */
async function resolveCalendar(client, entityId) {
  const rows = await repo.workingCalendar(client, entityId || null);
  if (!rows) return cal.DEFAULT_CALENDAR;
  try {
    return cal.buildCalendar(rows);
  } catch {
    // A calendar configured with no open day would otherwise take every
    // schedule down with it. Fall back rather than fail the operation.
    return cal.DEFAULT_CALENDAR;
  }
}

/**
 * The horizon's end. Returns null when the dossier has no target of any kind —
 * the scheduler treats that as "keep the offset dates", which is honest.
 */
function resolveTarget(ctx, calendar, openedAt) {
  if (!ctx) return null;
  if (ctx.promised_delivery_date) return new Date(`${isoDate(ctx.promised_delivery_date)}T17:00:00Z`);
  if (ctx.eta) return new Date(`${isoDate(ctx.eta)}T17:00:00Z`);
  if (!ctx.default_duration_days) return null;
  const n = Number(ctx.default_duration_days);
  if (ctx.duration_basis === "MONTHS") {
    const d = new Date(openedAt);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d;
  }
  if (ctx.duration_basis === "CALENDAR_DAYS") {
    return new Date(new Date(openedAt).getTime() + n * 86400000);
  }
  return cal.addWorkingDays(calendar, openedAt, n);
}

/** Map a stored instance row onto the shape the pure scheduler expects. */
const toStageInput = (row) => ({
  key: row.milestone_instance_id,
  seq: Number(row.stage_seq),
  code: row.code,
  weight: Number(row.weight || 0),
  minDurationHours: Number(row.min_duration_hours || 0),
  ownerTier: row.owner_tier || null,
  isAnchor: !!row.is_anchor,
  isTargetLock: !!row.is_target_lock,
  segment: row.chain_segment || "MAIN",
  cadence: row.cadence || null,
  status: row.status,
  completedAt: row.completed_at || null,
  baselineDue: row.baseline_due ? new Date(`${isoDate(row.baseline_due)}T12:00:00Z`) : null,
  plannedDue: row.planned_due ? new Date(`${isoDate(row.planned_due)}T17:00:00Z`) : null,
  forecastDue: row.forecast_due ? new Date(`${isoDate(row.forecast_due)}T17:00:00Z`) : null,
  manualDueOverride: row.manual_due_override ? new Date(`${isoDate(row.manual_due_override)}T17:00:00Z`) : null,
});

/* ── Templates ──────────────────────────────────────────────────────────── */

/** Publish a NEW active version of a template for a service_type (supersedes older). */
async function publishTemplate(client, { serviceTypeId, stages, actor = {} }) {
  if (!Array.isArray(stages) || stages.length < MIN_STAGES) {
    throw new AppError("TOO_FEW_STAGES", `a template needs at least ${MIN_STAGES} stages`, 422);
  }
  // The DB trigger caps this too (0650), but failing here names the rule to the
  // user instead of surfacing a check_violation from a trigger.
  if (stages.length > MAX_STAGES) {
    throw new AppError("TOO_MANY_STAGES", `a template cannot exceed ${MAX_STAGES} stages`, 422);
  }
  await client.query("BEGIN");
  try {
    const version = await repo.nextVersion(client, serviceTypeId);
    const tpl = await repo.insertTemplate(client, {
      service_type_id: serviceTypeId, version, is_active: true,
      published_by: await resolveActorId(client, actor.user_id), published_at: new Date().toISOString(),
    });
    for (let i = 0; i < stages.length; i += 1) {
      const s = stages[i];
      await repo.insertStage(client, {
        milestone_template_id: tpl.milestone_template_id,
        stage_seq: typeof s.stage_seq === "number" ? s.stage_seq : i + 1,
        code: s.code, label_fr: s.label_fr, label_en: s.label_en || null,
        default_offset_days: s.default_offset_days || 0,
        weight: s.weight || 0,
        min_duration_hours: s.min_duration_hours || 0,
        owner_tier: s.owner_tier || null,
        is_anchor: !!s.is_anchor,
        is_target_lock: !!s.is_target_lock,
        is_client_visible: s.is_client_visible !== false,
        is_clearance_start: !!s.is_clearance_start,
        is_clearance_end: !!s.is_clearance_end,
        is_optional: !!s.is_optional,
        chain_segment: s.chain_segment || "MAIN",
        cadence: s.cadence || null,
        required_evidence_doc_type: s.required_evidence_doc_type || null,
        auto_advance_on_event: s.auto_advance_on_event || null,
      });
    }
    await repo.deactivateOthers(client, serviceTypeId, tpl.milestone_template_id);
    await emitEvent(client, { eventTypeKey: events.TEMPLATE_PUBLISHED, moduleKey: events.MODULE, entityRef: "milestone_template:" + tpl.milestone_template_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.TEMPLATE_PUBLISHED, moduleKey: events.MODULE, entityRef: "milestone_template:" + tpl.milestone_template_id, after: tpl });
    await client.query("COMMIT");
    return getTemplate(client, tpl.milestone_template_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Re-activate a superseded version (10708b) — the rollback the register could
 * never express.
 *
 * Publishing a new version deactivates the old one; until now the only way
 * back was to publish ANOTHER new version, which bumps the version counter
 * and leaves a "v4" that is byte-identical to v2 — a lie in the ledger. This
 * instead re-activates the existing version and deactivates whatever is
 * currently active, so the register stays an honest history.
 *
 * Already active is idempotent (the button can be pressed twice), and
 * existing dossiers are untouched either way: a dossier keeps the chain it
 * was stamped with, so a rollback only changes what FUTURE dossiers open
 * with.
 */
async function activateTemplate(client, { id, actor = {} }) {
  const before = await repo.getTemplate(client, id);
  if (!before) return null;
  if (before.is_active) return getTemplate(client, id);

  await client.query("BEGIN");
  try {
    await repo.updateTemplate(client, id, { is_active: true });
    await repo.deactivateOthers(client, before.service_type_id, id);
    const row = await repo.getTemplate(client, id);
    await emitEvent(client, {
      eventTypeKey: events.TEMPLATE_ACTIVATED, moduleKey: events.MODULE,
      entityRef: "milestone_template:" + id, actorUserId: actor.user_id || null,
      payload: { service_type_id: before.service_type_id, version: before.version },
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.TEMPLATE_ACTIVATED,
      moduleKey: events.MODULE, entityRef: "milestone_template:" + id,
      before: { is_active: before.is_active }, after: { is_active: true },
    });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/* ── Instantiation ──────────────────────────────────────────────────────── */

/**
 * Stamp the active template onto a dossier, with all three dates computed.
 *
 * Stage config is SNAPSHOTTED onto each instance rather than read through to the
 * template. A template is versioned and editable; a chain in flight must not
 * silently change weight or ownership underneath the file it is scheduling.
 */
async function instantiate(client, { dossierId, serviceTypeId, baseDate, actor = {} }) {
  if ((await repo.existingInstances(client, dossierId)) > 0) throw new AppError("ALREADY_INSTANTIATED", "this operations file already has milestones", 409);
  const tpl = await repo.activeTemplate(client, serviceTypeId);
  if (!tpl) throw new AppError("NO_TEMPLATE", "no active milestone template for this service type", 422);
  const stageRows = await repo.stages(client, tpl.milestone_template_id);

  const ctx = await repo.scheduleContext(client, dossierId);
  const calendar = await resolveCalendar(client, ctx && ctx.entity_id);
  const policy = await resolvePolicy(client, serviceTypeId);
  const base = baseDate || isoDate((ctx && ctx.created_at) || new Date());
  const openedAt = new Date(`${base}T08:00:00Z`);
  const target = resolveTarget(ctx, calendar, openedAt);

  const planned = scheduler.computeSchedule({
    stages: stageRows.map((s) => ({
      key: s.stage_id,
      seq: Number(s.stage_seq),
      code: s.code,
      weight: Number(s.weight || 0),
      minDurationHours: Number(s.min_duration_hours || 0),
      ownerTier: s.owner_tier || null,
      isAnchor: !!s.is_anchor,
      isTargetLock: !!s.is_target_lock,
      segment: s.chain_segment || "MAIN",
      cadence: s.cadence || null,
      status: "PENDING",
    })),
    now: new Date(),
    openedAt,
    targetDate: target,
    calendar,
    policy,
  });
  const decisions = new Map(planned.stages.map((d) => [d.key, d]));

  await client.query("BEGIN");
  try {
    const out = [];
    for (const s of stageRows) {
      const d = decisions.get(s.stage_id) || {};
      // No horizon → the offset fallback, which is exactly what it is for.
      const fallback = computeDue(base, s.default_offset_days);
      const plannedDue = isoDate(d.plannedDue) || fallback;
      const inst = await repo.insertInstance(client, {
        dossier_id: dossierId, stage_seq: s.stage_seq, code: s.code,
        label: s.label_fr, label_en: s.label_en || null,
        // `due_date` stays populated and equal to the commitment: the Control
        // Tower, the 360° tab and the portal have always read it, and this
        // engine must not break them to introduce its own columns.
        due_date: plannedDue,
        baseline_due: isoDate(d.baselineDue) || plannedDue,
        planned_due: plannedDue,
        forecast_due: isoDate(d.forecastDue) || plannedDue,
        status: "PENDING",
        health: d.health || "OK",
        weight: s.weight || 0,
        min_duration_hours: s.min_duration_hours || 0,
        owner_tier: s.owner_tier || null,
        responsible_role_id: s.responsible_role_id || null,
        is_anchor: !!s.is_anchor,
        is_target_lock: !!s.is_target_lock,
        is_client_visible: s.is_client_visible !== false,
        is_optional: !!s.is_optional,
        chain_segment: s.chain_segment || "MAIN",
        cadence: s.cadence || null,
        required_evidence_doc_type: s.required_evidence_doc_type || null,
        auto_advance_on_event: s.auto_advance_on_event || null,
      });
      out.push(inst);
    }
    await emitEvent(client, { eventTypeKey: events.INSTANTIATED, moduleKey: events.MODULE, entityRef: "dossier:" + dossierId, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.INSTANTIATED, moduleKey: events.MODULE, entityRef: "dossier:" + dossierId, after: { count: out.length, provisional: planned.meta.provisional } });
    await client.query("COMMIT");
    return out;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/* ── Re-baselining ──────────────────────────────────────────────────────── */

/**
 * Recompute a dossier's chain and persist what moved.
 *
 * Writes only what CHANGED, and logs each movement to milestone_rebaseline_log
 * — that log is what turns "the carrier costs us four days a file" from an
 * assertion into a query, and it is the audit trail behind every date a client
 * was shown.
 */
async function recalculate(client, { dossierId, trigger = "SCAN", actor = {} }) {
  const rows = await repo.listByDossier(client, dossierId);
  if (!rows.length) return { changed: 0, meta: null };

  const ctx = await repo.scheduleContext(client, dossierId);
  const calendar = await resolveCalendar(client, ctx && ctx.entity_id);
  const policy = await resolvePolicy(client, ctx && ctx.service_type_id);
  const openedAt = new Date((ctx && ctx.created_at) || Date.now());
  const target = resolveTarget(ctx, calendar, openedAt);

  const result = scheduler.computeSchedule({
    stages: rows.map(toStageInput),
    now: new Date(),
    openedAt,
    targetDate: target,
    calendar,
    policy,
  });

  const byId = new Map(rows.map((r) => [r.milestone_instance_id, r]));
  let changed = 0;

  for (const d of result.stages) {
    const row = byId.get(d.key);
    if (!row || row.status === "DONE") continue;   // guardrail 1: frozen.

    const nextPlanned = isoDate(d.plannedDue);
    const nextForecast = isoDate(d.forecastDue);
    const nextBaseline = isoDate(d.baselineDue);
    const movedPlanned = nextPlanned && nextPlanned !== isoDate(row.planned_due);
    const movedForecast = nextForecast && nextForecast !== isoDate(row.forecast_due);
    const healthChanged = d.health && d.health !== row.health;
    if (!movedPlanned && !movedForecast && !healthChanged) continue;

    await repo.updateInstance(client, row.milestone_instance_id, {
      planned_due: nextPlanned,
      forecast_due: nextForecast,
      // Written once, then never again — see guardrail 1.
      baseline_due: row.baseline_due ? isoDate(row.baseline_due) : nextBaseline,
      due_date: nextPlanned,
      health: d.health,
      last_rebaselined_at: new Date().toISOString(),
    });
    changed += 1;

    if (movedPlanned || movedForecast) {
      await repo.logRebaseline(client, {
        dossier_id: dossierId,
        milestone_instance_id: row.milestone_instance_id,
        trigger_event: trigger,
        old_planned_due: isoDate(row.planned_due),
        new_planned_due: nextPlanned,
        old_forecast_due: isoDate(row.forecast_due),
        new_forecast_due: nextForecast,
        outcome: d.outcome || null,
        actor_user_id: await resolveActorId(client, actor.user_id),
      });
    }
  }

  if (changed) {
    await emitEvent(client, {
      eventTypeKey: events.REBASELINED, moduleKey: events.MODULE,
      entityRef: "dossier:" + dossierId, actorUserId: actor.user_id || null,
      payload: { changed, breached: result.meta.breached, compressed: result.meta.compressed, trigger },
    });
  }
  if (result.meta.breached) {
    await emitEvent(client, {
      eventTypeKey: events.SLA_BREACH_FORECAST, moduleKey: events.MODULE,
      entityRef: "dossier:" + dossierId, actorUserId: actor.user_id || null,
      payload: { horizon_hours: result.meta.horizonHours, floor_hours: result.meta.floorHours, requires_replan: !!result.meta.requiresReplan },
    });
  }
  if (result.meta.lockReleased) {
    await emitEvent(client, {
      eventTypeKey: events.LOCK_RELEASED, moduleKey: events.MODULE,
      entityRef: "dossier:" + dossierId, actorUserId: actor.user_id || null,
    });
  }
  return { changed, meta: result.meta };
}

/* ── Advancing ──────────────────────────────────────────────────────────── */

async function advance(client, { instanceId, to, evidenceVaultId = null, causeReasonCode = null, causeNote = null, actor = {} }) {
  const inst = await repo.getInstance(client, instanceId);
  if (!inst) throw new AppError("NOT_FOUND", "Milestone not found", 404);
  if (!canAdvance(inst.status, to)) throw new AppError("BAD_TRANSITION", "Cannot move milestone from " + inst.status + " to " + to, 422);

  const fields = { status: to };
  if (to === "IN_PROGRESS" && !inst.actual_start) fields.actual_start = new Date().toISOString();
  if (to === "DONE") {
    const completedAt = new Date();
    fields.completed_at = completedAt.toISOString();
    // completed_by is REFERENCES app_user(user_id) in the schema being written
    // to. Under TEST that's the sandbox schema while the user lives in LIVE, so
    // a raw id raises 23503 and the milestone can never be completed — Start
    // worked (no actor column) and Complete didn't. Record the completion even
    // when the actor can't be validated here.
    fields.completed_by = await resolveActorId(client, actor.user_id);
    fields.health = "DONE";
    // A completed stage's forecast IS its actual — leaving the last prediction
    // frozen in place would leave the row disagreeing with itself forever.
    // `planned_due` is untouched: that is the promise, and whether it was kept
    // is precisely what `variance_hours` below records.
    fields.forecast_due = isoDate(completedAt);

    // GUARDRAIL 4 — attribute the slip to the tier that owns THIS stage.
    const ctx = await repo.scheduleContext(client, inst.dossier_id);
    const calendar = await resolveCalendar(client, ctx && ctx.entity_id);
    const variance = scheduler.attributeVariance({
      stage: toStageInput(inst), completedAt, calendar, causeReasonCode,
    });
    fields.variance_hours = variance.varianceHours;
    fields.attributed_to = variance.attributedTo;
    fields.cause_reason_code = variance.causeReasonCode;
    if (causeNote) fields.cause_note = causeNote;
  }
  if (evidenceVaultId) fields.evidence_vault_id = evidenceVaultId;

  const row = await repo.updateInstance(client, instanceId, fields);

  // Reality moved, so the rest of the chain is re-forecast from the ACTUAL
  // completion rather than left pointing at dates that are now fiction.
  if (to === "DONE") {
    await recalculate(client, { dossierId: inst.dossier_id, trigger: "ADVANCE", actor });
  }

  // Emit on the DOSSIER ref so orchestration can react (e.g. all-milestones-done
  // → dossier.milestones_completed). Previously advance only audited.
  await emitEvent(client, { eventTypeKey: events.ADVANCED, moduleKey: events.MODULE, entityRef: "dossier:" + inst.dossier_id, actorUserId: actor.user_id || null, payload: { milestone_instance_id: instanceId, code: inst.code, to, variance_hours: row.variance_hours, attributed_to: row.attributed_to } });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ADVANCED, moduleKey: events.MODULE, entityRef: "milestone_instance:" + instanceId, before: inst, after: row });
  return row;
}

/**
 * Un-complete a stage that was marked DONE in error.
 *
 * Frozen-DONE is what makes variance measurable, so this is the ONLY way back —
 * governed, reasoned and audited, rather than an ordinary transition. Without
 * it a fat-fingered Complete would poison a chain's anchor permanently.
 */
async function reopen(client, { instanceId, reason, actor = {} }) {
  const inst = await repo.getInstance(client, instanceId);
  if (!inst) throw new AppError("NOT_FOUND", "Milestone not found", 404);
  if (inst.status !== "DONE") throw new AppError("NOT_DONE", "Only a completed milestone can be reopened", 422);
  if (!reason || !String(reason).trim()) throw new AppError("REASON_REQUIRED", "A reason is required to reopen a milestone", 422);

  const row = await repo.updateInstance(client, instanceId, {
    status: "IN_PROGRESS",
    completed_at: null,
    completed_by: null,
    health: "OK",
    variance_hours: null,
    attributed_to: null,
    reopened_at: new Date().toISOString(),
    reopened_by: await resolveActorId(client, actor.user_id),
    reopen_reason: String(reason).trim(),
  });
  await recalculate(client, { dossierId: inst.dossier_id, trigger: "REOPEN", actor });
  await emitEvent(client, { eventTypeKey: events.REOPENED, moduleKey: events.MODULE, entityRef: "dossier:" + inst.dossier_id, actorUserId: actor.user_id || null, payload: { milestone_instance_id: instanceId, code: inst.code } });
  await audit(client, { actorUserId: actor.user_id || null, action: events.REOPENED, moduleKey: events.MODULE, entityRef: "milestone_instance:" + instanceId, before: inst, after: row });
  return row;
}

/**
 * Insert an ad-hoc milestone into a live chain, between two existing stages.
 *
 * The kickoff asked for this by name: a problem arises before the next
 * milestone, so a stage is inserted and the schedule downstream recalculates
 * itself. `stage_seq` is numeric(10,4) precisely so this needs no renumber.
 */
async function addStage(client, { dossierId, afterSeq, code, label, labelEn = null, weight = 0, minDurationHours = 0, ownerTier = null, isClientVisible = true, actor = {} }) {
  const count = await repo.existingInstances(client, dossierId);
  if (count >= MAX_STAGES) throw new AppError("TOO_MANY_STAGES", `a chain cannot exceed ${MAX_STAGES} stages`, 422);
  const seq = await repo.seqBetween(client, dossierId, Number(afterSeq || 0));
  const row = await repo.insertInstance(client, {
    dossier_id: dossierId, stage_seq: seq, code, label, label_en: labelEn,
    status: "PENDING", is_ad_hoc: true, weight, min_duration_hours: minDurationHours,
    owner_tier: ownerTier, is_client_visible: isClientVisible, chain_segment: "MAIN",
  });
  await recalculate(client, { dossierId, trigger: "INSERT", actor });
  await audit(client, { actorUserId: actor.user_id || null, action: events.STAGE_INSERTED, moduleKey: events.MODULE, entityRef: "dossier:" + dossierId, after: row });
  return repo.getInstance(client, row.milestone_instance_id);
}

const getTemplate = (client, id) => repo.getTemplate(client, id);
const listTemplates = (client, q) => repo.listTemplates(client, q);
const listByDossier = (client, dossierId) => repo.listByDossier(client, dossierId);
const listAssumptions = (client, serviceTypeId) => repo.assumptions(client, serviceTypeId);

/** Delay attribution: by owner tier, and the stages behind each tier's number. */
async function attribution(client, q = {}) {
  const [byTier, byStage] = await Promise.all([
    repo.attributionSummary(client, q),
    repo.attributionByStage(client, q),
  ]);
  return { by_tier: byTier, by_stage: byStage };
}
/**
 * Replace the published assumptions for a service type.
 *
 * These are shown to the CLIENT beside the chain, so they are audited: what we
 * told a client the schedule depends on is part of the record of what we
 * promised them.
 */
async function saveAssumptions(client, { serviceTypeId, assumptions = [], actor = {} }) {
  await client.query("BEGIN");
  try {
    const rows = await repo.replaceAssumptions(client, serviceTypeId, assumptions);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "service_type.assumptions_saved",
      moduleKey: events.MODULE,
      entityRef: "service_type:" + serviceTypeId,
      after: { count: rows.length },
    });
    await client.query("COMMIT");
    return rows;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Save only the bounded, client-safe tracking copy used by F14.
 * Operational cause notes, health and attribution are deliberately not accepted
 * here, so updating the public timeline cannot accidentally publish them.
 */
async function updatePublicDetails(client, { instanceId, details, actor = {} }) {
  const clean = (value) => {
    if (value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  };
  const fields = {};
  for (const key of ["public_location", "public_stage_reference", "public_progress_note"]) {
    if (Object.prototype.hasOwnProperty.call(details, key)) fields[key] = clean(details[key]);
  }
  return atomically(client, async () => {
    const before = await repo.getInstance(client, instanceId);
    if (!before) throw new AppError("NOT_FOUND", "Milestone not found", 404);
    const row = await repo.updateInstance(client, instanceId, fields);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "milestone.public_details_updated",
      moduleKey: events.MODULE,
      entityRef: "milestone:" + instanceId,
      before: {
        public_location: before.public_location || null,
        public_stage_reference: before.public_stage_reference || null,
        public_progress_note: before.public_progress_note || null,
      },
      after: {
        public_location: row.public_location || null,
        public_stage_reference: row.public_stage_reference || null,
        public_progress_note: row.public_progress_note || null,
      },
    });
    return row;
  });
}

/** The shipped default chain for a service type — drift comparison + restore. */
const listSystemDefault = (client, serviceTypeId) => repo.systemDefaultStages(client, serviceTypeId);

module.exports = {
  publishTemplate, activateTemplate, instantiate, advance, reopen, addStage, recalculate, updatePublicDetails,
  getTemplate, listTemplates, listByDossier, listAssumptions, listSystemDefault, saveAssumptions, attribution,
  resolveTarget, resolveCalendar, resolvePolicy,
  MIN_STAGES, MAX_STAGES,
};
