"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  kpi_target_id: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  period_code: z.string().min(1),
  actual_value: z.number().optional(),
  rating: z.number().optional(),
  comments: z.string().optional(),
});
const reward = z.object({ amount: z.number().nonnegative(), label: z.string().optional() });

/* ── Cycles + reviews (0701) ───────────────────────────────────────────────── */
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD");

const cycle = z
  .object({
    code: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes and underscores only"),
    name: z.string().min(1).max(160),
    starts_on: d,
    ends_on: d,
    // Only the two states a cycle can legitimately be CREATED in. Everything
    // after that is a transition, which is where the guards live.
    status: z.enum(["DRAFT", "OPEN"]).optional(),
  })
  .refine((v) => v.ends_on >= v.starts_on, { path: ["ends_on"], message: "The cycle must not end before it starts." });

const cycleStatus = z.object({
  status: z.enum(["DRAFT", "OPEN", "SCORING", "CALIBRATION", "RELEASED", "CLOSED"]),
});

const reviewOpen = z.object({ employee_id: z.string().uuid() });
const reviewSubmit = z.object({ manager_comment: z.string().max(8000).optional() });

/** The employee's answer. A dispute needs words — the service insists too, but
 *  the message belongs on the field the form is showing. */
const reviewRespond = z
  .object({ agree: z.boolean(), comment: z.string().max(8000).optional() })
  .refine((v) => v.agree || !!(v.comment && v.comment.trim()), {
    path: ["comment"],
    message: "Say why you disagree — this is the part that gets read later.",
  });

const scoreRun = z.object({ employee_id: z.string().uuid().optional() });

const schemas = { create, update: create.partial(), reward, cycle, cycleStatus, reviewOpen, reviewSubmit, reviewRespond, scoreRun };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  reward: mw("reward"),
  cycle: mw("cycle"),
  cycleStatus: mw("cycleStatus"),
  reviewOpen: mw("reviewOpen"),
  reviewSubmit: mw("reviewSubmit"),
  reviewRespond: mw("reviewRespond"),
  scoreRun: mw("scoreRun"),
  schemas,
};
