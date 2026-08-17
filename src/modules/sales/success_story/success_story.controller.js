"use strict";

const service = require("./success_story.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  eligible: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((client) => service.eligible(client, req.query)),
  })),
  generate: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((client) => service.generate(client, {
      dossierIds: req.body.dossier_ids,
      roughNotes: req.body.rough_notes,
      actor: actor(req),
      env: req.env || "live",
    })),
  })),
  list: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((client) => service.list(client, req.query)),
  })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((client) => service.get(client, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Success story not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => res.status(201).json({
    data: await req.tenantDb((client) => service.create(client, { data: req.body, actor: actor(req) })),
  })),
  update: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((client) => service.update(client, {
      id: req.params.id,
      patch: req.body,
      actor: actor(req),
    })),
  })),
  signOff: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((client) => service.signOff(client, { id: req.params.id, actor: actor(req) })),
  })),
  publish: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((client) => service.publish(client, { id: req.params.id, actor: actor(req) })),
  })),
  unpublish: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((client) => service.unpublish(client, { id: req.params.id, actor: actor(req) })),
  })),
  uploadMedia: asyncHandler(async (req, res) => res.status(201).json({
    data: await req.tenantDb((client) => service.uploadMedia(client, {
      id: req.params.id,
      role: req.body.role,
      dataUrl: req.body.data_url,
      originalName: req.body.original_name,
      slug: req.tenant.slug,
      actor: actor(req),
    })),
  })),
  removeMedia: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((client) => service.removeMedia(client, {
      id: req.params.id,
      documentId: req.params.documentId,
      actor: actor(req),
    })),
  })),
};
