"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./training.service");

const actor = (req) => req.user || { user_id: null };
const base = makeController(service, "Training");

/** The tenant slug the vault keys its object storage on. Same shape every other
 *  vault-writing controller uses. */
const slug = (req) => (req.tenant && req.tenant.slug) || null;

module.exports = {
  ...base,
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Training not found", 404);
    res.json({ data: row });
  }),
  setStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Training not found", 404);
    res.json({ data: row });
  }),

  /* ── Roster ─────────────────────────────────────────────────────────── */
  listAttendees: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.listAttendees(c, req.params.id)) });
  }),
  addAttendee: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.addAttendee(c, { trainingId: req.params.id, data: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Training not found", 404);
    res.status(201).json({ data: row });
  }),
  updateAttendee: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.updateAttendee(c, { trainingId: req.params.id, attendeeId: req.params.attendeeId, patch: req.body, actor: actor(req) }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Attendee not found", 404);
    res.json({ data: row });
  }),

  /* ── Live session ───────────────────────────────────────────────────── */
  join: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.join(c, { trainingId: req.params.id, employeeId: req.body.employee_id, actor: actor(req) })) });
  }),
  leave: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.leave(c, { trainingId: req.params.id, employeeId: req.body.employee_id, actor: actor(req) })) });
  }),
  addNote: asyncHandler(async (req, res) => {
    res.status(201).json({
      data: await req.tenantDb((c) => service.addNote(c, { trainingId: req.params.id, body: req.body.body, isMinutes: req.body.is_minutes, actor: actor(req) })),
    });
  }),
  summarise: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.summarise(c, { id: req.params.id, slug: slug(req), actor: actor(req) })) });
  }),

  /* ── Requirements ───────────────────────────────────────────────────── */
  listRequirements: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.listRequirements(c, req.query)) });
  }),
  createRequirement: asyncHandler(async (req, res) => {
    res.status(201).json({ data: await req.tenantDb((c) => service.createRequirement(c, { data: req.body, actor: actor(req) })) });
  }),
  updateRequirement: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.updateRequirement(c, { id: req.params.requirementId, patch: req.body, actor: actor(req) })) });
  }),
  compliance: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.compliance(c, req.params.requirementId)) });
  }),
  expiringCertificates: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.expiringCertificates(c, { days: req.query.days })) });
  }),
};
