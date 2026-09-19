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
const { requirePermission, requireAnyPermission } = require("../../../middleware/rbac");
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

/**
 * The website-media gate, differentiated by SLOT.
 *
 * Website media is MOD-29 work — partners, credentials, leader portraits. The
 * entity cover is the one slot on a MOD-01-owned row, and Decision Q10 says
 * MOD-01 edit owns the entity's Public Story — whose cover control is the
 * upload/replace/remove in `entity-public-story-tab.tsx`. So the `entity-cover`
 * slot also admits MOD-01 `edit`, while every other slot stays MOD-29 only.
 *
 * The slot name is a shared-schema enum, so testing it here is safe — it is
 * never interpolated into a query.
 *
 * Named `mediaSlotGate` (not anonymous) so scripts/check-api-contract.js can
 * see this stack entry as an RBAC gate: an anonymous arrow sits in the chain
 * with `.name === "anonymous"` and the route reads — falsely — as having lost
 * its permission check.
 */
function mediaSlotGate(slotFrom = (req) => (req.body && req.body.slot)) {
  // Named (not an arrow) so the REGISTERED middleware — this returned
  // function, not the factory — carries a name Express records on the stack.
  // check-api-contract.js reads stack names to detect RBAC; an anonymous
  // arrow would read as a route that lost its permission gate.
  return function mediaSlotCheck(req, _res, next) {
    if (slotFrom(req) === "entity-cover") {
      return requireAnyPermission([["MOD-01", "edit"], ["MOD-29", "edit"]])(req, _res, next);
    }
    return edit(req, _res, next);
  };
}

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
router.post("/media", mediaSlotGate(), v.media, asyncHandler(async (req, res) => {
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
router.delete("/media/:slot/:ownerId", mediaSlotGate((req) => req.params.slot), asyncHandler(async (req, res) => {
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
 * The service catalogue behind the Story tab's focus picker (Decision Q8).
 *
 * The picker must offer `service_type.key` — a stable ID from the tenant's own
 * taxonomy — and NOT a free-text transport mode, so the card's colour is
 * derived in one place instead of hand-picked per line. The list is the
 * ACTIVE catalogue with each entry's mode derived by the same function the
 * public payload uses, which is why it lives here rather than the caller
 * re-deriving it: two derivations is how a ship on the tracking page ends up
 * orange on the About page.
 *
 * The gate is the STORY READ's gate (MOD-01 view OR MOD-29 view — Q10): the
 * two callers who may read a story are exactly the two who may read the list
 * it classifies against, and a MOD-01 editor who cannot see the catalogue
 * would be reduced to typing a key nobody ever showed them.
 */
router.get("/service-types",
  requireAnyPermission([["MOD-01", "view"], ["MOD-29", "view"]]),
  asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.serviceFocusCatalogue(c)) });
  }));

/**
 * The columns live on `corporate_entity`, but what they are is website copy.
 *
 * Decision Q10: MOD-01 `edit` INCLUDES Public Story edit for this module. A
 * marketing administrator who writes the homepage (MOD-29) may still write an
 * entity's public paragraph, and the entity administrator (MOD-01) may now edit
 * the whole dossier — including the Story tab — without being refused by a
 * MOD-29-only gate. The two grants are equivalent in power for this route (the
 * write surface is "the entity's public paragraphs, coverage, focus, cover and
 * publish switch"), so the gate is an OR rather than a second grant.
 *
 * The READ stays wide (both modules may view their own surface under MOD-01
 * `view` / MOD-29 `view`), and keeps working server-side regardless of which
 * module the caller holds.
 */
router.get("/entities/:id/story",
  requireAnyPermission([["MOD-01", "view"], ["MOD-29", "view"]]),
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.getEntityStory(c, req.params.id));
    if (!data) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Entity not found" } });
    return res.json({ data });
  }));

router.put("/entities/:id/story",
  requireAnyPermission([["MOD-01", "edit"], ["MOD-29", "edit"]]),
  v.entityStory,
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.updateEntityStory(c, { entityId: req.params.id, patch: req.body, actor: req.user || {} }));
    res.json({ data });
  }));

module.exports = { basePath: "/site-settings", feature: null, router };
