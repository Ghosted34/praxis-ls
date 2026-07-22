/**
 * portalAuth(portalType) — guards the external portal routes.
 *   1. verify the portal token,
 *   2. load the portal_user from identity (must be ACTIVE),
 *   3. re-check the portal_access grant for this email + portal (so a revoked or
 *      expired grant is refused immediately — the token alone grants nothing),
 *   4. attach req.portal = { user, portal, clientId, grant }.
 * Call with no argument to require only a signed-in portal user (e.g. /portal/me).
 */
"use strict";

const service = require("./portal_auth.service");
const portal = require("../portal/portal.service");
const { AppError } = require("../../utils/errors");

function portalAuth(portalType = null) {
  return async function (req, _res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) throw new AppError("AUTH_REQUIRED", "Portal authorization required", 401);
    const payload = service.verifyToken(header.slice("Bearer ".length).trim());

    const user = await req.identityDb((c) => service.getById(c, payload.sub));
    if (!user || user.status !== "ACTIVE") throw new AppError("PORTAL_USER_INACTIVE", "Portal user not found or disabled", 401);

    req.portal = { user, portal: portalType, clientId: null, grant: null };

    if (portalType) {
      const { allowed, grant } = await req.tenantDb((c) => portal.checkAccess(c, { email: user.email, portal: portalType }));
      if (!allowed) throw new AppError("PORTAL_FORBIDDEN", `No active ${portalType} access for this user`, 403);
      req.portal.clientId = grant ? grant.client_id : null;
      req.portal.grant = grant;
    }
    return next();
  };
}

module.exports = { portalAuth };
