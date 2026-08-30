/**
 * Anonymous public read of the tenant website — `/public/services` (guide
 * §3.2, §4.5). Pinned to the LIVE schema (`req.tenantDbIn("live", …)`) so an
 * internet caller never selects sandbox via `X-Praxis-Env`. Rate-limited at
 * 120/15min per `makeLimiter` — same shape as `portfolio_public`.
 *
 * The loader discovers this module by walking `src/modules/<group>/<module>/
 * <module>.routes.js` and mounts it on the tenant router gated by
 * `feature: "website"`. `requireFeature` only needs tenant context, so the
 * anonymous router can carry the flag and answer `FEATURE_DISABLED` (403)
 * when the package is off.
 *
 * The `/media/:id` route streams the image bytes itself; nothing about the
 * streaming depends on a tenant connection that the public surface can reach,
 * and the allowlist re-check (`repo.publicMediaForServe`) is what makes a
 * doc id genuinely servable. That function:
 *   - refuses a non-UUID id at the boundary (no DB hit);
 *   - re-verifies VERIFIED + scope + image content type;
 *   - joins the owning `service_type_web_profile` AND the master
 *     `service_type` so it can assert `p.is_published = true AND
 *     st.is_active = true` (an embargoed launch preview, an archived
 *     service, or a draft edit all stop the stream); and
 *   - binds the doc to the specific slot — `cover_vault_id`,
 *     `icon_vault_id`, or one of the `gallery_vault_ids` — so a doc
 *     scoped to service A cannot be served from a request for
 *     service B's media, and a doc archived out of the cover slot is
 *     not served as a cover from a stale URL.
 * Mirrors the named precedent at `portfolio_public.service.js:117-139`.
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { AppError, asyncHandler } = require("../../../utils/errors");
const storage = require("../../../services/storage.service");
const { publishedMonth } = require("../../../shared/date/published-month");
const repo = require("../service_type_web/service_type_web.repo");
const grouping = require("./service_type_web_public.service");

const router = express.Router();
const limit = makeLimiter({ name: "services-public", max: 120, windowMs: 15 * 60 * 1000 });
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
const mediaLimit = makeLimiter({ name: "services-public-media", max: 600, windowMs: 15 * 60 * 1000 });

/** The shape the public list returns (guide §4.6): no bodies, no bytes —
 *  just the addressable identity, the card teaser, the cover/icon URLs
 *  (nulled if the allowlist would refuse), and the published_month. */
const mediaUrl = (id) => (id ? `/api/tenant/public/services/media/${id}` : null);

const notFound = (msg) => new AppError("NOT_FOUND", msg, 404);

/**
 * Grouped, because a services page is pillars and not a list (12752).
 *
 * The repo returns flat rows already ordered pillar-then-card; this walks them
 * once and folds them into groups, which is why insertion order is the render
 * order and nothing here sorts again. Services with no pillar — the state every
 * tenant is in the day the column ships, and the state a service returns to
 * when its pillar is retired — collect into a TRAILING group whose key is null.
 * They are never dropped: an unassigned service is a content gap, not a reason
 * to hide something the tenant published.
 *
 * The response is an object rather than the flat array it used to be. That is a
 * shape change with no consumer to break: the route is gated on the `website`
 * feature, which ships `default_state = 'off'` (seed 9116), so it has never
 * answered 200 in production.
 */
router.get("/", limit, asyncHandler(async (req, res) => {
  const rows = await req.tenantDbIn("live", (client) => repo.publicList(client));
  res.json({
    data: grouping.groupServices(rows, (row) => ({
      service_type_id: row.service_type_id,
      slug_fr: row.slug_fr,
      slug_en: row.slug_en,
      name_fr: row.name_fr,
      name_en: row.name_en,
      short_description_fr: row.short_description_fr,
      short_description_en: row.short_description_en,
      claim_fr: row.claim_fr,
      claim_en: row.claim_en,
      accent: row.accent,
      cover_url: row.cover_allowed ? mediaUrl(row.cover_vault_id) : null,
      icon_url: row.icon_allowed ? mediaUrl(row.icon_vault_id) : null,
      has_video: row.has_video,
      sort_order: row.sort_order,
      published_month: publishedMonth(row.published_at),
    })),
  });
}));

router.get("/:slug", limit, asyncHandler(async (req, res) => {
  const result = await req.tenantDbIn("live", async (client) => {
    const detail = await repo.publicDetail(client, req.params.slug);
    if (!detail) return null;
    const { row, mediaByRole } = detail;
    const [related, faq] = await Promise.all([
      repo.publicRelated(client, row.service_type_id),
      repo.publicFaq(client, row.service_type_id),
    ]);
    return { row, mediaByRole, related, faq };
  });
  if (!result) throw notFound("Service not found");
  const { row, mediaByRole, related, faq } = result;
  const coverAllowed = mediaByRole.has(row.cover_vault_id);
  const iconAllowed = mediaByRole.has(row.icon_vault_id);
  const galleryAllowed = (row.gallery_vault_ids || []).filter((id) => mediaByRole.has(id));
  res.json({
    data: {
      service_type_id: row.service_type_id,
      slug_fr: row.slug_fr,
      slug_en: row.slug_en,
      alternates: { fr: row.slug_fr, en: row.slug_en },
      name_fr: row.name_fr,
      name_en: row.name_en,
      short_description_fr: row.short_description_fr,
      short_description_en: row.short_description_en,
      long_description_fr: row.long_description_fr,
      long_description_en: row.long_description_en,
      highlights_fr: row.highlights_fr,
      highlights_en: row.highlights_en,
      coverage_fr: row.coverage_fr,
      coverage_en: row.coverage_en,
      cover_url: coverAllowed ? mediaUrl(row.cover_vault_id) : null,
      icon_url: iconAllowed ? mediaUrl(row.icon_vault_id) : null,
      gallery_urls: galleryAllowed.map(mediaUrl),
      video_url: row.video_url,
      meta_title_fr: row.meta_title_fr,
      meta_title_en: row.meta_title_en,
      meta_description_fr: row.meta_description_fr,
      meta_description_en: row.meta_description_en,
      faq,
      related,
      published_month: publishedMonth(row.published_at),
    },
  });
}));

router.get("/media/:id", mediaLimit, asyncHandler(async (req, res) => {
  // publicMediaForServe is the fail-closed allowlist re-check — it joins
  // the owning profile + service_type and asserts the parent is published
  // AND active, the role is one of COVER/ICON/GALLERY, and the doc is
  // bound to the matching slot. A bare UUID never grants public access.
  const doc = await req.tenantDbIn("live", (client) => repo.publicMediaForServe(client, req.params.id));
  if (!doc || !doc.storage_path || doc.storage_path.startsWith("pending://")) {
    throw notFound("Media not found");
  }
  const buffer = await storage.get(doc.storage_path);
  res.setHeader("Content-Type", doc.public_media_content_type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // A YEAR, and immutable. The id in this URL is the VAULT DOCUMENT's id, so the
  // bytes behind a given URL never change: replacing a cover, icon or gallery image uploads a new
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

module.exports = { basePath: "/public/services", feature: "website", idParam: "text", router };
