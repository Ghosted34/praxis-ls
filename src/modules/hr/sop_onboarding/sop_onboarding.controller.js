"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const ruleService = require("./hr_rule.service");

const service = require("./sop_onboarding.service");
const base = makeController(service, "SOP");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,

  /* ── House rules (0697) — the clauses the system enforces ── */
  listRules: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => ruleService.list(c, req.query)) })),
  getRule: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => ruleService.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Rule not found", 404);
    res.json({ data: row });
  }),
  createRule: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => ruleService.create(c, { data: req.body, actor: actor(req) })) })),
  updateRule: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => ruleService.update(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Rule not found", 404);
    res.json({ data: row });
  }),
  archiveRule: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => ruleService.archive(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Rule not found", 404);
    res.json({ data: row });
  }),

  /** Draft the procedure's text from the company's own input (0704). */
  draft: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.draft(c, { id: req.params.id, input: req.body, actor: actor(req) })) })),

  /** Render it to a real PDF and file it. Refuses on an empty body — see the
   *  service; a blank procedure that looks correct is worse than none. */
  renderPdf: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.renderPdf(c, { id: req.params.id, actor: actor(req) })) })),
};
