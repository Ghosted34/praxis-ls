"use strict";
const { asyncHandler } = require("../../utils/errors");
const service = require("./branding.service");

module.exports = {
  // Public — no auth. Falls the display name back to the tenant slug so the
  // login always has *something* to show even before appearance is configured.
  get: asyncHandler(async (req, res) => {
    const b = await req.tenantDb((c) => service.getBranding(c));
    res.json({ data: { ...b, name: b.name || req.tenant.slug } });
  }),

  // Gated (see routes) — upserts only the provided appearance fields.
  put: asyncHandler(async (req, res) => {
    const { primary, primaryForeground, logoUrl, name } = req.body || {};
    const data = await req.tenantDb((c) =>
      service.setBranding(c, { primary, primaryForeground, logoUrl, name, actorId: req.user.user_id }),
    );
    res.json({ data });
  }),

  // Gated — stores an uploaded logo (base64 data URL) via the file storage
  // service and returns its /media URL. Client then sets it and saves.
  uploadLogo: asyncHandler(async (req, res) => {
    const data = await service.uploadLogo({ dataUrl: req.body.dataUrl, slug: req.tenant.slug });
    res.json({ data });
  }),
};
