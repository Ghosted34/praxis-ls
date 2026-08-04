/**
 * Central route table.
 *   /api/health              liveness  — no dependencies, cannot fail
 *   /api/health/ready        readiness — probes Postgres/Redis/modules, 503 when down
 *   /api/platform/*          company dashboard (Praxis-only) — tenant controls
 *   /api/tenant/*            tenant app (subdomain-resolved, live/sandbox bound)
 *                            all feature modules auto-mounted (module-loader)
 */
"use strict";

const express = require("express");
const platformRoutes = require("../modules/platform/platform.routes");
const { hostTenantResolver } = require("../middleware/host-tenent-resolver");
const { tenantContext } = require("../middleware/tenant-context");
const { mountTenantModules } = require("../shared/http/module-loader");
const { router: healthRouter } = require("./health");

const router = express.Router();

// OBS-A2 / TEST-D4: the inline `{ok:true}` handler that used to live here could
// not fail, and scripts/deploy.sh used it as the gate that says a deploy
// worked. See src/routes/health.js for what replaced it and why there are now
// two endpoints rather than one.
router.use(healthRouter);

// Company dashboard (its own auth; not tenant-scoped).
router.use("/platform", platformRoutes);

// Tenant application surface — resolved by subdomain, bound to live/sandbox.
const tenantRouter = express.Router();
tenantRouter.use(hostTenantResolver, tenantContext);
tenantRouter.get("/whoami", (req, res) =>
  res.json({ data: { tenant: req.tenant.slug, env: req.env, is_live: req.tenant.is_live } }),
);
mountTenantModules(tenantRouter); // discovers src/modules/<group>/<module>/*.routes.js
router.use("/tenant", tenantRouter);

module.exports = router;
