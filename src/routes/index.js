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
const maintenance = require("../services/platform/maintenance.service");
const { logger } = require("../config/logger");

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

/**
 * WS-M1 — the maintenance banner a tenant user actually sees.
 *
 * DELIBERATELY UNAUTHENTICATED (it sits above the module loader, so no
 * authMiddleware has run). During a fleet-wide window the people who most need
 * to know are the ones staring at a login screen wondering why nothing works.
 * Gating this behind a session would hide the explanation from exactly them.
 *
 * Nothing here is sensitive: a title, a message, a mode and two timestamps —
 * all of it written to be read by tenant users. It returns `null` when there is
 * no window, which is the answer nearly every time, so the client can poll it
 * cheaply.
 */
tenantRouter.get("/maintenance", async (req, res) => {
  try {
    res.json({ data: await maintenance.visibleFor(req.tenant.tenant_id) });
  } catch (err) {
    // Never fail the request: a banner endpoint that 500s would make the client
    // show an error about the thing that exists to explain errors.
    logger.warn({ err, slug: req.tenant.slug }, "maintenance banner lookup failed");
    res.json({ data: null });
  }
});
mountTenantModules(tenantRouter); // discovers src/modules/<group>/<module>/*.routes.js
router.use("/tenant", tenantRouter);

module.exports = router;
