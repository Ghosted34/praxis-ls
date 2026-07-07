/**
 * Central route table.
 *   /api/health              liveness
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

const router = express.Router();

router.get("/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() }),
);

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
