"use strict";

/**
 * The public insights surface (WS5) — `/api/tenant/public/insights`.
 *
 * PUBLIC ROUTES ARE PINNED TO LIVE. These endpoints are reachable with no
 * session, so the caller is an anonymous visitor on the tenant's marketing site.
 * `req.tenantDb` resolves the environment from the `X-Praxis-Env` header, which
 * means that visitor chooses it — sending `X-Praxis-Env: sandbox` would make
 * sandbox rows publicly readable. `req.tenantDbIn("live", …)` is the same
 * mechanism `tracking_public` and `careers` use for exactly this reason.
 *
 * `feature: "website"` (unlike the editor beside it): the articles are part of
 * the website package, and a tenant who has not bought it should not have an
 * insights index answering 200 on their host. The editor is ungated so a writer
 * can draft before the package is switched on.
 */

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { AppError, asyncHandler } = require("../../../utils/errors");
const storage = require("../../../services/storage.service");
const repo = require("../insight/insight.repo");
const service = require("../insight/insight.service");
const v = require("../insight/insight.validator");

const router = express.Router();
const limit = makeLimiter({ name: "insights-public", max: 120, windowMs: 15 * 60 * 1000 });
/**
 * Images get their own budget, and a large one — the same reasoning
 * `service_type_web_public` records: one visit to an index of nine cards spends
 * nine requests here and one on the JSON, so a shared budget would make the page
 * that shows the most images the one most likely to have them refused. A refused
 * image is a broken frame on a marketing page, not a retry-later banner.
 *
 * Still limited rather than open: these read from the vault, so an unbounded
 * loop is a way to make this process do work on somebody else's behalf.
 */
const mediaLimit = makeLimiter({ name: "insights-public-media", max: 600, windowMs: 15 * 60 * 1000 });

const notFound = (msg) => new AppError("NOT_FOUND", msg, 404);

router.get("/", limit, v.listQuery, asyncHandler(async (req, res) => {
  const { tag, page, per_page: perPage } = req.validatedQuery;
  res.json({
    data: await req.tenantDbIn("live", (c) => service.listPublic(c, {
      tag: tag || null,
      page: page || 1,
      perPage: perPage || service.DEFAULT_PER_PAGE,
    })),
  });
}));

/**
 * Declared BEFORE `/:slug`, or `/media/abc` is read as an article whose slug is
 * "media" — Express matches in declaration order and a literal segment does not
 * win by being more specific.
 */
router.get("/media/:id", mediaLimit, asyncHandler(async (req, res) => {
  // Cover or gallery — one URL space for an article's images, and the id is
  // what says which. Both re-checks are fail-closed and both require the
  // article to be published, so a draft's media is never servable.
  const doc = await req.tenantDbIn("live", (c) => repo.publicMediaForServe(c, req.params.id));
  if (!doc || !doc.storage_path || doc.storage_path.startsWith("pending://")) {
    throw notFound("Media not found");
  }
  const buffer = await storage.get(doc.storage_path);
  res.setHeader("Content-Type", doc.public_media_content_type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // A year, immutable — the id in the URL is the vault DOCUMENT's id, so the
  // bytes behind a given URL never change: replacing a cover uploads a new
  // document, which gets a new id, which is a new URL. The ETag makes the first
  // revalidation after a year a 304 rather than another full read.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", `"${req.params.id}-${buffer.length}"`);
  res.send(buffer);
}));

router.get("/:slug", limit, asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDbIn("live", (c) => service.getPublic(c, req.params.slug)),
  });
}));

// `idParam: "text"` — :slug is a hyphenated string, not a uuid, so the loader's
// id guard would reject every real request.
module.exports = { basePath: "/public/insights", feature: "website", idParam: "text", router };
