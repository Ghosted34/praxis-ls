"use strict";
const service = require("./meeting.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Meeting not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  addNote: asyncHandler(async (req, res) => { const b = req.body; res.status(201).json({ data: await req.tenantDb((c) => service.addNote(c, { meetingId: req.params.id, body: b.body, isMinutes: b.is_minutes, actor: actor(req) })) }); }),
};
