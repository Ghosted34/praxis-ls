"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./hr_contract.repo");
const events = require("./hr_contract.events");
const employeeService = require("../../master/employees/employees.service");

// Contract lifecycle: DRAFT → ISSUED → SIGNED → ENDED. A signed or ended
// contract is terminal for forward flow (ENDED only reachable from SIGNED).
const TRANSITIONS = {
  DRAFT: ["ISSUED"],
  ISSUED: ["SIGNED", "ENDED"],
  SIGNED: ["ENDED"],
  ENDED: [],
};

/** `2026-08-16` + 3 months → `2026-11-16`, clamped to the end of a short month
 *  (31 January + 1 month is 28 February, not 3 March). */
function addMonths(isoDate, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (!m || !months) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const target = new Date(Date.UTC(y, mo - 1 + Number(months), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}


const base = makeService({ repo, moduleKey: events.MODULE, entity: "hr_contract", events });

module.exports = {
  ...base,

  // A contract is always issued to an active employee.
  async create(client, { data, actor = {} }) {
    if (data.employee_id) await employeeService.assertActive(client, data.employee_id);
    return base.create(client, { data, actor });
  },

  /**
   * Draft (or re-draft) the contract text.
   *
   * ── WHY THE TERMS ARE WRITTEN FROM THE INPUT, NOT FROM THE DRAFT ────────
   *
   * The model writes prose; it does not decide terms. Salary, dates, probation
   * and notice are taken from what the caller passed and written to their own
   * columns — so even a model that "helpfully" adjusted a figure in the text
   * cannot make that the recorded agreement, and `probation_ends_on` is
   * computed here rather than parsed back out of a paragraph.
   *
   * ── AND WHY THE MODEL CALL IS NOT IN THE TRANSACTION ────────────────────
   *
   * It is several seconds against a 12-connection-per-tenant ceiling. The
   * controller reads the context, releases, calls this, and writes — see
   * `draftFor` in the controller.
   */
  async applyDraft(client, { id, draft, terms, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    if (before.status !== "DRAFT") {
      // Re-writing the text of a contract somebody has been given — or signed —
      // is not an edit. Supersede it with a renewal instead.
      throw new AppError("INVALID_TRANSITION", `A ${before.status.toLowerCase()} contract can no longer be redrafted`, 422);
    }
    const probationEnds =
      terms.effective_on && terms.probation_months
        ? addMonths(terms.effective_on, terms.probation_months)
        : null;
    const row = await repo.update(client, id, {
      title: terms.title || before.title || null,
      body_md: draft.body_md,
      ai_generated: draft.ai_generated,
      ai_model: draft.ai_model,
      entity_id: terms.entity_id ?? before.entity_id ?? null,
      job_title: terms.job_title ?? null,
      gross_salary: terms.gross_salary ?? null,
      salary_currency: terms.salary_currency || "XAF",
      probation_months: terms.probation_months ?? null,
      probation_ends_on: probationEnds,
      notice_days: terms.notice_days ?? null,
      working_hours: terms.working_hours ?? null,
      place_of_work: terms.place_of_work ?? null,
      effective_on: terms.effective_on ?? before.effective_on ?? null,
      end_on: terms.end_on ?? before.end_on ?? null,
      vacancy_id: terms.vacancy_id ?? before.vacancy_id ?? null,
    });
    const entityRef = `hr_contract:${id}`;
    await emitEvent(client, { eventTypeKey: events.DRAFTED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null, payload: { ai: draft.ai_generated, model: draft.ai_model } });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DRAFTED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },

  async setStatus(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move contract ${before.status} → ${status}`, 422);
    }
    // Signing is the point at which the terms become binding, so it is the
    // point at which they stop being editable — `applyDraft` refuses anything
    // past DRAFT for the same reason.
    const patch = { status };
    if (status === "SIGNED" && !before.signed_on) patch.signed_on = new Date().toISOString().slice(0, 10);
    const row = await repo.update(client, id, patch);
    const entityRef = `hr_contract:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};

// Exported for the test that pins the short-month clamp.
module.exports.addMonths = addMonths;
