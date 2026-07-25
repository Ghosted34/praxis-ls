"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./attendance.service");

const base = makeController(service, "Attendance");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,

  // ── Self-service time clock ──
  clockIn: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockIn(c, { ...req.body, actor: actor(req) }));
    res.status(201).json({ data: row });
  }),
  clockOut: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockOut(c, { ...req.body, actor: actor(req) }));
    res.json({ data: row });
  }),
  open: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.open(c, { employeeId: req.query.employee_id || null, actor: actor(req) }));
    res.json({ data: row });
  }),

  // Manager view: who hasn't clocked in on a given day.
  absence: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.absence(c, { date: req.query.date || null })) });
  }),

  // ── Worksites (geofence centres) ──
  listSites: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSites(c)) })),
  createSite: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createSite(c, { data: req.body, actor: actor(req) })) })),
  updateSite: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.updateSite(c, { id: req.params.siteId, patch: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Worksite not found", 404);
    res.json({ data: row });
  }),

  // Admin clock-out on a specific row (kept for corrections).
  clockOutById: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockOut(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Attendance not found", 404);
    res.json({ data: row });
  }),
};
