"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./leave_allowance.service");

const base = makeController(service, "Leave request");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,

  mine: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    return res.json({ data: await req.tenantDb((c) => service.list(c, { employee_id: eid })) });
  }),

  /** The caller's own balances — what My HR shows before anyone asks for leave.
   *  No MOD grant: an employee is always entitled to see their own figure. */
  myBalances: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    return res.json({
      data: await req.tenantDb((c) => service.balances(c, { employeeId: eid, year: req.query.year ? Number(req.query.year) : null })),
    });
  }),

  decide: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.decide(c, { id: req.params.id, status: req.body.status, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Leave request not found", 404);
    res.json({ data: row });
  }),

  cancel: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.cancel(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Leave request not found", 404);
    res.json({ data: row });
  }),

  /* ── Balances ───────────────────────────────────────────────────────────── */

  balances: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.balances(c, {
        employeeId: req.params.employeeId,
        year: req.query.year ? Number(req.query.year) : null,
      })),
    })),

  ledger: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.ledger(c, {
        employeeId: req.params.employeeId,
        leaveTypeId: req.query.leave_type_id || null,
        year: req.query.year ? Number(req.query.year) : null,
      })),
    })),

  adjust: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) => service.adjust(c, {
        employeeId: req.body.employee_id,
        leaveTypeId: req.body.leave_type_id,
        days: req.body.days,
        note: req.body.note,
        year: req.body.period_year || null,
        actor: actor(req),
      })),
    })),

  /* ── Catalogues ─────────────────────────────────────────────────────────── */

  listTypes: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listTypes(c, req.query)) })),
  createType: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.createType(c, { data: req.body, actor: actor(req) })) })),
  updateType: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.updateType(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Leave type not found", 404);
    res.json({ data: row });
  }),

  listHolidays: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listHolidays(c, req.query)) })),
  addHoliday: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.addHoliday(c, { data: req.body, actor: actor(req) })) })),
  removeHoliday: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.removeHoliday(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Holiday not found", 404);
    res.json({ data: row });
  }),
};
