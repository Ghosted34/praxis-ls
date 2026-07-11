"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./training.service");

const actor = (req) => req.user || { user_id: null };
const base = makeController(service, "Training");

module.exports = {
  ...base,
  setStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Training not found", 404);
    res.json({ data: row });
  }),
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
};
