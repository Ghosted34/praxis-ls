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
 * and the allowlist re-check (`repo.vaultMediaForServe` + an additional
 * `service_type_id` match against `public_media_entity_ref`) is what makes a
 * doc id genuinely servable.
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler } = require("../../../utils/errors");
const storage = require("../../../services/storage.service");
const repo = require("../service_type_web/service_type_web.repo");

const router = express.Router();
const limit = makeLimiter({ name: "services-public", max: 120, windowMs: 15 * 60 * 1000 });

/** The shape the public list returns (guide §4.6): no bodies, no bytes —
 *  just the addressable identity, the card teaser, the cover/icon URLs
 *  (nulled if the allowlist would refuse), and the published_month. */
const mediaUrl = (id) => (id ? `/api/tenant/public/services/media/${id}` : null);

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
    published_month: row.published_at ? String(row.published_at).slice(0, 7) : null,
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
  if (!result) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Service not found" } });
    return;
  }
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
      published_month: row.published_at ? String(row.published_at).slice(0, 7) : null,
    },
  });
}));

router.get("/media/:id", limit, asyncHandler(async (req, res) => {
  // Re-check VERIFIED + scope + role + image content type before streaming.
  // The doc id alone is not authority; a profile row that points at an
  // archived vault row gets a 404 here, exactly as `portfolio_public` does.
  const doc = await req.tenantDbIn("live", (client) => repo.vaultMediaForServe(client, req.params.id));
  if (!doc || !doc.storage_path || doc.storage_path.startsWith("pending://")) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Media not found" } });
    return;
  }
  const buffer = await storage.get(doc.storage_path);
  res.setHeader("Content-Type", doc.public_media_content_type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(buffer);
}));

module.exports = { basePath: "/public/services", feature: "website", idParam: "text", router };
