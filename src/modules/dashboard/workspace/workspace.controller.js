"use strict";
const service = require("./workspace.service");
const identityCache = require("../../../shared/cache/identity-cache");
const { asyncHandler } = require("../../../utils/errors");
const { timezoneOf } = require("./workspace.time");

/** Resolve the identity-side approval context once per request. */
async function viewerOf(req) {
  const user = req.user || { user_id: null };
  return {
    userId: user.user_id || null,
    roleIds: user.role_ids || [],
    isCeo: user.is_ceo === true,
    moduleKeys: user.user_id && user.is_ceo !== true
      ? await req.identityDb((c) => identityCache.getApprovableModules(c, user.role_ids || []))
      : [],
  };
}

module.exports = {
  /**
   * Backward-compatible Workspace facade. New Today panels use their focused
   * endpoints below so approvals and alerts can fail and retry independently.
   */
  mine: asyncHandler(async (req, res) => {
    const user = req.user || { user_id: null };
    const viewer = await viewerOf(req);
    res.json({ data: await req.tenantDb((c) => service.mine(c, user, viewer)) });
  }),

  approvals: asyncHandler(async (req, res) => {
    const user = req.user || { user_id: null };
    const viewer = await viewerOf(req);
    res.json({ data: await req.tenantDb((c) => service.approvals(c, user, viewer)) });
  }),

  alerts: asyncHandler(async (req, res) => {
    const user = req.user || { user_id: null };
    res.json({ data: await req.tenantDb((c) => service.alerts(c, user)) });
  }),

  /**
   * Shared Workspace context. The server owns the tenant workplace timezone;
   * clients use this value for display and wall-clock serialization rather than
   * substituting the browser timezone.
   */
  context: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb(async (c) => ({ timeZone: await timezoneOf(c) })) });
  }),
};
