/**
 * Platform (company dashboard) auth + authorisation. Bearer JWT signed with
 * JWT_ACCESS_SECRET carrying { sub, typ:'platform' }. Loads platform_user and
 * attaches req.platformUser. Platform users NEVER get tenant business access.
 */
"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");
const platformDb = require("../services/platform/db");

async function platformAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    throw new AppError("AUTH_REQUIRED", "Authorization header missing", 401);
  }
  let payload;
  try {
    payload = jwt.verify(header.slice(7).trim(), config.JWT_ACCESS_SECRET);
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    throw new AppError(
      expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      expired ? "Access token expired" : "Invalid token",
      401,
    );
  }
  if (payload.typ !== "platform") {
    throw new AppError("WRONG_AUDIENCE", "Not a platform token", 401);
  }
  const { rows } = await platformDb.query(
    "SELECT platform_user_id, email, full_name, role, is_active FROM platform.platform_user WHERE platform_user_id=$1",
    [payload.sub],
  );
  const u = rows[0];
  if (!u || !u.is_active) {
    throw new AppError("USER_INACTIVE", "Platform user not found or inactive", 401);
  }
  req.platformUser = u;
  // Load the role's capability set (the permission matrix). Root Admin bypasses
  // checks in requireCap, so its stored caps are only for display.
  const caps = await platformDb.query(
    `SELECT rp.capability FROM platform.platform_role r
       JOIN platform.platform_role_permission rp ON rp.role_id = r.role_id
      WHERE r.code = $1`,
    [u.role],
  );
  req.platformCaps = new Set(caps.rows.map((r) => r.capability));
  return next();
}

function requirePlatformRole(...roles) {
  const allowed = new Set(roles.length ? roles : ["PLATFORM_ROOT_ADMIN"]);
  // `platformRoleCheck`, not `check` (API-F23 / SEC-L5). Both gates here
  // returned a function called `check`, which is too generic for any tool
  // reading the mounted routers to recognise as an authorisation step — so
  // every platform-console route, including tenant deletion, was classified as
  // "authenticated with no permission check". The name is what makes the gate
  // legible to the contract snapshot and to the CI tier check.
  return function platformRoleCheck(req, _res, next) {
    if (!req.platformUser) {
      throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    }
    if (!allowed.has(req.platformUser.role)) {
      throw new AppError("FORBIDDEN", `Requires role: ${[...allowed].join(", ")}`, 403);
    }
    return next();
  };
}

// The full catalogue of platform capabilities the permission matrix toggles.
// Single source of truth; the console mirrors this list to render the matrix.
const CAP_CATALOGUE = [
  "tenants.read", "tenants.write", "features.write",
  "plans.read", "plans.write",
  "users.read", "users.write",
  "roles.read", "roles.write",
  "support.read", "support.write",
  "audit.read", "catalogue.read",
  // Deploy-wide credential store: S3, Geoapify, VAPID and the AI vendor keys
  // (audit SEC-H2 / API F-20, 2026-08-04). Added with migration 0032, which
  // grants them to PLATFORM_ROOT_ADMIN only. Highest-privilege capability in
  // the catalogue — anything holding settings.write can rotate the credentials
  // the whole deployment runs on.
  "settings.read", "settings.write",
  // Error Command Center (migration 0080). Split three ways deliberately:
  // reading stack traces, resolving an error, and arming an escalation rule
  // that pages people are different levels of trust. `errors.read` is the
  // sensitive one — raw traces and error context are the most revealing
  // non-credential data the platform stores.
  "errors.read", "errors.resolve", "errors.configure",
];

// Root Admin is the built-in superuser: it bypasses capability checks entirely
// (like the tenant CEO), so it can never lock itself out — even of a brand-new
// capability that predates its stored matrix row.
const ROOT_ROLE = "PLATFORM_ROOT_ADMIN";

/**
 * Gate a route on a capability. Resolves against req.platformCaps (the role's
 * matrix row, loaded in platformAuth). Root Admin passes unconditionally.
 */
function requireCap(capability) {
  // `platformCapCheck` — see the note on requirePlatformRole above.
  return function platformCapCheck(req, _res, next) {
    if (!req.platformUser) {
      throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    }
    const allowed =
      req.platformUser.role === ROOT_ROLE ||
      (req.platformCaps && req.platformCaps.has(capability));
    if (!allowed) {
      throw new AppError("FORBIDDEN", `Requires capability: ${capability}`, 403);
    }
    return next();
  };
}

module.exports = { platformAuth, requirePlatformRole, requireCap, CAP_CATALOGUE, ROOT_ROLE };
