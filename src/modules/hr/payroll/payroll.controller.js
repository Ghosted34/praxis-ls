/** Payroll (MOD-17) HTTP handlers — thin: req.tenantDb → service. */
"use strict";
const service = require("./payroll.service");
const advances = require("./salary_advance.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  mine: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.myPayslips(c, req.user.employee_id)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Payroll run not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createRun(c, { data: req.body, actor: actor(req) })) })),
  compute: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.compute(c, { id: req.params.id, config: req.body?.config || null, actor: actor(req) })) })),
  setStatus: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) })) })),

  /* ── Salary advances (0698) ── */
  listAdvances: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => advances.list(c, req.query)) })),
  // The caller's own — "what do I still owe?" is theirs to know without a grant
  // over everybody else's advances.
  myAdvances: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => advances.mine(c, req.user.employee_id)) })),
  getAdvance: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => advances.get(c, req.params.advanceId));
    if (!row) throw new AppError("NOT_FOUND", "Advance not found", 404);
    res.json({ data: row });
  }),
  createAdvance: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => advances.create(c, { data: req.body, actor: actor(req) })) })),
  updateAdvance: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => advances.update(c, { id: req.params.advanceId, patch: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Advance not found", 404);
    res.json({ data: row });
  }),
};
