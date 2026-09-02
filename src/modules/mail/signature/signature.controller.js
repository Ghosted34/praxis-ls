"use strict";
const service = require("./signature.service");
const diagnostics = require("./signature.diagnose");
const { asyncHandler } = require("../../../utils/errors");
const { readPermissions } = require("../../../middleware/rbac");

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
  card: asyncHandler(async (req, res) => {
    // Which gaps get a LINK rather than an "ask an administrator" note. Read,
    // never enforced — the destination screens do their own gating. See
    // readPermissions in middleware/rbac.js.
    const [hr, entity, brand, template] = await readPermissions(req, [
      ["MOD-02", "edit"],   // staff records — name, title, email
      ["MOD-01", "edit"],   // corporate entity — address, P.O. Box, website
      ["MOD-70", "edit"],   // branding and signature templates
      ["MOD-70", "edit"],
    ]);
    return res.json({
      data: await req.identityDb((c) => service.cardPreview(c, {
        userId: actor(req).user_id,
        language: req.query.lang || req.query.language || "en",
        can: { hr, entity, brand, template },
      })),
    });
  }),
  // "Why is my card not showing?" — runs the whole chain and names the first
  // broken step. See signature.diagnose.js for why this earns a route.
  diagnose: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => diagnostics.diagnose(c, {
      userId: actor(req).user_id,
      write: req.query.write === "true",
    })),
  })),
  staff: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.listStaff(c, {
      search: req.query.q || null,
      limit: req.query.limit,
    })),
  })),
  batch: asyncHandler(async (req, res) => {
    const { user_ids: userIds, language = "en", scale = 2 } = req.body || {};
    const out = await req.identityDb((c) => service.renderBatch(c, { userIds, language, scale }));
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="signatures-${stamp}.zip"`);
    // The caller cannot see a JSON body on a binary download, so the count and
    // any per-person failures ride in headers rather than being lost.
    res.setHeader("X-Signature-Count", String(out.count));
    if (out.skipped.length) res.setHeader("X-Signature-Skipped", String(out.skipped.length));
    return res.send(out.buffer);
  }),
  templates: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.listTemplates(c, { includeInactive: req.query.include_inactive === "true" })),
  })),
  updateTemplate: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.updateTemplate(c, req.params.id, req.body || {}, actor(req))),
  })),
};
