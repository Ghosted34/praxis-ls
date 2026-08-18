"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const OWNER_TIER = z.enum(["INTERNAL", "CARRIER", "TERMINAL", "AUTHORITY", "CLIENT"]);
const CADENCE = z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"]);

const stage = z.object({
  stage_seq: z.number().optional(),
  code: z.string().min(1),
  label_fr: z.string().min(1),
  label_en: z.string().optional(),
  default_offset_days: z.number().int().optional(),
  // The scheduling half. Weight is a share of the chain's horizon, so it is
  // bounded at 100 per stage; min_duration_hours is the compression floor that
  // stops a locked SLA from generating a physically impossible schedule.
  weight: z.number().int().min(0).max(100).optional(),
  min_duration_hours: z.number().int().min(0).max(2000).optional(),
  owner_tier: OWNER_TIER.optional(),
  is_anchor: z.boolean().optional(),
  is_target_lock: z.boolean().optional(),
  is_client_visible: z.boolean().optional(),
  is_optional: z.boolean().optional(),
  chain_segment: z.string().max(32).optional(),
  cadence: CADENCE.optional(),
  required_evidence_doc_type: z.string().max(64).optional(),
  auto_advance_on_event: z.string().max(120).optional(),
});

/**
 * 3..15 stages. The ceiling is also a DB trigger (0650) — this exists so the
 * user gets a named error instead of a check_violation, and so the floor is
 * enforced at all: stages arrive one INSERT at a time, so a minimum cannot be a
 * row-level DB constraint.
 */
const publishTemplate = z.object({
  service_type_id: z.string().uuid(),
  stages: z.array(stage).min(3, "a template needs at least 3 stages").max(15, "a template cannot exceed 15 stages"),
});

const instantiate = z.object({
  dossier_id: z.string().uuid(),
  service_type_id: z.string().uuid(),
  base_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const advance = z.object({
  to: z.enum(["IN_PROGRESS", "DONE", "BLOCKED", "PENDING"]),
  evidence_vault_id: z.string().uuid().optional(),
  // Force majeure. Recorded alongside the measured variance, never instead of
  // it, so an excused delay is still a delay in the numbers.
  cause_reason_code: z.string().max(64).optional(),
  cause_note: z.string().max(500).optional(),
});

/** Reopening a completed stage is governed: the reason is the whole point. */
const reopen = z.object({ reason: z.string().min(3).max(500) });

const addStage = z.object({
  after_seq: z.number().min(0),
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  label_en: z.string().max(200).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  min_duration_hours: z.number().int().min(0).max(2000).optional(),
  owner_tier: OWNER_TIER.optional(),
  is_client_visible: z.boolean().optional(),
});

/**
 * The published assumptions register. `text_fr` is required and `text_en`
 * optional because the client-facing rendering is French-first in this market;
 * both are shown when present.
 */
const assumption = z.object({
  code: z.string().min(1).max(64),
  text_fr: z.string().min(1).max(1000),
  text_en: z.string().max(1000).optional(),
  is_client_visible: z.boolean().optional(),
});
const saveAssumptions = z.object({ assumptions: z.array(assumption).max(40) });

const recalculate = z.object({ trigger: z.enum(["MANUAL", "TARGET_CHANGED"]).optional() });

// F14: these are intentionally separate from operational cause/health fields.
// Empty strings are accepted so staff can clear previously published copy.
const publicDetails = z.object({
  public_location: z.string().max(200).nullable().optional(),
  public_stage_reference: z.string().max(120).nullable().optional(),
  public_progress_note: z.string().max(1000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "at least one public field is required");

const schemas = { publishTemplate, instantiate, advance, reopen, addStage, recalculate, saveAssumptions, publicDetails };
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = {
  publishTemplate: mw("publishTemplate"),
  instantiate: mw("instantiate"),
  advance: mw("advance"),
  reopen: mw("reopen"),
  addStage: mw("addStage"),
  recalculate: mw("recalculate"),
  saveAssumptions: mw("saveAssumptions"),
  publicDetails: mw("publicDetails"),
  schemas,
};
