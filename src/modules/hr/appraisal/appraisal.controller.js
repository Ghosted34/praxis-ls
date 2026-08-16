"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./appraisal.service");
const review = require("./appraisal.review");
const { AppError } = require("../../../utils/errors");

const base = makeController(service, "Appraisal");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,
  // Self-service: the caller's own appraisals (My HR). Guarded so a user with no
  // linked employee never falls through to an unfiltered list.
  mine: asyncHandler(async (req, res) => {
    const employeeId = req.user.employee_id;
    if (!employeeId) return res.json({ data: [] });
    return res.json({ data: await req.tenantDb((c) => service.list(c, { employee_id: employeeId })) });
  }),
  /* ── Cycles (0701) ── */
  listCycles: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => review.listCycles(c)) })),
  createCycle: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => review.createCycle(c, { data: req.body, actor: actor(req) })) })),
  setCycleStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => review.setCycleStatus(c, { id: req.params.cycleId, status: req.body.status, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Cycle not found", 404);
    res.json({ data: row });
  }),

  /**
   * Score a cycle from the evidence the system already holds.
   *
   * Without `employee_id` it walks every active employee — which is the normal
   * way to use it, because the point is that a manager starts from evidence
   * rather than a blank grid. Calibrated rows are never touched.
   */
  scoreCycle: asyncHandler(async (req, res) => {
    const cycleId = req.params.cycleId;
    const one = req.body.employee_id;
    const out = await req.tenantDb(async (c) => {
      const ids = one
        ? [one]
        : (await c.query("SELECT employee_id FROM employee WHERE is_active ORDER BY employee_id")).rows.map((r) => r.employee_id);
      const totals = { employees: 0, scored: 0, skipped: 0 };
      for (const id of ids) {
        const r = await review.scoreEmployee(c, { cycleId, employeeId: id, actor: actor(req) });
        totals.employees += 1;
        totals.scored += r.scored;
        totals.skipped += r.skipped;
      }
      return totals;
    });
    res.json({ data: out });
  }),

  /* ── Reviews ── */
  listReviews: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => review.listReviews(c, req.query)) })),
  getReview: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => review.getReview(c, req.params.reviewId));
    if (!row) throw new AppError("NOT_FOUND", "Review not found", 404);
    res.json({ data: row });
  }),
  openReview: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) => review.upsertReview(c, { cycleId: req.params.cycleId, employeeId: req.body.employee_id, actor: actor(req) })),
    })),
  submitReview: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => review.submitReview(c, { id: req.params.reviewId, managerComment: req.body.manager_comment ?? null, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Review not found", 404);
    res.json({ data: row });
  }),

  /**
   * Draft the narrative.
   *
   * Three short db calls around a model call rather than one long one: the
   * model takes seconds and this deployment runs a 12-connection-per-tenant
   * ceiling — holding a pooled connection across it is how one slow provider
   * takes the tenant's whole pool.
   */
  narrateReview: asyncHandler(async (req, res) => {
    const id = req.params.reviewId;
    const ctx = await req.tenantDb(async (c) => ({
      row: await review.getReview(c, id),
      sopTitles: (await c.query("SELECT title FROM sop_document WHERE is_active ORDER BY title LIMIT 12")).rows.map((r) => r.title),
    }));
    if (!ctx.row) throw new AppError("NOT_FOUND", "Review not found", 404);
    const written = await req.tenantDb((c) => review.narrate(c, { review: ctx.row, sopTitles: ctx.sopTitles }));
    const saved = await req.tenantDb((c) => review.saveNarrative(c, { id, ...written }));
    res.json({ data: saved });
  }),

  /** The caller's own reviews, and their answer to one. */
  myReviews: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => review.mine(c, req.user.employee_id)) })),
  respondToReview: asyncHandler(async (req, res) => {
    const employeeId = req.user.employee_id;
    if (!employeeId) throw new AppError("NOT_FOUND", "Review not found", 404);
    const row = await req.tenantDb((c) => review.respond(c, {
      id: req.params.reviewId, agree: req.body.agree, comment: req.body.comment ?? null,
      employeeId, actor: actor(req),
    }));
    if (!row) throw new AppError("NOT_FOUND", "Review not found", 404);
    res.json({ data: row });
  }),

  // Recommend a performance reward (→ a PENDING payroll earning).
  reward: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.recommendReward(c, { id: req.params.id, amount: req.body.amount, label: req.body.label || null, actor: actor(req) }));
    res.status(201).json({ data: row });
  }),
};
