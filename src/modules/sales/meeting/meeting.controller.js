"use strict";
const service = require("./meeting.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Meeting not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  addNote: asyncHandler(async (req, res) => { const b = req.body; res.status(201).json({ data: await req.tenantDb((c) => service.addNote(c, { meetingId: req.params.id, body: b.body, isMinutes: b.is_minutes, actor: actor(req) })) }); }),

  discovery: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.discovery(c, req.params.id)) })),
  saveSection: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.saveSection(c, { meetingId: req.params.id, sectionKey: req.params.sectionKey, body: req.body.body ?? null, actor: actor(req) })),
  })),
  // 202: the transcript is not here yet, and saying 200 would invite the client
  // to read `body` back and find it unchanged.
  dictate: asyncHandler(async (req, res) => res.status(202).json({
    data: await req.tenantDb((c) => service.startDictation(c, {
      meetingId: req.params.id, sectionKey: req.params.sectionKey, audioDataUrl: req.body.audio,
      tenantMeta: req.tenant, env: req.env || "live", actor: actor(req),
    })),
  })),
  latestForLead: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.latestDiscoveryFor(c, { leadId: req.params.leadId })) })),
  latestForClient: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.latestDiscoveryFor(c, { clientId: req.params.clientId })) })),

  listPrompts: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listPrompts(c, req.query)) })),
  createPrompt: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createPrompt(c, { data: req.body, actor: actor(req) })) })),
  updatePrompt: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updatePrompt(c, { id: req.params.promptId, patch: req.body, actor: actor(req) })) })),
};
