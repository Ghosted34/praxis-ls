/**
 * Per-user preference handlers.
 *
 * ALWAYS req.identityDb, NEVER req.tenantDb. Preferences live in the live
 * (identity) schema alongside app_user — see 0496. Using the env-scoped handle
 * would store a user's fonts twice, once per environment, and the sandbox copy
 * would be destroyed on every `DROP SCHEMA sandbox CASCADE` wipe. Branding gets
 * a live-base/sandbox-override overlay because trying a palette against test
 * data is a real use case; a personal font is the same person's preference in
 * both environments, so there is nothing to overlay.
 */
"use strict";
const { asyncHandler } = require("../../utils/errors");
const service = require("./preference.service");

module.exports = {
  getAppearance: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) => service.getAppearance(c, req.user.user_id));
    res.json({ data });
  }),

  putAppearance: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) =>
      service.setAppearance(c, { userId: req.user.user_id, ...req.body }),
    );
    res.json({ data });
  }),

  resetAppearance: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) => service.resetAppearance(c, req.user.user_id));
    res.json({ data });
  }),

  getShell: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) => service.getShell(c, req.user.user_id));
    res.json({ data });
  }),

  putShell: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) => service.setShell(c, { userId: req.user.user_id, ...req.body }));
    res.json({ data });
  }),
};
