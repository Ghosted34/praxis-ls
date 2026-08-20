"use strict";
const service = require("./signature.service");
const { asyncHandler } = require("../../../utils/errors");

const actor = (req) => req.user || { user_id: null };

module.exports = {
  me: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.getOwnProfile(c, actor(req).user_id)),
  })),
  saveMe: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.saveOwnProfile(c, actor(req).user_id, req.body || {}, actor(req))),
  })),
  preview: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.resolveFor(c, {
      userId: actor(req).user_id,
      language: req.query.lang || req.query.language,
      connectionId: req.query.connection_id || null,
    })),
  })),
  png: asyncHandler(async (req, res) => {
    const scale = Number(req.query.scale || req.body.scale || 1);
    const language = req.query.lang || req.body.language || "en";
    const png = await req.identityDb((c) => service.renderPng(c, {
      userId: actor(req).user_id, language, scale,
    }));
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="signature-${scale}x.png"`);
    return res.send(png.buffer);
  }),
  templates: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.listTemplates(c, { includeInactive: req.query.include_inactive === "true" })),
  })),
  updateTemplate: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.updateTemplate(c, req.params.id, req.body || {}, actor(req))),
  })),
};
