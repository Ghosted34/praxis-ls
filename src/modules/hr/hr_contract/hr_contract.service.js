"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./hr_contract.repo");
const events = require("./hr_contract.events");
const employeeService = require("../../master/employees/employees.service");
const numbering = require("../../../services/documents/numbering.service");

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

/** `2026-08-16` + 7 days → `2026-08-23`. Plain calendar arithmetic. */
function addDays(isoDate, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
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

  /**
   * Edit a contract.
   *
   * ── WHY THE TEXT AND THE TERMS PART COMPANY HERE ────────────────────────
   *
   * `applyDraft` refuses to rewrite the TEXT of a contract past DRAFT, and
   * that is right: the wording is what the parties signed, and changing it is
   * rewriting history rather than editing a record. A renewal supersedes it —
   * that is what `renews_contract_id` is for.
   *
   * But `update` came straight off the CRUD base with no guard at all, so a
   * PATCH could do exactly what `applyDraft` forbids. That hole is closed
   * below.
   *
   * RECORDING THE TERMS is a different act, and it must stay open at any
   * status. Every contract signed before 0700 has no `probation_ends_on`, no
   * `notice_days` and no salary on the row — the agreement happened on paper
   * and the system simply has no structured copy of it. Refusing to record
   * those would mean the expiry watcher can never see an existing fixed term
   * and payroll can never know a notice period, for the whole back catalogue,
   * for ever. Typing in what a signed contract already says is not amending
   * it.
   */
  async update(client, { id, patch, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;

    if (before.status !== "DRAFT") {
      // The wording, and the document rendered from it. Named explicitly so the
      // message says which field was refused rather than rejecting the whole
      // patch — an HR officer recording a notice period should not be told
      // "no".
      const frozen = ["body_md", "title"].filter((k) => patch[k] !== undefined && patch[k] !== before[k]);
      if (frozen.length) {
        throw new AppError(
          "CONTRACT_TEXT_FROZEN",
          `The wording of a ${before.status.toLowerCase()} contract cannot be changed — supersede it with a renewal`,
          422,
          { body_md: ["This is what the parties signed. Raise a renewal to change it."] },
        );
      }
    }

    // Kept in step with the dates whichever route sets them. Computed here as
    // well as in `applyDraft` because recording a probation on an already
    // signed contract is precisely the case the watcher exists for.
    const next = { ...patch };
    // `!== undefined`, NOT `??`: null is nullish, so `patch.probation_months ??
    // before.probation_months` read an explicit "clear this" as "not
    // provided" and kept the old figure — leaving the watcher warning about a
    // probation nobody was serving.
    const effectiveOn = patch.effective_on !== undefined ? patch.effective_on : before.effective_on;
    const months = patch.probation_months !== undefined ? patch.probation_months : before.probation_months;
    if (patch.effective_on !== undefined || patch.probation_months !== undefined) {
      next.probation_ends_on = effectiveOn && months ? addMonths(effectiveOn, months) : null;
    }

    return base.update(client, { id, patch: next, actor });
  },

  /**
   * Renew a contract (10708) — the action 0700's `renews_contract_id` has
   * been waiting for since the column landed.
   *
   * ── WHY THE TEXT IS NOT COPIED ──────────────────────────────────────────
   *
   * The old `body_md` is the wording the parties SIGNED, dates included.
   * Copying it into the renewal would put last term's dates under this term's
   * number, and redrafting is exactly what the DRAFT state is for. The TERMS
   * that stay true — job title, salary, notice, working hours, place of work,
   * probation — carry over as columns; the prose is drafted afresh against
   * the new dates (or written by hand).
   *
   * ── THE DATES ───────────────────────────────────────────────────────────
   *
   * The new term starts the day after the old one ends, and keeps the old
   * term's LENGTH — a renewal continues what was agreed, it does not invent a
   * new one. Both are overridable, because a tenant that renegotiated the
   * term before pressing the button knows better than a default.
   */
  async renew(client, { id, effective_on = null, end_on = null, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    if (before.status === "DRAFT") {
      throw new AppError("INVALID_TRANSITION", "A draft contract has no agreed term to renew", 422);
    }
    if (!before.employee_id) {
      throw new AppError("VALIDATION_ERROR", "This contract has no employee on it — raise a new contract instead", 422);
    }
    await employeeService.assertActive(client, before.employee_id);

    const termDays =
      before.end_on && before.effective_on
        ? Math.round((new Date(before.end_on) - new Date(before.effective_on)) / 86_400_000)
        : null;
    const effective = effective_on || (before.end_on ? addDays(before.end_on, 1) : null);
    const end =
      end_on ||
      (termDays !== null && termDays !== undefined && termDays > 0 && effective
        ? addDays(effective, termDays)
        : null);

    const row = await repo.create(client, {
      employee_id: before.employee_id,
      kind: before.kind || "EMPLOYMENT",
      status: "DRAFT",
      title: before.title || null,
      entity_id: before.entity_id ?? null,
      job_title: before.job_title ?? null,
      gross_salary: before.gross_salary ?? null,
      salary_currency: before.salary_currency ?? null,
      probation_months: before.probation_months ?? null,
      probation_ends_on: effective && before.probation_months ? addMonths(effective, before.probation_months) : null,
      notice_days: before.notice_days ?? null,
      working_hours: before.working_hours ?? null,
      place_of_work: before.place_of_work ?? null,
      effective_on: effective,
      end_on: end,
      vacancy_id: before.vacancy_id ?? null,
      renews_contract_id: before.hr_contract_id,
    });
    const entityRef = `hr_contract:${row.hr_contract_id}`;
    await emitEvent(client, {
      eventTypeKey: events.RENEWED, moduleKey: events.MODULE, entityRef,
      actorUserId: actor.user_id || null, payload: { renewed_from: id },
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.RENEWED, moduleKey: events.MODULE,
      entityRef, before: { renewed_from: id }, after: row,
    });
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

    /**
     * A REAL CONTRACT NUMBER, at issue.
     *
     * `MOD-12 → "CTR"` has been registered in numbering.service since the
     * scheme table was written, and nothing ever called it. With no
     * `doc_number`, the PDF template fell back to
     * `String(hr_contract_id).slice(0, 8)` — so every employment contract this
     * system has issued went out numbered with eight hex characters of a UUID
     * instead of the tenant's configured sequence.
     *
     * Allocated at ISSUED, not at draft: that is the moment the document
     * becomes an instrument that leaves the building, and it is where the
     * invoice does it too. A draft that is never issued must not burn a number
     * — gaps in a contract register are the kind of thing an auditor asks about.
     * Guarded on `!before.doc_number`, so re-issuing never renumbers.
     */
    if (status === "ISSUED" && !before.doc_number) {
      const entityId = before.entity_id
        || (await repo.entityIdFor(client, { contractId: id, employeeId: before.employee_id }));
      if (entityId) {
        const { number } = await numbering.allocate(client, {
          moduleKey: "MOD-12", entityId, date: before.effective_on || null,
        });
        patch.doc_number = number;
      }
    }

    const row = await repo.update(client, id, patch);
    const entityRef = `hr_contract:${id}`;

    /**
     * SIGNING A RENEWAL ENDS WHAT IT RENEWS.
     *
     * `renew()` creates a new contract row rather than editing the old one,
     * and that is correct: the old `body_md` is the wording the parties
     * signed, and this module refuses to rewrite a signed document anywhere
     * else. A renewal is a new instrument with its own term and its own
     * signatures.
     *
     * What was missing is the other half. Nothing ever closed the predecessor,
     * so once a renewal was signed the employee held TWO live contracts —
     * both in ('ISSUED','SIGNED'), both showing in the register, with nothing
     * saying which one governs. `renews_contract_id` recorded the chain and no
     * code acted on it.
     *
     * Done at SIGNED, deliberately. Not at renew() — the old contract must
     * stay live while its replacement is being drafted, or the employee is
     * briefly under no contract at all. Not at ISSUED — issued is not yet
     * binding. Signing is the moment the new terms take effect, which is the
     * moment the old ones stop.
     *
     * The predecessor's `end_on` is NOT rewritten: it is an agreed date on a
     * signed document, and this module does not edit those. The status change
     * and its reason go to the audit trail instead.
     */
    if (status === "SIGNED" && before.renews_contract_id) {
      const prior = await repo.findById(client, before.renews_contract_id);
      if (prior && (prior.status === "ISSUED" || prior.status === "SIGNED")) {
        const ended = await repo.update(client, prior.hr_contract_id, { status: "ENDED" });
        await audit(client, {
          actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE,
          entityRef: `hr_contract:${prior.hr_contract_id}`,
          before: prior, after: ended,
          payload: { superseded_by: id, reason: "renewal signed" },
        });
      }
    }

    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};

// Exported for the test that pins the short-month clamp.
module.exports.addMonths = addMonths;
module.exports.addDays = addDays;
