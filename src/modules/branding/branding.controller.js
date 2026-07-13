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

  // Gated (see routes) — upserts only the provided appearance fields. The
  // service picks the known token fields out of the body (unknown keys are
  // ignored), so the full appearance token set flows through here.
  put: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) =>
      service.setBranding(c, { ...(req.body || {}), actorId: req.user.user_id }),
    );
    res.json({ data });
  }),

  // Gated — stores an uploaded logo (base64 data URL) via the file storage
  // service and returns its /media URL. Client then sets it and saves.
  uploadLogo: asyncHandler(async (req, res) => {
    const data = await service.uploadLogo({ dataUrl: req.body.dataUrl, slug: req.tenant.slug });
    res.json({ data });
  }),

  // Login screen editor (3.2). GET is PUBLIC (the login page reads it pre-auth);
  // PUT + background upload are gated (see routes).
  getLogin: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.getLogin(c)) });
  }),
  putLogin: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.setLogin(c, { ...(req.body || {}), actorId: req.user.user_id }));
    res.json({ data });
  }),
  uploadLoginBackground: asyncHandler(async (req, res) => {
    const data = await service.uploadLoginBackground({ dataUrl: req.body.dataUrl, slug: req.tenant.slug });
    res.json({ data });
  }),
};
