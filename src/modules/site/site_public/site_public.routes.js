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
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("../site_content/site_content.service");
const settings = require("../site_settings/site_settings.service");
const insights = require("../../content/insight/insight.service");
const insightV = require("../../content/insight/insight.validator");
const media = require("../site_settings/site_settings.media");
const storage = require("../../../services/storage.service");

const router = express.Router();
const notFound = (msg) => new AppError("NOT_FOUND", msg, 404);
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

/**
 * The copy overlay — every `site.*` string this tenant has rewritten, as an
 * i18next resource tree per language.
 *
 * ── WHY IT IS CACHED LIKE /theme AND NOT LIKE /announcements ──────────────
 *
 * It is on the LCP path in the strictest sense: the renderer holds its first
 * paint for it, because painting the shipped English heading and swapping it
 * for the tenant's a beat later is a visible flicker on the largest text on the
 * page. So it gets `/theme`'s five minutes, for `/theme`'s reason — a burst of
 * visitors costs one read, and a tenant who rewrites a heading sees it within a
 * coffee break. Copy is not the thing a tenant publishes because it is urgent;
 * that is the announcements band, which is deliberately uncached.
 *
 * Never 404s. A tenant who has overridden nothing — which is every tenant on
 * day one — gets `{en:{},fr:{}}` and the site reads exactly as it shipped.
 */
router.get("/copy", limit, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ data: await req.tenantDbIn("live", (c) => service.getPublicCopy(c)) });
}));

/* ── the experience reads ───────────────────────────────────────────────────
 *
 * Everything below is served to the open internet, on the same rate limiter and
 * the same LIVE-schema pin as the page reads above: `req.tenantDbIn("live", …)`
 * so an internet caller can never select sandbox through `X-Praxis-Env`.
 *
 * None of them 404 on emptiness. A tenant with no partners, no credentials and
 * no social links has an empty array in each, and the renderer draws nothing —
 * which is the correct empty state for a marketing band. A 404 would make an
 * unconfigured site look broken rather than plain.
 */

/**
 * The theme: the tenant's three colours, the palette derived from them for both
 * light and dark, the resolved fonts, and the corrections the engine had to
 * make.
 *
 * This is ON THE LCP PATH — it is the first thing the site needs and nothing
 * paints correctly before it — so it is the one read here that is cached at the
 * edge. Five minutes: long enough that a burst of visitors costs one
 * derivation, short enough that a tenant who changes their brand colour sees it
 * within a coffee break rather than filing a support ticket.
 */
router.get("/theme", limit, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicTheme(c)) });
}));

/**
 * Announcements: the live pins the homepage band draws, and the list behind
 * them.
 *
 * ── WHY IT LIVES HERE AND NOT UNDER /public/insights ───────────────────────
 *
 * An announcement IS an article (13784) and its DETAIL page is
 * `/public/insights/:slug` — that route serves it today with no change, which
 * is the whole point of the kind column. What is different is this shape: a
 * capped pinned collection plus a list, assembled for one band on one page.
 * That is a website read, so it sits with the website's other reads, on their
 * limiter and their LIVE pin, and the guide's §6.9 endpoint table puts it here.
 *
 * ── THE CAP IS NOT NEGOTIABLE BY THE CALLER ────────────────────────────────
 *
 * `per_page` narrows the LIST. It has no effect on `pinned`, which the service
 * caps at five with a SQL `LIMIT`. A cap a query string can raise is not a cap.
 *
 * Not cached at the edge, unlike `/theme`: an announcement is the one thing on
 * this site a tenant publishes because it is URGENT, and five minutes of stale
 * is the wrong trade for the band that carries a port closure.
 */
router.get("/announcements", limit, insightV.listQuery, asyncHandler(async (req, res) => {
  const { page, per_page: perPage } = req.validatedQuery;
  res.json({
    data: await req.tenantDbIn("live", (c) => insights.listPublicAnnouncements(c, {
      page: page || 1,
      perPage: perPage || insights.DEFAULT_PER_PAGE,
    })),
  });
}));

/** Active partners by kind, and unexpired credentials. `permission_note` is
 *  never selected — see the service. */
router.get("/partners", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicPartners(c)) });
}));

/** Platforms that have a URL. Nothing else exists. */
router.get("/social", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicSocial(c)) });
}));

/** The group story and group-level leadership. */
router.get("/about", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicAbout(c)) });
}));

/** Public-enabled entities and their leadership. No RCCM, no NIU, no cap
 *  table, no governance — an allow-list, not a deletion. */
router.get("/entities", limit, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDbIn("live", (c) => settings.publicEntities(c)) });
}));

/* ── website media ──────────────────────────────────────────────────────────
 *
 * Declared BEFORE nothing in particular — none of the reads above take a path
 * parameter that could swallow `/media` — but kept together and near the top of
 * the media-serving concerns so the two routes are read as one thing.
 *
 * ── EVERY CLAUSE IS FAIL-CLOSED, AND THE OWNER JOIN IS THE POINT ───────────
 *
 * `publicMediaForServe` requires the document to still be the one its owner
 * points at AND that owner to still be publishable. So a portrait stops being
 * servable the moment its leader is deactivated, a partner's mark the moment
 * its clearance is withdrawn — 13782 makes `is_active` and `permission_note`
 * inseparable, so there is no state in which an uncleared mark has a live URL —
 * and an entity cover the moment `public_enabled` goes off. None of that
 * depends on anything remembering to archive a document.
 *
 * A separate, tighter limiter than the JSON reads: one page can ask for a dozen
 * images, and a visitor who loads About twice should not spend their whole
 * budget on portraits. The same split `insight_public` makes.
 */
const mediaLimit = makeLimiter({ name: "site-public-media", max: 600, windowMs: 15 * 60 * 1000 });

/** The original bytes. */
router.get("/media/:id", mediaLimit, asyncHandler(async (req, res) => {
  const doc = await req.tenantDbIn("live", (c) => media.publicMediaForServe(c, req.params.id));
  if (!doc || !doc.storage_path || doc.storage_path.startsWith("pending://")) {
    throw notFound("Media not found");
  }
  await send(res, req.params.id, await storage.get(doc.storage_path), doc.public_media_content_type);
}));

/**
 * One derivative — `/media/:id/960.avif`.
 *
 * The width and the format are matched against the ladder RECORDED ON THE ROW
 * before any key is built (`resolveVariant`), so a request string never reaches
 * a storage path and a variant nobody wrote is a 404 rather than a read of a
 * guessed key. A 404 here is also survivable by design: the renderer emits
 * these as `<source>` elements over an `<img>` pointing at the original.
 */
router.get("/media/:id/:variant", mediaLimit, asyncHandler(async (req, res) => {
  const match = /^(\d{2,5})\.([a-z]{3,4})$/.exec(String(req.params.variant || ""));
  if (!match) throw notFound("Media not found");
  const doc = await req.tenantDbIn("live", (c) => media.publicMediaForServe(c, req.params.id));
  if (!doc || !doc.storage_path || doc.storage_path.startsWith("pending://")) {
    throw notFound("Media not found");
  }
  const variant = media.resolveVariant(doc, match[1], match[2]);
  if (!variant) throw notFound("Media not found");
  await send(res, `${req.params.id}-${req.params.variant}`, await storage.get(variant.key), variant.contentType);
}));

/**
 * The response both media routes send.
 *
 * A YEAR, IMMUTABLE, because the id in the URL is the vault DOCUMENT's id: the
 * bytes behind a given URL never change. Replacing a portrait uploads a new
 * document, which gets a new id, which is a new URL — the same reasoning
 * `insight_public` records for article covers, and the reason a tenant never
 * has to think about cache busting.
 */
async function send(res, tag, buffer, contentType) {
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", `"${tag}-${buffer.length}"`);
  res.send(buffer);
}

module.exports = { basePath: "/public/site", feature: "website", idParam: "text", router };
