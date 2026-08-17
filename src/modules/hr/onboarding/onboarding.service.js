/**
 * Onboarding checklists (MOD-16 / 0703) — templates, dates, owners, and the
 * checklist a hire raises by itself.
 *
 * ── WHAT THIS USED TO BE ───────────────────────────────────────────────────
 *
 * A list of strings and a tick box, retyped for every hire. No due date, so
 * nothing could be late and nothing was ever chased. No owner, so every item
 * read as the HR administrator's job while IT issued the laptop and Finance
 * opened the payroll record. No template, so the twelfth new starter got a
 * different list from the first. And nothing raised it — hiring an applicant
 * provisioned an employee row and stopped, leaving the checklist to whoever
 * remembered, at exactly the moment everybody is busy.
 *
 * ── THREE THINGS TO KNOW BEFORE CHANGING THIS FILE ─────────────────────────
 *
 * 1. `complete` REFUSES while a mandatory item is outstanding, and names the
 *    ones blocking it. Those are the statutory registrations; a Complete button
 *    that closes over them records that somebody wanted the row gone, not that
 *    onboarding finished.
 *
 * 2. THE TEMPLATE'S TEXT IS COPIED, ITS SOP IS REFERENCED. Editing a template
 *    must not rewrite the checklist of somebody who started three weeks ago —
 *    their list is the record of what they were actually asked to do. The SOP
 *    link is the deliberate exception: an item should point at the current
 *    procedure, not last year's snapshot.
 *
 * 3. `raiseForEmployee` IS IDEMPOTENT. It is called from the HIRED transition,
 *    which a recruiter can re-save; without the guard, re-saving a status would
 *    give somebody two onboarding checklists.
 */
"use strict";
const repo = require("./onboarding.repo");
const rules = require("./onboarding.rules");
const { audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const MODULE = "MOD-16";
const ref = (id) => "onboarding_checklist:" + id;

/* ── Checklists ─────────────────────────────────────────────────────────── */

const list = (client, q = {}) => repo.listChecklists(client, { status: q.status || null });

/** One checklist with its items and the derived state a screen would otherwise
 *  recompute — and recompute differently from the completion guard. */
async function get(client, id) {
  const checklist = await repo.getChecklist(client, id);
  if (!checklist) return null;
  const items = await repo.listItems(client, id);
  const withState = items.map((i) => ({ ...i, ...rules.itemState(i) }));
  return {
    ...checklist,
    items: withState,
    progress: rules.progress(items),
    // What the Complete button will refuse on, stated BEFORE it is pressed.
    // A gate the user discovers by being rejected is a gate they work around.
    blockers: rules.completionBlockers(items).map((i) => ({
      onboarding_item_id: i.onboarding_item_id, label: i.label, due_on: i.due_on,
    })),
  };
}

async function create(client, { employee_id, items = [], template_id = null, starts_on = null, actor = {} }) {
  const checklist = await repo.insertChecklist(client, {
    employee_id: employee_id || null,
    onboarding_template_id: template_id || null,
    starts_on: starts_on || null,
  });
  const id = checklist.onboarding_checklist_id;

  if (template_id) {
    await applyTemplate(client, { checklistId: id, templateId: template_id, startsOn: starts_on });
  }
  // Hand-typed labels, still accepted — a one-off checklist for a contractor is
  // a real thing and should not require a template first.
  let order = 0;
  for (const label of items) {
    if (label && String(label).trim()) {
      order += 10;
      await repo.insertItem(client, { onboarding_checklist_id: id, label: String(label).trim(), sort_order: order });
    }
  }
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.created", moduleKey: MODULE, entityRef: ref(id), after: checklist });
  return get(client, id);
}

/** Copy a template's items onto a checklist. Separate from `create` because
 *  applying a template to a checklist raised by hand is a real act. */
async function applyTemplate(client, { checklistId, templateId, startsOn = null }) {
  const templateItems = await repo.listTemplateItems(client, templateId);
  const rows = rules.itemsFromTemplate(templateItems, { startsOn });
  for (const row of rows) {
    await repo.insertItem(client, { ...row, onboarding_checklist_id: checklistId });
  }
  return rows.length;
}

/**
 * Raise a checklist for a newly hired employee, from whichever template fits.
 *
 * Called by the vacancy module on the transition into HIRED. Returns null —
 * never throws — when there is no active template or one already exists: this
 * runs inside the hiring transaction, and a missing onboarding template must
 * not be the reason somebody cannot be hired.
 */
async function raiseForEmployee(client, { employee, applicantId = null, startsOn = null, actor = {} }) {
  if (!employee || !employee.employee_id) return null;
  const existing = await repo.checklistForEmployee(client, employee.employee_id);
  if (existing) return null;                    // Idempotent — see header (3).

  const templates = await repo.listTemplates(client, {});
  const template = rules.pickTemplate(templates, employee);
  if (!template) return null;

  const checklist = await repo.insertChecklist(client, {
    employee_id: employee.employee_id,
    onboarding_template_id: template.onboarding_template_id,
    applicant_id: applicantId,
    starts_on: startsOn || employee.hired_on || null,
  });
  const count = await applyTemplate(client, {
    checklistId: checklist.onboarding_checklist_id,
    templateId: template.onboarding_template_id,
    startsOn: checklist.starts_on,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "onboarding.raised", moduleKey: MODULE,
    entityRef: ref(checklist.onboarding_checklist_id),
    after: { template: template.name, items: count, employee_id: employee.employee_id, applicant_id: applicantId },
  });
  return checklist;
}

/**
 * Move every dated item because the start date moved.
 *
 * Deliberately an ACT and not a side effect of editing `employee.hired_on`:
 * silently re-dating a checklist somebody is already working through is how a
 * task they completed yesterday becomes overdue tomorrow. Items already done
 * keep their dates — rescheduling the future does not rewrite the past.
 */
async function reschedule(client, { id, startsOn, actor = {} }) {
  const before = await repo.getChecklist(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Checklist not found", 404);
  if (!before.onboarding_template_id) {
    // Without a template there are no offsets to recompute from — the dates
    // were typed, and shifting them would be guessing at an interval nobody
    // stated.
    throw new AppError("NO_TEMPLATE", "This checklist was not raised from a template, so its dates have no offsets to recompute.", 422);
  }
  const [items, templateItems] = await Promise.all([
    repo.listItems(client, id), repo.listTemplateItems(client, before.onboarding_template_id),
  ]);
  const offsetByLabel = new Map(templateItems.map((t) => [t.label, t.due_days]));
  let moved = 0;
  for (const item of items) {
    if (item.is_done) continue;
    if (!offsetByLabel.has(item.label)) continue;   // Added by hand — not ours to move.
    const due = rules.dueDateFor(startsOn, offsetByLabel.get(item.label));
    if (due && due !== item.due_on) {
      await repo.updateItem(client, item.onboarding_item_id, { due_on: due });
      moved += 1;
    }
  }
  await repo.updateChecklist(client, id, { starts_on: startsOn });
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.rescheduled", moduleKey: MODULE, entityRef: ref(id), before, after: { starts_on: startsOn, items_moved: moved } });
  return get(client, id);
}

/* ── Items ──────────────────────────────────────────────────────────────── */

async function addItem(client, { checklistId, data = {}, actor = {} }) {
  const checklist = await repo.getChecklist(client, checklistId);
  if (!checklist) throw new AppError("NOT_FOUND", "Checklist not found", 404);
  // A due date given as an offset is resolved here, so an item added by hand
  // can use the same "day 3" vocabulary the template does.
  const due = data.due_on !== undefined
    ? data.due_on
    : (data.due_days !== undefined ? rules.dueDateFor(checklist.starts_on, data.due_days) : null);
  const row = await repo.insertItem(client, {
    onboarding_checklist_id: checklistId,
    label: data.label,
    description: data.description || null,
    due_on: due,
    owner_role: data.owner_role || null,
    assigned_to: data.assigned_to || null,
    sop_document_id: data.sop_document_id || null,
    is_mandatory: data.is_mandatory === true,
    sort_order: data.sort_order ?? 1000,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.item_added", moduleKey: MODULE, entityRef: ref(checklistId), after: row });
  return row;
}

/**
 * Tick, untick, reassign or re-date one item.
 *
 * Ticking stamps WHO did it. `done_at` records that it happened and not who,
 * and for a statutory registration that is precisely the question asked
 * afterwards. Unticking clears both rather than leaving a stale name against an
 * item that is no longer done.
 */
async function updateItem(client, { itemId, patch = {}, actor = {} }) {
  const before = await repo.getItem(client, itemId);
  if (!before) return null;
  const fields = {};
  for (const k of ["label", "description", "due_on", "owner_role", "assigned_to", "sop_document_id", "is_mandatory", "sort_order", "notes"]) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  if (patch.is_done !== undefined && patch.is_done !== before.is_done) {
    fields.is_done = patch.is_done === true;
    fields.done_at = fields.is_done ? new Date().toISOString() : null;
    fields.done_by = fields.is_done ? await resolveActorId(client, actor.user_id) : null;
  }
  const row = await repo.updateItem(client, itemId, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.item_updated", moduleKey: MODULE, entityRef: ref(before.onboarding_checklist_id), before, after: row });
  return row;
}

/** The old two-argument tick, kept so the existing PATCH /items/:itemId route
 *  and anything calling it keep working unchanged. */
const toggleItem = (client, { itemId, isDone, actor = {} }) =>
  updateItem(client, { itemId, patch: { is_done: isDone }, actor });

/* ── Completion ─────────────────────────────────────────────────────────── */

/**
 * Close a checklist — unless a mandatory item is outstanding. See header (1).
 * The refusal NAMES them: "3 items remain" is a message somebody works around,
 * "the CNPS registration is still open" is one they act on.
 */
async function complete(client, { id, actor = {} }) {
  const checklist = await repo.getChecklist(client, id);
  if (!checklist) return null;
  const items = await repo.listItems(client, id);
  const blockers = rules.completionBlockers(items);
  if (blockers.length) {
    throw new AppError(
      "MANDATORY_ITEMS_OUTSTANDING",
      `Still outstanding: ${blockers.map((b) => b.label).join("; ")}`,
      422,
      { items: blockers.map((b) => ({ onboarding_item_id: b.onboarding_item_id, label: b.label })) },
    );
  }
  const row = await repo.updateChecklist(client, id, { status: "COMPLETED", completed_at: new Date().toISOString() });
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.completed", moduleKey: MODULE, entityRef: ref(id), after: row });
  return get(client, id);
}

/* ── Templates ──────────────────────────────────────────────────────────── */

const listTemplates = (client, q = {}) =>
  repo.listTemplates(client, { includeInactive: q.include_inactive === true || q.include_inactive === "true" });

async function getTemplate(client, id) {
  const template = await repo.getTemplate(client, id);
  if (!template) return null;
  return { ...template, items: await repo.listTemplateItems(client, id) };
}

async function createTemplate(client, { data = {}, actor = {} }) {
  const row = await repo.insertTemplate(client, {
    name: data.name,
    description: data.description || null,
    department: data.department || null,
    job_title: data.job_title || null,
    priority: data.priority ?? 0,
    is_active: data.is_active !== false,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.template_changed", moduleKey: MODULE, entityRef: "onboarding_template:" + row.onboarding_template_id, after: row });
  return getTemplate(client, row.onboarding_template_id);
}

async function updateTemplate(client, { id, patch = {}, actor = {} }) {
  const before = await repo.getTemplate(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Template not found", 404);
  const fields = {};
  for (const k of ["name", "description", "department", "job_title", "priority", "is_active"]) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  const row = await repo.updateTemplate(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.template_changed", moduleKey: MODULE, entityRef: "onboarding_template:" + id, before, after: row });
  return getTemplate(client, id);
}

async function addTemplateItem(client, { templateId, data = {}, actor = {} }) {
  const template = await repo.getTemplate(client, templateId);
  if (!template) throw new AppError("NOT_FOUND", "Template not found", 404);
  const existing = await repo.listTemplateItems(client, templateId);
  const row = await repo.insertTemplateItem(client, {
    onboarding_template_id: templateId,
    label: data.label,
    description: data.description || null,
    due_days: data.due_days ?? 0,
    owner_role: data.owner_role || null,
    sop_document_id: data.sop_document_id || null,
    is_mandatory: data.is_mandatory === true,
    // Appended at the end by default rather than at 0, which would silently put
    // every new item first.
    sort_order: data.sort_order ?? (existing.length + 1) * 10,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.template_changed", moduleKey: MODULE, entityRef: "onboarding_template:" + templateId, after: row });
  return row;
}

async function updateTemplateItem(client, { itemId, patch = {}, actor = {} }) {
  const before = await repo.getTemplateItem(client, itemId);
  if (!before) return null;
  const fields = {};
  for (const k of ["label", "description", "due_days", "owner_role", "sop_document_id", "is_mandatory", "sort_order"]) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  const row = await repo.updateTemplateItem(client, itemId, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.template_changed", moduleKey: MODULE, entityRef: "onboarding_template:" + before.onboarding_template_id, before, after: row });
  return row;
}

async function removeTemplateItem(client, { itemId, actor = {} }) {
  const row = await repo.deleteTemplateItem(client, itemId);
  if (!row) return null;
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.template_changed", moduleKey: MODULE, entityRef: "onboarding_template:" + row.onboarding_template_id, before: row, after: null });
  return row;
}

/** What is late or nearly late across every open checklist — the panel that
 *  turns a set of checklists into a queue somebody works. */
const outstanding = (client, q = {}) => repo.outstandingItems(client, { days: q.days ?? 14 });

module.exports = {
  list, get, create, applyTemplate, raiseForEmployee, reschedule,
  addItem, updateItem, toggleItem, complete, outstanding,
  listTemplates, getTemplate, createTemplate, updateTemplate,
  addTemplateItem, updateTemplateItem, removeTemplateItem,
};
