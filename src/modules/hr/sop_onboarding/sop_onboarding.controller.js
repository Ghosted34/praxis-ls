"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const ruleService = require("./hr_rule.service");

const base = makeController(require("./sop_onboarding.service"), "SOP");
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
};
