"use strict";
const service = require("./workspace.service");
const identityCache = require("../../../shared/cache/identity-cache");
const { asyncHandler } = require("../../../utils/errors");

module.exports = {
  mine: asyncHandler(async (req, res) => {
    const user = req.user || { user_id: null };
    // Which modules this caller may approve — identity data, so resolved on the
    // identity client like grants. Feeds the "Awaiting me" filter so the panel
    // shows their queue rather than the tenant's.
    const viewer = {
      roleIds: user.role_ids || [],
      isCeo: user.is_ceo === true,
      moduleKeys: user.user_id && user.is_ceo !== true
        ? await req.identityDb((c) => identityCache.getApprovableModules(c, user.role_ids || []))
        : [],
    };
    res.json({ data: await req.tenantDb((c) => service.mine(c, user, viewer)) });
  }),
};
