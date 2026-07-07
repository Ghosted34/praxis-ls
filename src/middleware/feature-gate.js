/**
 * Generic EMV/feature gate — blocks a route unless the tenant's projected
 * feature_state has `featureKey` = 'on'. Used to make every module toggleable
 * from the company dashboard. AI routes use the same gate via ai-gate.
 */
"use strict";

function requireFeature(featureKey) {
  return async function gate(req, res, next) {
    if (!req.tenantDb) {
      return res.status(500).json({
        error: { code: "NO_TENANT_CONTEXT", message: "tenantContext must run first" },
      });
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
        return res.status(403).json({
          error: { code: "FEATURE_DISABLED", message: `Feature '${featureKey}' is off for this tenant` },
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireFeature };
