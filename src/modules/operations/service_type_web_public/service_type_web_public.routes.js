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

const router = express.Router();
const limit = makeLimiter({ name: "services-public", max: 120, windowMs: 15 * 60 * 1000 });

/** The shape the public list returns (guide §4.6): no bodies, no bytes —
 *  just the addressable identity, the card teaser, the cover/icon URLs
 *  (nulled if the allowlist would refuse), and the published_month. */
const mediaUrl = (id) => (id ? `/api/tenant/public/services/media/${id}` : null);

const notFound = (msg) => new AppError("NOT_FOUND", msg, 404);

router.get("/", limit, asyncHandler(async (req, res) => {
  const rows = await req.tenantDbIn("live", (client) => repo.publicList(client));
  const data = rows.map((row) => ({
    service_type_id: row.service_type_id,
    slug_fr: row.slug_fr,
    slug_en: row.slug_en,
    name_fr: row.name_fr,
    name_en: row.name_en,
    short_description_fr: row.short_description_fr,
    short_description_en: row.short_description_en,
    cover_url: row.cover_allowed ? mediaUrl(row.cover_vault_id) : null,
    icon_url: row.icon_allowed ? mediaUrl(row.icon_vault_id) : null,
    has_video: row.has_video,
    sort_order: row.sort_order,
    published_month: publishedMonth(row.published_at),
  }));
  res.json({ data });
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

router.get("/media/:id", limit, asyncHandler(async (req, res) => {
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
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(buffer);
}));

module.exports = { basePath: "/public/services", feature: "website", idParam: "text", router };
