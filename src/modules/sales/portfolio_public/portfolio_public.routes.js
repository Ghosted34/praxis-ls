"use strict";

/**
 * Anonymous marketing routes are always pinned to LIVE. An internet caller may
 * not select a tenant environment through X-Praxis-Env.
 */
const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./portfolio_public.service");

const router = express.Router();
const limit = makeLimiter({ name: "portfolio-public", max: 120, windowMs: 15 * 60 * 1000 });

router.get("/", limit, asyncHandler(async (req, res) => res.json({
  data: await req.tenantDbIn("live", (client) => service.list(client)),
})));
router.get("/media/:id", limit, asyncHandler(async (req, res) => {
  const { doc, buffer } = await req.tenantDbIn("live", (client) => service.media(client, req.params.id));
  res.setHeader("Content-Type", doc.public_media_content_type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(buffer);
}));
router.get("/:slug", limit, asyncHandler(async (req, res) => res.json({
  data: await req.tenantDbIn("live", (client) => service.get(client, req.params.slug)),
})));

module.exports = { basePath: "/public/portfolio", feature: null, idParam: "text", router };
