"use strict";

/**
 * Insights — the editor's surface (WS5).
 *
 * Gated on MOD-29 like the rest of the website admin. The PUBLIC read is a
 * separate module, `insight_public`, mounted at /public/insights and gated on
 * the `website` feature; this one is not, for the reason `site_content` gives:
 * a writer must be able to draft before the package is switched on, and a
 * feature flag that hid the editor would make the first article impossible to
 * write.
 */

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./insight.service");
const events = require("./insight.events");
const v = require("./insight.validator");

const MODULE = events.MODULE;
const router = express.Router();

// Writing the tenant's articles is staff work. Nothing here is reachable
// without an account.
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.list(c, { tag: req.query.tag || null })) });
}));

router.post("/", requirePermission(MODULE, "edit"), v.create, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.create(c, { patch: req.body, actor: req.user || {} }));
  res.status(201).json({ data });
}));

router.get("/:id", requirePermission(MODULE, "view"), asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.get(c, req.params.id)) });
}));

router.patch("/:id", requirePermission(MODULE, "edit"), v.update, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.update(c, {
    id: req.params.id, patch: req.body, actor: req.user || {},
  }));
  res.json({ data });
}));

// Its own endpoint, not a field: publishing stamps who and when, and refuses an
// article with no body or no slug.
router.post("/:id/publish", requirePermission(MODULE, "edit"), v.publish, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.setPublished(c, {
    id: req.params.id, published: req.body.published, actor: req.user || {},
  }));
  res.json({ data });
}));

router.delete("/:id", requirePermission(MODULE, "edit"), v.validateNoBody, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: req.user || {} }));
  res.json({ data });
}));

module.exports = { basePath: "/insights", feature: null, router };
