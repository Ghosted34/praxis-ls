"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/** ISO calendar date. Leave is a calendar fact, never an instant — an accepted
 *  timestamp here would put a timezone between the request and the day count. */
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD");

const KIND = ["leave", "salary_advance", "mission"];

/**
 * `employee_id` and the dates were all optional, and `kind` was any string at
 * all. That allowed a request attached to nobody, with no dates, of a kind
 * nothing understood — unapprovable and uncountable. They are required now, and
 * the service refuses a backwards range with the field named.
 */
const create = z.object({
  employee_id: z.string().uuid(),
  kind: z.enum(KIND).default("leave"),
  // Which entitlement this draws on. Omitted for a salary advance or a mission,
  // and defaulted to ANNUAL by the service for a leave request that omits it.
  leave_type_id: z.string().uuid().optional(),
  starts_on: d.optional(),
  ends_on: d.optional(),
  half_day_start: z.boolean().optional(),
  half_day_end: z.boolean().optional(),
  reason: z.string().max(2000).optional(),
  // The sick note, for types with requires_document.
  document_vault_id: z.string().uuid().optional(),
  amount: z.number().nonnegative().optional(), // salary advance -> 4211 (posting deferred)
  status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "TAKEN"]).optional(),
});

const decision = z.object({ status: z.enum(["APPROVED", "REJECTED"]) });

/* ── Catalogues ─────────────────────────────────────────────────────────────
 *
 * `code` is settable on create and NOT on update: it is what the accrual job
 * and the seeded set resolve types by, so renaming it after the ledger points
 * at it would orphan every entry. The name is freely editable.
 */
const leaveType = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Za-z0-9_]+$/, "Letters, numbers and underscores only"),
  name: z.string().min(1).max(120),
  is_paid: z.boolean().optional(),
  accrual_days_per_month: z.number().nonnegative().max(31).nullable().optional(),
  max_days_per_year: z.number().nonnegative().max(366).nullable().optional(),
  max_carryover_days: z.number().nonnegative().max(366).optional(),
  requires_document: z.boolean().optional(),
  counts_working_days: z.boolean().optional(),
  allow_negative: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

const holiday = z.object({
  holiday_on: d,
  name: z.string().min(1).max(120),
  is_recurring: z.boolean().optional(),
});

/** A correction to someone's balance. Signed — a negative figure takes days
 *  away — and the reason is required by the service, not merely encouraged. */
const adjust = z.object({
  employee_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  days: z.number().refine((n) => n !== 0, "An adjustment of zero days changes nothing"),
  note: z.string().min(1).max(500),
  period_year: z.number().int().min(2000).max(2200).optional(),
});

/** Self-service create — same rules as `create`, but the employee is the
 *  caller (forced in the service), so the body must not name one. */
const mineCreate = create.omit({ employee_id: true });

const schemas = {
  create,
  mineCreate,
  update: create.partial(),
  decision,
  leaveType,
  leaveTypeUpdate: leaveType.partial().omit({ code: true }),
  holiday,
  adjust,
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  mineCreate: mw("mineCreate"),
  update: mw("update"),
  decision: mw("decision"),
  leaveType: mw("leaveType"),
  leaveTypeUpdate: mw("leaveTypeUpdate"),
  holiday: mw("holiday"),
  adjust: mw("adjust"),
  schemas,
};
