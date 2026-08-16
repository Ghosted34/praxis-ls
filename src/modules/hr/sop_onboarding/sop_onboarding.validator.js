"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  vault_id: z.string().uuid().optional(),
  version_no: z.number().int().positive().optional(),
  is_active: z.boolean().optional(),
});

/* ── House rules (0697) ─────────────────────────────────────────────────────
 *
 * A rule is what turns a clause in the handbook into a deduction on a payslip,
 * so the shape is checked strictly: a tier list with a bad percentage in it
 * would silently charge 0% forever, and a rule that charges money with no
 * figure is worse than no rule at all.
 */
const tier = z.object({
  after_minutes: z.number().int().min(0).max(24 * 60),
  deduction_pct: z.number().min(0).max(100),
});

const KINDS = ["LATENESS", "ABSENCE", "REWARD", "CONDUCT"];
const EFFECTS = ["DEDUCT_PCT_DAY", "DEDUCT_FIXED", "BONUS_FIXED", "BONUS_PCT_SALARY", "SALARY_INCREASE_PCT", "QUERY_ONLY"];

const ruleShape = {
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  kind: z.enum(KINDS),
  metric: z.string().max(60).optional().nullable(),
  comparator: z.enum(["gte", "lte"]).optional().nullable(),
  threshold: z.number().optional().nullable(),
  tiers: z.array(tier).max(12).optional(),
  effect: z.enum(EFFECTS).optional(),
  effect_value: z.number().min(0).optional().nullable(),
  auto_query: z.boolean().optional(),
  query_severity: z.enum(["INFO", "WARNING", "SERIOUS"]).optional(),
  query_due_days: z.number().int().min(0).max(30).optional(),
  // The clause this enforces — nullable, because a tenant may configure the
  // rule before writing the document.
  sop_document_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
};

/** An effect that moves money needs a figure to move. Checked here rather than
 *  in the service so the message lands on the field the form is showing. */
const needsValue = new Set(["DEDUCT_FIXED", "BONUS_FIXED", "BONUS_PCT_SALARY", "SALARY_INCREASE_PCT"]);
const withValueCheck = (schema) =>
  schema.refine(
    (v) => !needsValue.has(v.effect) || (v.effect_value !== null && v.effect_value !== undefined && v.effect_value > 0),
    { path: ["effect_value"], message: "This effect needs an amount or a percentage above zero." },
  );

const rule = withValueCheck(z.object({ ...ruleShape, code: z.string().min(1).max(40).regex(/^[A-Za-z0-9_]+$/, "Letters, numbers and underscores only") }));
// `code` is omitted from the patch: attendance cites rules by id and resolves
// them by kind, and a renamed code orphans the days already charged under it.
const ruleUpdate = withValueCheck(z.object(ruleShape).partial());

const schemas = { create, update: create.partial(), rule, ruleUpdate };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  rule: mw("rule"),
  ruleUpdate: mw("ruleUpdate"),
  schemas,
};
