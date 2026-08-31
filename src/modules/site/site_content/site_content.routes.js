/**
 * Website content — the editor's surface.
 *
 * Gated on MOD-29 like the rest of the website admin (see site_content.events).
 * The PUBLIC read is a separate module, `site_public`, mounted at
 * /public/site and gated on the `website` feature; this one is not, because an
 * editor must be able to prepare a site before the package is switched on.
 */
"use strict";

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./site_content.service");
const events = require("./site_content.events");
const v = require("./site_content.validator");

const MODULE = events.MODULE;
const router = express.Router();

// Editing a tenant's website is staff work. The PUBLIC read is a separate
// module; nothing here is reachable without an account.
router.use(authMiddleware);

// What the editor needs to draw its own controls: the commercial flag (shown,
// never enforced here) and the metric keys a stat may bind to. See
// site_content.service.editorMeta.
router.get("/meta", requirePermission(MODULE, "view"), asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.editorMeta(c)) });
}));

router.get("/pages", requirePermission(MODULE, "view"), asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.listPages(c)) });
}));

router.post("/pages", requirePermission(MODULE, "edit"), v.createPage, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.createPage(c, { patch: req.body, actor: req.user || {} }));
  res.status(201).json({ data });
}));

// The editor's read: the page AND its blocks, hidden ones included.
router.get("/pages/:pageId", requirePermission(MODULE, "view"), asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.getPageTab(c, req.params.pageId)) });
}));

router.patch("/pages/:pageId", requirePermission(MODULE, "edit"), v.updatePage, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.updatePage(c, {
    pageId: req.params.pageId, patch: req.body, actor: req.user || {},
  }));
  res.json({ data });
}));

// Its own endpoint, not a field: publishing stamps who and when.
router.post("/pages/:pageId/publish", requirePermission(MODULE, "edit"), v.setPublished, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.setPublished(c, {
    pageId: req.params.pageId, published: req.body.published, actor: req.user || {},
  }));
  res.json({ data });
}));

router.delete("/pages/:pageId", requirePermission(MODULE, "edit"), v.validateNoBody, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.deletePage(c, {
    pageId: req.params.pageId, actor: req.user || {},
  }));
  res.json({ data });
}));

/* ── blocks ──────────────────────────────────────────────────────────────── */

router.post("/pages/:pageId/blocks", requirePermission(MODULE, "edit"), v.createBlock, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.createBlock(c, {
    pageId: req.params.pageId, patch: req.body, actor: req.user || {},
  }));
  res.status(201).json({ data });
}));

// Whole-page order, in one statement — see repo.reorderBlocks.
router.post("/pages/:pageId/blocks/reorder", requirePermission(MODULE, "edit"), v.reorderBlocks, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.reorderBlocks(c, {
    pageId: req.params.pageId, orderedIds: req.body.block_ids, actor: req.user || {},
  }));
  res.json({ data });
}));

router.patch("/blocks/:blockId", requirePermission(MODULE, "edit"), v.updateBlock, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.updateBlock(c, {
    blockId: req.params.blockId, patch: req.body, actor: req.user || {},
  }));
  res.json({ data });
}));

router.delete("/blocks/:blockId", requirePermission(MODULE, "edit"), v.validateNoBody, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.deleteBlock(c, {
    blockId: req.params.blockId, actor: req.user || {},
  }));
  res.json({ data });
}));

module.exports = { basePath: "/site", feature: null, router };
