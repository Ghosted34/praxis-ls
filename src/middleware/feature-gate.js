/**
 * Generic EMV/feature gate — blocks a route unless the tenant's projected
 * feature_state has `featureKey` = 'on'. Used to make every module toggleable
 * from the company dashboard. AI routes use the same gate via ai-gate.
 *
 * API-F3: these used to answer with `res.status(...).json(...)` directly, which
 * skipped the error handler and therefore omitted `request_id` — so the one
 * class of failure a caller is most likely to report ("the feature is off",
 * "unknown workspace") was the one class they could not quote a correlation id
 * for. Going through `next(AppError)` gives the uniform envelope, the log line
 * and the 5xx report for free, and cannot drift out of sync the way six
 * hand-written literals can.
 */
"use strict";

const { AppError } = require("../utils/errors");

function requireFeature(featureKey) {
  return async function gate(req, _res, next) {
    if (!req.tenantDb) {
      return next(new AppError("NO_TENANT_CONTEXT", "tenantContext must run first", 500));
    }
    try {
      const on = await req.tenantDb(async (c) => {
        const { rows } = await c.query(
          "SELECT state FROM feature_state WHERE feature_key=$1",
          [featureKey],
        );
        return rows[0] && rows[0].state === "on";
      });
      if (!on) {
        return next(new AppError("FEATURE_DISABLED", `Feature '${featureKey}' is off for this tenant`, 403));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireFeature };
