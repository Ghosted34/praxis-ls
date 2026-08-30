/**
 * The website's public read.
 *
 * Pinned to the LIVE schema (`req.tenantDbIn("live", …)`) so an internet caller
 * can never select sandbox via `X-Praxis-Env` — the same rule
 * service_type_web_public follows. Gated on the `website` feature, so the
 * commercial switch governs the public site while the editor (`/site`) stays
 * available to prepare one before the package is on.
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler } = require("../../../utils/errors");
const service = require("../site_content/site_content.service");

const router = express.Router();
const limit = makeLimiter({ name: "site-public", max: 240, windowMs: 15 * 60 * 1000 });

/** The nav. Published pages only. */
router.get("/pages", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => service.listPublicPages(c)) });
}));

/**
 * One page by key, blocks in order, metrics resolved.
 *
 * 404 for unknown AND for unpublished: to a visitor they are the same fact, and
 * rendering an empty shell would put half-written copy on a URL that returns
 * 200.
 */
router.get("/pages/:key", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => service.getPublicPage(c, req.params.key)) });
}));

module.exports = { basePath: "/public/site", feature: "website", idParam: "text", router };
