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
  // NAMED, deliberately (API-F23 / SEC-L5). This returned an anonymous function,
  // so `GET /portal/me`, `/client`, `/investor` and `/auditor` appeared in the
  // route stack as `<anonymous>, <anonymous>` — indistinguishable from an
  // unauthenticated route. Every tool that reads the mounted routers to ask
  // "what is reachable without credentials?" therefore reported the entire
  // external portal surface as PUBLIC. It is not: this middleware verifies the
  // portal token, loads the user, and checks the portal grant.
  //
  // The name is the only thing that made it legible. That is a thin thread to
  // hang a security inventory on, which is exactly TC-Q6's complaint about
  // matching middleware by name — but until the tooling matches by reference,
  // an anonymous auth middleware is an auth middleware nothing can see.
  return async function portalAuthCheck(req, _res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) throw new AppError("AUTH_REQUIRED", "Portal authorization required", 401);
    const payload = service.verifyToken(header.slice("Bearer ".length).trim());

    const { user, sessionLive } = await req.identityDb(async (c) => ({
      user: await service.getById(c, payload.sub),
      // A token minted for a trusted-device session dies with the session: "sign
      // out that phone" must take effect now, not when the access token expires.
      sessionLive: payload.sid ? await service.sessionIsLive(c, payload.sid) : true,
    }));
    if (!user || user.status !== "ACTIVE") throw new AppError("PORTAL_USER_INACTIVE", "Portal user not found or disabled", 401);
    if (!sessionLive) throw new AppError("SESSION_EXPIRED", "Your session has ended. Sign in again.", 401);

    // `token` carries `iat` (passkey enrolment needs a FRESH sign-in) and `sid`
    // (which device this is, for "signed-in devices").
    req.portal = { user, portal: portalType, clientId: null, grant: null, scope: "ALL", token: payload };

    if (portalType) {
      const { allowed, grant } = await req.tenantDb((c) => portal.checkAccess(c, { email: user.email, portal: portalType }));
      if (!allowed) throw new AppError("PORTAL_FORBIDDEN", `No active ${portalType} access for this user`, 403);
      req.portal.clientId = grant ? grant.client_id : null;
      req.portal.grant = grant;
      req.portal.scope = (grant && grant.access_scope) || "ALL";
    }
    return next();
  };
}

/**
 * The client team's access scope (14150), checked AFTER portalAuth("CLIENT").
 *
 *   ALL         everything a client portal shows
 *   OPERATIONS  shipments, documents, requests — no money
 *   BILLING     invoices, payments, proformas — no shipment detail
 *
 * A route declares the area it belongs to; ALL passes everywhere. The home
 * summary is deliberately NOT gated: it is assembled per scope instead, so a
 * finance colleague opening the portal sees their half rather than a 403.
 */
function portalScope(area) {
  return function portalScopeCheck(req, _res, next) {
    const scope = (req.portal && req.portal.scope) || "ALL";
    if (scope === "ALL" || scope === area) return next();
    throw new AppError("PORTAL_SCOPE", "Your access does not include this part of the portal", 403);
  };
}

/** Only a client admin may manage the client's own team. */
function portalClientAdmin(req, _res, next) {
  if (req.portal && req.portal.grant && req.portal.grant.is_client_admin === true) return next();
  throw new AppError("PORTAL_ADMIN_REQUIRED", "Only your company's portal admin can do this", 403);
}

module.exports = { portalAuth, portalScope, portalClientAdmin };
