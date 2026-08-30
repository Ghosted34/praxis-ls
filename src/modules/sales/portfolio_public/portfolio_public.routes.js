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
/**
 * Images get their own budget, and a large one.
 *
 * A marketing page carries a cover per card, so ONE visit to the case-note index
 * spends as many requests here as a dozen visits spend on the JSON. Sharing the
 * 120/15min read budget meant the page that shows the most images was the page
 * most likely to have them refused — and a refused image is a broken frame on a
 * sales page, not a retry-later banner.
 *
 * Still limited rather than open: these read from the vault, so an unbounded
 * loop is a way to make this process do work on someone else's behalf.
 */
const mediaLimit = makeLimiter({ name: "portfolio-public-media", max: 600, windowMs: 15 * 60 * 1000 });

router.get("/", limit, asyncHandler(async (req, res) => res.json({
  data: await req.tenantDbIn("live", (client) => service.list(client)),
})));
router.get("/media/:id", mediaLimit, asyncHandler(async (req, res) => {
  const { doc, buffer } = await req.tenantDbIn("live", (client) => service.media(client, req.params.id));
  res.setHeader("Content-Type", doc.public_media_content_type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // A YEAR, and immutable. The id in this URL is the VAULT DOCUMENT's id, so the
  // bytes behind a given URL never change: replacing a cover uploads a new
  // document, which gets a new id, which is a new URL. `max-age=300` — five
  // minutes, the shape of a cache header for a JSON list — meant every visitor
  // re-fetched every image twice an hour from the Node process, which reads each
  // one into a Buffer to serve it.
  //
  // An ETag as well, so the first revalidation after a year is a 304 rather than
  // another full read: the id plus the byte length identifies these exactly.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", `"${req.params.id}-${buffer.length}"`);
  res.send(buffer);
}));
router.get("/:slug", limit, asyncHandler(async (req, res) => res.json({
  data: await req.tenantDbIn("live", (client) => service.get(client, req.params.slug)),
})));

module.exports = { basePath: "/public/portfolio", feature: null, idParam: "text", router };
