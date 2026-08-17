/**
 * Training sessions (MOD-18 / 0702) — scheduling, the live session, and the
 * compliance question a requirement exists to answer.
 *
 * ── THREE THINGS TO KNOW BEFORE CHANGING THIS FILE ─────────────────────────
 *
 * 1. `scheduled_on` IS DERIVED. It is the legacy date column from 0360 and four
 *    readers still select it. Nothing here reads it; `syncLegacyDate` writes it
 *    from `starts_at` on every path that sets one, so the two cannot drift while
 *    it is being retired.
 *
 * 2. ENDING A SESSION DOES NOT MARK ANYBODY ABSENT. `endSession` derives
 *    attendance from presence — from an actual join — and leaves every row it
 *    has no evidence for exactly as it found it. A facilitator who forgets to
 *    open the session must not thereby record twenty absences, and those rows
 *    feed 0701's appraisal scoring. `presenceAttendance` returns null for "no
 *    evidence"; this file treats null as "leave it alone", never as false.
 *
 * 3. A CERTIFICATE EXPIRY IS SUGGESTED, NOT IMPOSED. When a session satisfies a
 *    requirement with `valid_months`, issuing a certificate fills the expiry
 *    from it — and the column stays editable, because a ticket awarded by an
 *    external assessor carries whatever date that body put on it.
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./training.repo");
const events = require("./training.events");
const rules = require("./training.rules");
const minutes = require("./training.minutes");
const vault = require("../../vault/document_vault/document_vault.service");
const { logger } = require("../../../config/logger");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "training", events });
const ref = (id) => "training:" + id;

/** The legacy 0360 date column, kept in step with `starts_at`. See header (1). */
function syncLegacyDate(fields) {
  if (fields.starts_at === undefined) return fields;
  const d = fields.starts_at ? new Date(fields.starts_at) : null;
  return { ...fields, scheduled_on: d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null };
}

/** The scheduling fields a caller may set, validated as a set rather than one
 *  at a time — reachability depends on the mode, so they have to be checked
 *  together or an online session loses its link by being switched to in-person
 *  and back. */
function scheduleFields(patch, before = {}) {
  const merged = {
    mode: patch.mode !== undefined ? patch.mode : (before.mode || "IN_PERSON"),
    join_url: patch.join_url !== undefined ? patch.join_url : before.join_url,
    location: patch.location !== undefined ? patch.location : before.location,
  };
  return rules.assertReachable(merged);
}

async function create(client, { data = {}, actor = {} }) {
  const reachable = scheduleFields(data);
  const fields = syncLegacyDate({
    title: data.title,
    description: data.description || null,
    starts_at: data.starts_at || null,
    ends_at: data.ends_at || null,
    facilitator: data.facilitator || null,
    facilitator_employee_id: data.facilitator_employee_id || null,
    training_requirement_id: data.training_requirement_id || null,
    capacity: data.capacity ?? null,
    status: data.status || "SCHEDULED",
    ...reachable,
  });
  const row = await repo.create(client, fields);
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.training_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.training_id), after: row });
  return row;
}

/**
 * Patch a session. Overrides the generic update for two reasons: the legacy
 * date has to stay in step, and the status field is NOT patchable here — a
 * lifecycle move goes through `setStatus`, which is where the LIVE bookkeeping
 * lives. Letting PATCH set it would be a second, quieter route to the same
 * change that skips opening and closing the session.
 */
async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.findById(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Training not found", 404);
  const fields = {};
  for (const k of ["title", "description", "starts_at", "ends_at", "facilitator",
    "facilitator_employee_id", "training_requirement_id", "capacity"]) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  if (patch.mode !== undefined || patch.join_url !== undefined || patch.location !== undefined) {
    Object.assign(fields, scheduleFields(patch, before));
  }
  if (patch.status !== undefined && patch.status !== before.status) {
    return setStatus(client, { id, status: patch.status, actor });
  }
  const row = await repo.update(client, id, syncLegacyDate(fields));
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/* ── The live session ───────────────────────────────────────────────────── */

/**
 * Move the lifecycle, and do the bookkeeping each move implies.
 *
 * SCHEDULED → LIVE stamps `opened_at`, which is what attendee presence is
 * measured against — not the published start, because a session that opened
 * forty minutes late would otherwise mark its whole roster as late.
 *
 * → DONE stamps `closed_at`, derives attendance from presence, and drafts the
 * minutes. The draft is best-effort: a session's record must not depend on a
 * model answering, so a failure there is logged and the close still succeeds.
 */
async function setStatus(client, { id, status, actor = {} }) {
  const before = await repo.findById(client, id);
  if (!before) return null;
  rules.assertTransition(before.status, status);

  const fields = { status };
  if (status === "LIVE" && !before.opened_at) fields.opened_at = new Date().toISOString();
  if (status === "DONE" && !before.closed_at) fields.closed_at = new Date().toISOString();

  const row = await repo.update(client, id, fields);
  if (status === "DONE") {
    await settleAttendance(client, { training: row, actor });
    await draftMinutes(client, { training: row, actor }).catch((err) =>
      logger.warn({ err, training_id: id }, "[training] minutes draft failed on close"));
  }
  await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return repo.get(client, id);
}

/**
 * Somebody joined. Idempotent on purpose: a flaky connection produces four of
 * these, and the FIRST join is the one that counts — overwriting it with the
 * latest would shorten everybody's recorded presence to the last reconnection.
 */
async function join(client, { trainingId, employeeId, actor = {} }) {
  const training = await repo.findById(client, trainingId);
  if (!training) throw new AppError("NOT_FOUND", "Training not found", 404);
  const state = rules.joinState(training, new Date());
  if (!state.can_join) {
    throw new AppError("TRAINING_NOT_JOINABLE", state.message, 422, { reason: state.reason });
  }
  let row = await repo.findAttendee(client, trainingId, employeeId);
  if (!row) {
    // Walking up to a session you were not booked on is normal, and refusing it
    // would mean the roster records fewer people than were in the room.
    // Capacity is checked here rather than at booking for the same reason.
    const booked = (await repo.presenceRows(client, trainingId)).length;
    const cap = rules.capacityState({ capacity: training.capacity, booked });
    if (cap.is_full) throw new AppError("TRAINING_FULL", `This session is full (${cap.capacity} places).`, 422);
    row = await repo.insertAttendee(client, { training_id: trainingId, employee_id: employeeId, joined_at: new Date().toISOString() });
  } else if (!row.joined_at) {
    row = await repo.updateAttendee(client, row.training_attendance_id, { joined_at: new Date().toISOString(), left_at: null });
  }
  await audit(client, { actorUserId: actor.user_id || null, action: events.ATTENDEE_JOINED, moduleKey: events.MODULE, entityRef: ref(trainingId), after: row });
  return row;
}

/** Somebody left. The LAST leave wins, which is the mirror of the first join
 *  winning: between them they bracket the longest span the person was present
 *  for, which is the honest reading of a connection that dropped twice. */
async function leave(client, { trainingId, employeeId, actor = {} }) {
  const row = await repo.findAttendee(client, trainingId, employeeId);
  if (!row) throw new AppError("NOT_FOUND", "Not on this session's roster", 404);
  const updated = await repo.updateAttendee(client, row.training_attendance_id, { left_at: new Date().toISOString() });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ATTENDEE_LEFT, moduleKey: events.MODULE, entityRef: ref(trainingId), after: updated });
  return updated;
}

/**
 * Turn presence into attendance, once, at close.
 *
 * Rows with no join evidence are LEFT ALONE — see header (2). This is the
 * single most important line in the file: `presenceAttendance` returns null for
 * them, and null must never become `attended = false`.
 */
async function settleAttendance(client, { training, actor = {} }) {
  const rows = await repo.presenceRows(client, training.training_id);
  const settled = [];
  for (const a of rows) {
    const verdict = rules.presenceAttendance({
      joined_at: a.joined_at, left_at: a.left_at,
      opened_at: training.opened_at, closed_at: training.closed_at,
    });
    if (!verdict) continue;                       // No evidence. Not absence.
    if (a.attendance_observed && a.attended === verdict.attended) continue;
    // A human who already ticked the box outranks the derivation — they were in
    // the room and the system was not.
    if (a.marked_by && !a.attendance_observed) continue;
    settled.push(await repo.updateAttendee(client, a.training_attendance_id, {
      attended: verdict.attended,
      attendance_observed: true,
      marked_at: new Date().toISOString(),
    }));
  }
  if (settled.length) {
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.ATTENDANCE_SETTLED, moduleKey: events.MODULE,
      entityRef: ref(training.training_id), after: { settled: settled.length, of: rows.length },
    });
  }
  return settled;
}

/* ── Notes and minutes ──────────────────────────────────────────────────── */

async function addNote(client, { trainingId, body, isMinutes = false, actor = {} }) {
  const t = await repo.findById(client, trainingId);
  if (!t) throw new AppError("NOT_FOUND", "Training not found", 404);
  const note = await repo.insertNote(client, {
    training_id: trainingId,
    author_id: await resolveActorId(client, actor.user_id),
    body,
    is_minutes: isMinutes === true,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: events.NOTE_ADDED, moduleKey: events.MODULE, entityRef: ref(trainingId), after: { note_id: note.training_note_id } });
  return note;
}

/**
 * Draft the minutes and file them.
 *
 * Filing happens EITHER WAY. If the model could not be reached, or there was
 * too little to summarise, the captured notes themselves are filed verbatim —
 * a session's record must not depend on a model answering, and the notes are
 * the thing anybody actually needs later. `ai_model` records which it was, so
 * nobody reads a raw-notes filing as a reviewed summary.
 */
async function draftMinutes(client, { training, slug, actor = {} }) {
  const notes = await repo.listNotes(client, training.training_id);
  const source = minutes.sourceText({ notes });
  if (!source) return null;

  const drafted = await minutes.summarise(client, { session: training, notes });
  const body = drafted ? drafted.body_md : source;
  const model = drafted ? drafted.ai_model : "notes";

  const doc = await vault.createDocument(client, {
    entityRef: ref(training.training_id),
    docType: "TRAINING_MINUTES",
    dataUrl: "data:text/markdown;base64," + Buffer.from(body, "utf8").toString("base64"),
    fileContext: `Minutes — ${training.title || "training session"}`,
    originalName: `training-minutes-${String(training.training_id).slice(0, 8)}-${Date.now()}.md`,
    slug, actor,
  });
  const row = await repo.update(client, training.training_id, {
    ai_summary: body,
    ai_model: model,
    ai_summarised_at: new Date().toISOString(),
    minutes_vault_id: doc.doc_id,
  });
  await emitEvent(client, { eventTypeKey: events.MINUTES_FILED, moduleKey: events.MODULE, entityRef: ref(training.training_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.MINUTES_FILED, moduleKey: events.MODULE, entityRef: ref(training.training_id), after: { minutes_vault_id: doc.doc_id, ai_model: model } });
  return row;
}

/** The same thing, on demand — a facilitator who wrote the notes up after the
 *  session ended should not have to reopen it to get minutes. */
async function summarise(client, { id, slug, actor = {} }) {
  const training = await repo.get(client, id);
  if (!training) throw new AppError("NOT_FOUND", "Training not found", 404);
  const row = await draftMinutes(client, { training, slug, actor });
  if (!row) throw new AppError("NOTHING_TO_SUMMARISE", "No notes or minutes have been captured for this session yet.", 422);
  return repo.get(client, id);
}

/* ── Roster ─────────────────────────────────────────────────────────────── */

const listAttendees = (client, trainingId) => repo.listAttendees(client, trainingId);

async function addAttendee(client, { trainingId, data, actor = {} }) {
  const training = await repo.findById(client, trainingId);
  if (!training) return null;
  if (!data.employee_id) {
    // An attendance row with no employee attached is a row nobody can act on:
    // it counts towards capacity, appears on the roster as a blank line, and
    // can never satisfy a requirement. The validator refused everything except
    // this, which was the one field that mattered.
    throw new AppError("EMPLOYEE_REQUIRED", "An attendee needs an employee", 422);
  }
  const existing = await repo.findAttendee(client, trainingId, data.employee_id);
  if (existing) return existing;                  // Idempotent — Add pressed twice.

  const booked = (await repo.presenceRows(client, trainingId)).length;
  const cap = rules.capacityState({ capacity: training.capacity, booked });
  if (cap.is_full) throw new AppError("TRAINING_FULL", `This session is full (${cap.capacity} places).`, 422);

  const row = await repo.insertAttendee(client, { ...data, training_id: trainingId });
  await emitEvent(client, { eventTypeKey: events.ATTENDEE_ADDED, moduleKey: events.MODULE, entityRef: ref(trainingId), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ATTENDEE_ADDED, moduleKey: events.MODULE, entityRef: ref(trainingId), after: row });
  return row;
}

/**
 * Update one roster row. Ticking `attended` by hand stamps who did it, and
 * clears `attendance_observed` — a human decision is no longer a derivation,
 * and `settleAttendance` must not quietly overturn it later.
 *
 * Issuing a certificate fills the expiry from the requirement's `valid_months`
 * unless the caller supplied one. See header (3).
 */
async function updateAttendee(client, { trainingId, attendeeId, patch = {}, actor = {} }) {
  const before = await repo.getAttendee(client, attendeeId);
  if (!before || before.training_id !== trainingId) return null;
  const training = await repo.get(client, trainingId);
  const fields = { ...patch };

  if (patch.attended !== undefined && patch.attended !== before.attended) {
    fields.attendance_observed = false;
    fields.marked_at = new Date().toISOString();
    fields.marked_by = await resolveActorId(client, actor.user_id);
  }

  const gainsCertificate = patch.certificate_vault_id && !before.certificate_vault_id;
  if (gainsCertificate && patch.certificate_issued_on === undefined && !before.certificate_issued_on) {
    fields.certificate_issued_on = (training && training.closed_at ? new Date(training.closed_at) : new Date()).toISOString().slice(0, 10);
  }
  const issuedOn = fields.certificate_issued_on || patch.certificate_issued_on || before.certificate_issued_on;
  if (patch.certificate_expires_on === undefined && issuedOn && training && training.requirement_valid_months) {
    const expiry = rules.certificateExpiry(issuedOn, training.requirement_valid_months);
    if (expiry && expiry !== before.certificate_expires_on) fields.certificate_expires_on = expiry;
  }

  const row = await repo.updateAttendee(client, attendeeId, fields);
  await emitEvent(client, { eventTypeKey: events.ATTENDEE_UPDATED, moduleKey: events.MODULE, entityRef: ref(trainingId), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ATTENDEE_UPDATED, moduleKey: events.MODULE, entityRef: ref(trainingId), before, after: row });
  return row;
}

/* ── Requirements and compliance ────────────────────────────────────────── */

const listRequirements = (client, q = {}) =>
  repo.listRequirements(client, { includeInactive: q.include_inactive === true || q.include_inactive === "true" });

async function createRequirement(client, { data = {}, actor = {} }) {
  const row = await repo.insertRequirement(client, {
    title: data.title,
    description: data.description || null,
    department: data.department || null,
    job_title: data.job_title || null,
    valid_months: data.valid_months ?? null,
    warn_days: data.warn_days ?? 30,
    is_mandatory: data.is_mandatory !== false,
    is_active: data.is_active !== false,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: events.REQUIREMENT_CHANGED, moduleKey: events.MODULE, entityRef: "training_requirement:" + row.training_requirement_id, after: row });
  return row;
}

async function updateRequirement(client, { id, patch = {}, actor = {} }) {
  const before = await repo.getRequirement(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Requirement not found", 404);
  const fields = {};
  for (const k of ["title", "description", "department", "job_title", "valid_months", "warn_days", "is_mandatory", "is_active"]) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  const row = await repo.updateRequirement(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.REQUIREMENT_CHANGED, moduleKey: events.MODULE, entityRef: "training_requirement:" + id, before, after: row });
  return row;
}

/**
 * Who holds this qualification, who is about to lose it, and who never had it.
 *
 * The employee list comes back unfiltered from SQL and is narrowed HERE by
 * `requirementApplies`, so the matching rule exists once and the screen can
 * apply the identical one when previewing a requirement before it is saved.
 */
async function compliance(client, requirementId, { today = new Date() } = {}) {
  const requirement = await repo.getRequirement(client, requirementId);
  if (!requirement) throw new AppError("NOT_FOUND", "Requirement not found", 404);
  const rows = await repo.complianceRows(client, requirementId);
  const people = rows
    .filter((r) => rules.requirementApplies(requirement, r))
    .map((r) => ({
      employee_id: r.employee_id,
      full_name: r.full_name,
      department: r.department,
      job_title: r.job_title,
      attended_on: r.attended_on,
      training_id: r.training_id,
      training_title: r.training_title,
      certificate_vault_id: r.certificate_vault_id,
      ...rules.complianceStatus({
        expiresOn: r.certificate_expires_on,
        attendedOn: r.attended_on,
        warnDays: requirement.warn_days,
        today,
      }),
    }));
  const tally = people.reduce((a, p) => ({ ...a, [p.status]: (a[p.status] || 0) + 1 }), {});
  return {
    requirement,
    covered: people.length,
    // Named counts rather than a percentage: "4 expired" is actionable and
    // "87% compliant" is a number somebody puts in a slide.
    counts: { CURRENT: 0, EXPIRING: 0, EXPIRED: 0, NEVER: 0, ...tally },
    people,
  };
}

const expiringCertificates = (client, q = {}) => repo.expiringCertificates(client, { days: q.days ?? 60 });

/** One session, with the derived state a screen would otherwise recompute —
 *  and recompute differently. */
async function get(client, id) {
  const row = await repo.get(client, id);
  if (!row) return null;
  const [attendees, notes] = await Promise.all([repo.listAttendees(client, id), repo.listNotes(client, id)]);
  return {
    ...row,
    attendees,
    notes,
    planned_minutes: rules.plannedMinutes(row),
    actual_minutes: rules.actualMinutes(row),
    join_state: rules.joinState(row, new Date()),
    capacity_state: rules.capacityState({ capacity: row.capacity, booked: attendees.length }),
  };
}

module.exports = {
  ...base,
  create, update, get, setStatus,
  join, leave, settleAttendance,
  addNote, summarise,
  listAttendees, addAttendee, updateAttendee,
  listRequirements, createRequirement, updateRequirement, compliance, expiringCertificates,
};
