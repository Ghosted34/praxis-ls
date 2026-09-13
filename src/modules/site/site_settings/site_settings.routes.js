"use strict";
/**
 * Website settings — the administrator's surface.
 *
 * Gated on MOD-29, the key every part of the tenant's public face rides (see
 * site_settings.events). NOT feature-gated: like `site_content`, a tenant must
 * be able to prepare a website before the commercial `website` package is
 * switched on. The PUBLIC reads live in `site_public` and are gated there.
 *
 * RBAC action is `edit`, never `update` — the backend spells it that way.
 */

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./site_settings.service");
const events = require("./site_settings.events");
const v = require("./site_settings.validator");
const media = require("./site_settings.media");

const MODULE = events.MODULE;
const router = express.Router();

// Editing a tenant's website is staff work. Nothing here is reachable without
// an account; the stranger-facing reads are a different module.
router.use(authMiddleware);

const view = requirePermission(MODULE, "view");
const edit = requirePermission(MODULE, "edit");

/* ── theme ──────────────────────────────────────────────────────────────────*/

router.get("/theme", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.getTheme(c)) });
}));

/**
 * The DERIVED palette, for the settings preview.
 *
 * The preview reads the same endpoint shape the public site paints from, so it
 * cannot promise a tenant something the site then contradicts — which is the
 * failure the shared engine exists to prevent, and it would reappear the moment
 * the preview computed its own.
 */
router.get("/theme/preview", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.publicTheme(c)) });
}));

router.put("/theme", edit, v.theme, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.updateTheme(c, { patch: req.body, actor: req.user || {} }));
  res.json({ data });
}));

/* ── social ─────────────────────────────────────────────────────────────────*/

router.get("/social", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.listSocial(c)) });
}));

router.put("/social", edit, v.social, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.saveSocial(c, { links: req.body, actor: req.user || {} }));
  res.json({ data });
}));

/* ── partners, credentials, leaders ─────────────────────────────────────────*/

/**
 * Partners, credentials and leaders are the same shape, and they are still
 * written out one at a time.
 *
 * ── WHY THE TABLE-DRIVEN VERSION WAS REVERTED ──────────────────────────────
 *
 * These twelve handlers were originally mounted from a `RESOURCES` array —
 * fewer lines, and every route provably identical to its neighbours.
 * `scripts/check-write-route-validators.js` rejected it, and it was right to:
 * the gate reads the routes file statically and saw `router.post(`/${r.path}`)`
 * with a validator it could not resolve. It reported two write routes accepting
 * an unvalidated body.
 *
 * The validators WERE there. That is not the point. The gate exists because
 * SEC H3 found request-body keys reaching `insertOne`/`updateOne` as column
 * identifiers, and a security gate that cannot see a route cannot vouch for it.
 * A loop that saves eight lines and blinds a mass-assignment check is not a
 * saving — and the next person to add a fourth resource inside the loop would
 * have inherited the blindness without ever seeing the gate complain.
 *
 * So: explicit, verbose, and machine-readable.
 */

/* ── partners ───────────────────────────────────────────────────────────────*/

router.get("/partners", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.partners.list(c)) });
}));

router.post("/partners", edit, v.createPartner, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.partners.create(c, { patch: req.body, actor: req.user || {} }));
  res.status(201).json({ data });
}));

router.patch("/partners/:id", edit, v.updatePartner, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.partners.update(c, { id: req.params.id, patch: req.body, actor: req.user || {} }));
  res.json({ data });
}));

router.delete("/partners/:id", edit, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.partners.remove(c, { id: req.params.id, actor: req.user || {} }));
  res.json({ data });
}));

/* ── credentials ────────────────────────────────────────────────────────────*/

router.get("/credentials", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.credentials.list(c)) });
}));

router.post("/credentials", edit, v.createCredential, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.credentials.create(c, { patch: req.body, actor: req.user || {} }));
  res.status(201).json({ data });
}));

router.patch("/credentials/:id", edit, v.updateCredential, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.credentials.update(c, { id: req.params.id, patch: req.body, actor: req.user || {} }));
  res.json({ data });
}));

router.delete("/credentials/:id", edit, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.credentials.remove(c, { id: req.params.id, actor: req.user || {} }));
  res.json({ data });
}));

/* ── leaders ────────────────────────────────────────────────────────────────*/

router.get("/leaders", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.leaders.list(c)) });
}));

router.post("/leaders", edit, v.createLeader, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.leaders.create(c, { patch: req.body, actor: req.user || {} }));
  res.status(201).json({ data });
}));

router.patch("/leaders/:id", edit, v.updateLeader, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.leaders.update(c, { id: req.params.id, patch: req.body, actor: req.user || {} }));
  res.json({ data });
}));

router.delete("/leaders/:id", edit, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.leaders.remove(c, { id: req.params.id, actor: req.user || {} }));
  res.json({ data });
}));

/* ── website media ──────────────────────────────────────────────────────────*/

/**
 * One upload endpoint, four slots (§6.3).
 *
 * The SLOT is in the body rather than the path because it is a validated enum
 * from `@praxis/shared` and the service looks the rest up from it — table,
 * column, vault role, caps. A path segment would be a request string that has
 * to be proved safe on the way to a query; an enum has already been proved.
 * Same rule as SEC H3, one layer earlier.
 *
 * `req.tenant.slug` is what the vault names the storage key from; every other
 * upload path in this codebase passes it the same way.
 */
router.post("/media", edit, v.media, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => media.upload(c, {
    slot: req.body.slot,
    ownerId: req.body.owner_id,
    dataUrl: req.body.data_url,
    originalName: req.body.original_name,
    provenance: req.body.provenance,
    actor: req.user || {},
    slug: req.tenant && req.tenant.slug,
  }));
  res.status(201).json({ data });
}));

/**
 * Take an image out of a slot.
 *
 * `:slot` here IS a path segment, and it is safe for the reason the service
 * states: it is looked up in `OWNERS` and answers 422 when it is not a key.
 * Nothing is interpolated from it.
 */
router.delete("/media/:slot/:ownerId", edit, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => media.remove(c, {
    slot: req.params.slot,
    ownerId: req.params.ownerId,
    actor: req.user || {},
  }));
  res.json({ data });
}));

/* ── the group About ────────────────────────────────────────────────────────*/

router.get("/about", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.getAbout(c)) });
}));

router.put("/about", edit, v.about, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.updateAbout(c, { patch: req.body, actor: req.user || {} }));
  res.json({ data });
}));

/* ── the careers page's two switches (13792) ────────────────────────────────*/

router.get("/careers", view, asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.getCareers(c)) });
}));

router.put("/careers", edit, v.careers, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.updateCareers(c, { patch: req.body, actor: req.user || {} }));
  res.json({ data });
}));

/* ── an entity's public story ───────────────────────────────────────────────*/

/**
 * Under THIS module rather than under MOD-01, deliberately.
 *
 * The columns live on `corporate_entity`, but what they are is website copy,
 * and the permission that should govern them is the one that governs the
 * website. A marketing administrator who may write the homepage should be able
 * to write an entity's public paragraph without also being granted the
 * statutory dossier, the cap table and the governance data that MOD-01 `edit`
 * carries.
 */
router.get("/entities/:id/story", view, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.getEntityStory(c, req.params.id));
  if (!data) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Entity not found" } });
  return res.json({ data });
}));

router.put("/entities/:id/story", edit, v.entityStory, asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.updateEntityStory(c, { entityId: req.params.id, patch: req.body, actor: req.user || {} }));
  res.json({ data });
}));

module.exports = { basePath: "/site-settings", feature: null, router };
