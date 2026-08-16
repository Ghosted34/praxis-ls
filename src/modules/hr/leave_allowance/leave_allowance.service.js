/**
 * Leave / salary-advance / mission requests (MOD-15).
 *
 * ── WHAT CHANGED IN 0696, AND WHY IT MATTERS ───────────────────────────────
 *
 * Before: a request was a name, two unvalidated date strings and a status, and
 * `decide` flipped the status. Nothing counted the days, nothing knew what the
 * employee was entitled to, and an approver therefore approved against nothing.
 *
 * Now a leave request is priced when it is raised — working days between the
 * dates, weekends and public holidays excluded per the leave type, half days at
 * either end — and that number is CHARGED to the employee's entitlement ledger
 * when it is approved. The balance is the sum of signed ledger movements; no
 * column stores it (see the migration for why).
 *
 * ── THE THREE PLACES THIS CAN SAY NO ───────────────────────────────────────
 *
 *   AT REQUEST TIME, on facts about the request itself: no employee, dates that
 *   run backwards, a span that is entirely weekend, a missing sick note for a
 *   type that requires one, or an overlap with leave the same person already
 *   has booked. All of these are the requester's to fix and are refused with
 *   the field named.
 *
 *   AT APPROVAL TIME, on the balance — and it is re-checked here rather than
 *   trusted from request time, because a fortnight can pass between the two and
 *   three other requests can be approved in between. This is the check that did
 *   not exist at all.
 *
 *   NOWHERE, for a type with `allow_negative`. Advancing next year's leave is a
 *   real decision an employer is allowed to make; what it must not be is an
 *   accident, so it is a property of the leave type rather than an override on
 *   the button.
 *
 * Salary advances and missions are NOT leave: they have no type, consume no
 * entitlement and skip all of it. They share this table because they share the
 * request-and-approve shape, which is worth keeping.
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");
const repo = require("./leave_allowance.repo");
const events = require("./leave_allowance.events");
const rules = require("./leave.rules");
const employeeService = require("../../master/employees/employees.service");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "leave_allowance", events });

const ref = (id) => `leave_allowance:${id}`;
const yearOf = (isoDate) => {
  const p = rules.parseDate(isoDate);
  return p ? p.y : new Date().getUTCFullYear();
};

/** Which days the tenant does not work. `hr.weekend_days` is a list of JS day
 *  numbers — [0,6] by default; a six-day week is [0]. */
async function weekendDays(client) {
  const v = await getSetting(client, "hr", "weekend_days", null);
  const list = Array.isArray(v) ? v : v && Array.isArray(v.days) ? v.days : null;
  if (!list) return rules.DEFAULT_WEEKEND;
  const clean = list.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  // An empty or nonsense setting must not silently mean "every day is a working
  // day" — that would over-count every request by two days a week.
  return clean.length ? clean : rules.DEFAULT_WEEKEND;
}

/** The calendar the day count is measured against, read once per operation. */
async function calendar(client) {
  return { weekendDays: await weekendDays(client), holidays: await repo.listHolidays(client) };
}

const isLeave = (kind) => (kind || "leave") === "leave";

/**
 * Price a request: how many days it consumes, refusing rather than guessing.
 * Returns the day count; throws with the offending field named.
 */
async function priceRequest(client, data, type) {
  const { weekendDays: wd, holidays } = await calendar(client);
  const days = rules.countDays({
    starts_on: data.starts_on,
    ends_on: data.ends_on,
    counts_working_days: type ? type.counts_working_days : true,
    half_day_start: data.half_day_start,
    half_day_end: data.half_day_end,
    weekendDays: wd,
    holidays,
  });
  if (days === null) {
    throw new AppError("VALIDATION_ERROR", "Check the dates on this request", 422, {
      ends_on: ["The end date must be on or after the start date."],
    });
  }
  if (days === 0) {
    // Every day in the span is a weekend or a public holiday. Approving it
    // would charge nothing and mean nothing, and it is nearly always a typo.
    throw new AppError("VALIDATION_ERROR", "That span contains no working days", 422, {
      starts_on: ["Weekends and public holidays only — check the dates."],
    });
  }
  return days;
}

/** The balance for one employee/type/year, folded from the ledger. */
async function balance(client, { employeeId, leaveTypeId, year }) {
  const entries = await repo.ledgerFor(client, { employeeId, leaveTypeId, year });
  return rules.balanceFrom(entries);
}

module.exports = {
  ...base,

  /* ── Catalogues ─────────────────────────────────────────────────────────── */

  listTypes: (client, q = {}) => repo.listTypes(client, { includeInactive: q.include_inactive === "true" }),
  listHolidays: (client, q = {}) => repo.listHolidays(client, { includeInactive: q.include_inactive === "true" }),

  async createType(client, { data, actor = {} }) {
    const existing = await repo.findTypeByCode(client, data.code);
    if (existing) throw new AppError("DUPLICATE", `A leave type with code ${data.code} already exists`, 409);
    const row = await repo.insertType(client, data);
    await audit(client, { actorUserId: actor.user_id || null, action: "leave_type.created", moduleKey: events.MODULE, entityRef: `leave_type:${row.leave_type_id}`, after: row });
    return row;
  },

  async updateType(client, { id, patch, actor = {} }) {
    const before = await repo.findType(client, id);
    if (!before) return null;
    const row = await repo.updateType(client, id, patch);
    await audit(client, { actorUserId: actor.user_id || null, action: "leave_type.updated", moduleKey: events.MODULE, entityRef: `leave_type:${id}`, before, after: row });
    return row;
  },

  async addHoliday(client, { data, actor = {} }) {
    const row = await repo.insertHoliday(client, data);
    await audit(client, { actorUserId: actor.user_id || null, action: "public_holiday.added", moduleKey: events.MODULE, entityRef: `public_holiday:${row.public_holiday_id}`, after: row });
    return row;
  },

  async removeHoliday(client, { id, actor = {} }) {
    const row = await repo.deactivateHoliday(client, id);
    if (!row) return null;
    await audit(client, { actorUserId: actor.user_id || null, action: "public_holiday.removed", moduleKey: events.MODULE, entityRef: `public_holiday:${id}`, after: row });
    return row;
  },

  /* ── Balances ───────────────────────────────────────────────────────────── */

  /**
   * Every leave type's balance for one employee, for a year. This is what the
   * request form shows BEFORE somebody types a date — the number that was
   * missing from the whole product.
   */
  async balances(client, { employeeId, year = null }) {
    const y = year || new Date().getUTCFullYear();
    const types = await repo.listTypes(client);
    const entries = await repo.ledgerFor(client, { employeeId, year: y });
    return types.map((t) => {
      const mine = entries.filter((e) => e.leave_type_id === t.leave_type_id);
      return {
        leave_type_id: t.leave_type_id,
        code: t.code,
        name: t.name,
        is_paid: t.is_paid,
        allow_negative: t.allow_negative,
        requires_document: t.requires_document,
        max_days_per_year: t.max_days_per_year,
        period_year: y,
        ...rules.balanceFrom(mine),
      };
    });
  },

  /** The movements themselves — "where did that number come from?" */
  ledger: (client, { employeeId, leaveTypeId = null, year = null }) =>
    repo.ledgerFor(client, { employeeId, leaveTypeId, year }),

  /**
   * A manual correction. Requires a note, because a balance moved by hand with
   * no stated reason is exactly the entry an employee will later contest and
   * nobody will be able to explain.
   */
  async adjust(client, { employeeId, leaveTypeId, days, note, year = null, actor = {} }) {
    if (!note || !String(note).trim()) {
      throw new AppError("VALIDATION_ERROR", "An adjustment needs a reason", 422, {
        note: ["Say why the balance is being changed."],
      });
    }
    const type = await repo.findType(client, leaveTypeId);
    if (!type) throw new AppError("NOT_FOUND", "Leave type not found", 404);
    const row = await repo.insertLedger(client, {
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      period_year: year || new Date().getUTCFullYear(),
      kind: "ADJUSTMENT",
      days,
      note: String(note).trim(),
      // Resolved against THIS schema: app_user lives in live, and a sandbox
      // session's user id is not a row here — the FK would raise 23503 and take
      // the whole adjustment down (DATA 2.4).
      created_by: await resolveActorId(client, actor.user_id),
    });
    await audit(client, { actorUserId: actor.user_id || null, action: "leave.adjusted", moduleKey: events.MODULE, entityRef: `employee:${employeeId}`, after: row });
    return row;
  },

  /* ── Requests ───────────────────────────────────────────────────────────── */

  /**
   * A request is always bound to an active employee (HR integrity), and a leave
   * request is priced and checked for clashes before it is stored.
   */
  async create(client, { data, actor = {} }) {
    if (!data.employee_id) {
      // Was optional in the validator, which allowed a request attached to
      // nobody — unapprovable, uncountable, and invisible in My HR.
      throw new AppError("VALIDATION_ERROR", "A request needs an employee", 422, {
        employee_id: ["Choose who this is for."],
      });
    }
    await employeeService.assertActive(client, data.employee_id);

    if (!isLeave(data.kind)) return base.create(client, { data, actor });

    const type = data.leave_type_id
      ? await repo.findType(client, data.leave_type_id)
      : await repo.findTypeByCode(client, "ANNUAL");
    if (!type) throw new AppError("NOT_FOUND", "Leave type not found", 404);
    if (!type.is_active) {
      throw new AppError("VALIDATION_ERROR", `${type.name} is no longer offered`, 422, {
        leave_type_id: ["Choose an active leave type."],
      });
    }
    if (type.requires_document && !data.document_vault_id) {
      throw new AppError("VALIDATION_ERROR", `${type.name} needs supporting evidence`, 422, {
        document_vault_id: [`Attach the document ${type.name.toLowerCase()} requires.`],
      });
    }

    const days = await priceRequest(client, data, type);

    // Booked twice over the same dates is the commonest data error here, and it
    // double-charges the balance. Checked against live requests only — a
    // rejected or cancelled one occupies no calendar.
    const existing = await repo.overlappingRequests(client, { employeeId: data.employee_id });
    const clash = existing.find((r) => rules.overlaps(r, data));
    if (clash) {
      throw new AppError("LEAVE_OVERLAP", "This overlaps leave already booked for that person", 409, {
        starts_on: [`Overlaps a ${String(clash.status).toLowerCase()} request from ${clash.starts_on} to ${clash.ends_on}.`],
      });
    }

    return base.create(client, {
      data: { ...data, leave_type_id: type.leave_type_id, days },
      actor,
    });
  },

  /** Re-price when the dates, the half days or the type move. */
  async update(client, { id, patch, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    if (before.status !== "REQUESTED") {
      throw new AppError("INVALID_TRANSITION", `A ${before.status.toLowerCase()} request can no longer be edited`, 422);
    }
    if (!isLeave(patch.kind ?? before.kind)) return base.update(client, { id, patch, actor });

    const merged = { ...before, ...patch };
    const type = await repo.findType(client, merged.leave_type_id);
    const days = await priceRequest(client, merged, type);

    const existing = await repo.overlappingRequests(client, { employeeId: merged.employee_id, exceptId: id });
    const clash = existing.find((r) => rules.overlaps(r, merged));
    if (clash) {
      throw new AppError("LEAVE_OVERLAP", "This overlaps leave already booked for that person", 409, {
        starts_on: [`Overlaps a ${String(clash.status).toLowerCase()} request from ${clash.starts_on} to ${clash.ends_on}.`],
      });
    }
    return base.update(client, { id, patch: { ...patch, days }, actor });
  },

  /**
   * Approve or reject. Approving LEAVE charges the ledger — this is the moment
   * entitlement is actually consumed, and the balance is re-checked here rather
   * than trusted from request time.
   */
  async decide(client, { id, status, actor, viaChain = false }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    // Deciding directly while a chain is live would skip it (W4). Checked before
    // the status guard below so the message names the real reason.
    await assertNoPendingChain(client, ref(id), { viaChain, what: "leave request" });
    if (before.status !== "REQUESTED") {
      // Idempotent: if an approval chain already moved it, don't error.
      if (before.status === status) return before;
      throw new AppError("INVALID_TRANSITION", `Request already ${before.status}`, 422);
    }

    if (status === "APPROVED" && isLeave(before.kind) && before.leave_type_id) {
      await chargeEntitlement(client, before, actor);
    }

    const row = await repo.update(client, id, {
      status,
      // See `adjust` above — decided_by REFERENCES app_user, which is a live
      // table, and this row may be written in sandbox.
      decided_by: await resolveActorId(client, actor.user_id),
      decided_at: new Date().toISOString(),
    });
    await emitEvent(client, { eventTypeKey: events.DECIDED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.DECIDED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    return row;
  },

  /**
   * Give the days back.
   *
   * APPROVED used to be terminal, so an employee whose plans changed left a
   * standing booking that consumed nothing but which everyone had to remember.
   * Cancelling posts the OPPOSITE ledger entry rather than deleting the
   * consumption — the record should show that leave was booked and returned,
   * not pretend it never happened.
   */
  async cancel(client, { id, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    if (!["REQUESTED", "APPROVED"].includes(before.status)) {
      throw new AppError("INVALID_TRANSITION", `A ${before.status.toLowerCase()} request cannot be cancelled`, 422);
    }
    if (before.status === "APPROVED" && isLeave(before.kind) && before.leave_type_id && Number(before.days) > 0) {
      await repo.insertLedger(client, {
        employee_id: before.employee_id,
        leave_type_id: before.leave_type_id,
        period_year: yearOf(before.starts_on),
        kind: "RETURNED",
        days: Number(before.days),
        leave_request_id: id,
        note: "Cancelled after approval",
        created_by: await resolveActorId(client, actor.user_id),
      });
    }
    const row = await repo.update(client, id, { status: "CANCELLED", cancelled_at: new Date().toISOString() });
    await emitEvent(client, { eventTypeKey: events.DECIDED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id || null, action: "leave_allowance.cancelled", moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    return row;
  },
};

/**
 * Check the balance and post the consumption, in that order and in the caller's
 * transaction — so a refusal leaves nothing behind and an approval cannot
 * succeed without the ledger entry that pays for it.
 */
async function chargeEntitlement(client, request, actor) {
  const type = await repo.findType(client, request.leave_type_id);
  if (!type) throw new AppError("NOT_FOUND", "Leave type not found", 404);
  const days = Number(request.days || 0);
  if (!(days > 0)) {
    // A pre-0696 row, or one whose dates were never priced. Priced now rather
    // than charged as zero, which would consume nothing and read as approved.
    throw new AppError("VALIDATION_ERROR", "This request has no day count — reopen and re-save it", 422);
  }
  const year = yearOf(request.starts_on);

  if (!type.allow_negative) {
    const bal = await balance(client, { employeeId: request.employee_id, leaveTypeId: type.leave_type_id, year });
    if (bal.balance < days) {
      throw new AppError(
        "INSUFFICIENT_LEAVE",
        `Not enough ${type.name.toLowerCase()}: ${bal.balance} day(s) available, ${days} requested`,
        422,
        { days: [`${bal.balance} day(s) available for ${year}.`] },
      );
    }
  }

  // Negative: entitlement is being consumed. The sign is the design — see the
  // migration.
  await repo.insertLedger(client, {
    employee_id: request.employee_id,
    leave_type_id: type.leave_type_id,
    period_year: year,
    kind: "TAKEN",
    days: -days,
    leave_request_id: request.leave_request_id,
    created_by: await resolveActorId(client, actor && actor.user_id),
  });
}

// Approval-engine finalize: when a configured leave workflow clears (or is
// rejected), move the request to its terminal state — so the central Approvals
// inbox and the HR leave queue stay in lockstep (single source of truth).
const onApproved = require("../../../services/workflow/on-approved");
onApproved.register("leave_allowance", (client, { id, actor }) => module.exports.decide(client, { id, status: "APPROVED", actor: actor || {}, viaChain: true }));
onApproved.registerReject("leave_allowance", (client, { id, actor }) => module.exports.decide(client, { id, status: "REJECTED", actor: actor || {}, viaChain: true }));
