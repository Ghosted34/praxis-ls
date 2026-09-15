/**
 * Control Tower aggregates.
 *
 * The map lane geometry is composed HERE rather than in the repo, because
 * resolving a free-text POL/POD to coordinates can involve an outbound HTTP call
 * (Geoapify, on a cache miss) and doc/CONVENTIONS.md keeps SQL — and only SQL —
 * in the repo. geoapify.service also requires callers to stay outside a DB
 * transaction across that wait, which a service-layer compose makes obvious.
 */
"use strict";
const repo = require("./dashboard.repo");
const geoPlace = require("../../operations/geo_place/geo_place.service");
const itinerary = require("../../operations/itinerary/itinerary.service");
const kpiCatalog = require("../kpi_catalog");
const kpiResolve = require("../kpi_catalog/resolve");
const kpiEligibility = require("../kpi_catalog/eligibility");
const preferenceService = require("../../preference/preference.service");
const roleKpi = require("../../security/role_kpi/role_kpi.service");
const { logger } = require("../../../config/logger");

/* ── the KPI band ─────────────────────────────────────────────────────────── */

/**
 * The identity half of the band: who may see what, and who chose it.
 *
 * It is a SEPARATE call from the value reads on purpose. `user_preference`,
 * `role_kpi_config`, `permission` and `field_visibility` are identity data —
 * env-pinned by doctrine ("same you, sandbox data", tenant-context.js) — while
 * the tile values live in the REQUEST's environment. One composed function
 * with one client would run someone's pins against the schema they happen to
 * be looking at, and a TEST session would start with a different band than
 * LIVE for no reason the product can defend. Two calls, two schemas, and the
 * controller sequence is what the whole feature's D5 answer hinges on.
 */
async function bandIdentity(client, user) {
  const roleIds = (user && user.role_ids) || [];
  const isCeo = Boolean(user && user.is_ceo === true);
  const [shell, roleConfigs, elig] = await Promise.all([
    user
      ? preferenceService.getShell(client, user.user_id)
      : Promise.resolve({ kpiPins: null }),
    roleKpi.getConfigs(client, roleIds),
    kpiEligibility.resolveEligibility(client, { roleIds, isCeo }),
  ]);
  return {
    // `null` pins ≠ `[]` pins — the preference doctrine (never chosen vs chose
    // to clear). Anything that is neither is treated as never-chosen.
    pins: Array.isArray(shell.kpiPins) ? shell.kpiPins : null,
    roleConfigs: roleConfigs.map((c) => ({
      roleCode: c.role_code,
      scopeIds: c.scope_ids, // null = dynamic "everything the role can read"
      defaultIds: c.default_ids || [],
      lockedIds: c.locked_ids || [],
    })),
    eligible: new Set(elig.liveIds),
    isCeo,
  };
}

/** Scope filter for PICKS: any role with a dynamic scope opens the whole
 *  eligible set, otherwise it is the union of the explicit scopes. Role
 *  DEFAULTS bypass scope by construction (the editor stores defaults only
 *  within scope); they pass through the eligibility filter instead, which is
 *  the layer that must hold when grants move under a stored row. */
function scopeFilter(ctx) {
  if (!ctx.roleConfigs.length) return null;
  if (ctx.roleConfigs.some((c) => c.scopeIds === null || c.scopeIds === undefined)) return null;
  return new Set(ctx.roleConfigs.flatMap((c) => c.scopeIds || []));
}

/**
 * The painted band for this request — `{ ...legacy kpis, band }`.
 *
 * The legacy keys ship alongside because the drill-downs still read them
 * (revenue's authoritative total, the overdue payload, SLA inputs) and because
 * one endpoint answering both shapes for one release is cheaper than a client
 * migration that pretends `kpis()` never existed. New consumers read `band`.
 */
async function kpiBand(bizClient, ctx) {
  const legacy = await repo.kpis(bizClient);
  const scope = scopeFilter(ctx);
  const pins = Array.isArray(ctx.pins)
    ? ctx.pins.filter((id) => scope === null || scope.has(id))
    : null;
  const selection = kpiResolve.selectBand({
    pins,
    roleConfigs: ctx.roleConfigs,
    eligible: ctx.eligible,
  });
  const values = await kpiCatalog.valuesFor(bizClient, selection.ids);
  const painted = kpiResolve.paintBand(selection, values);
  // `hidden` reports BOTH causes of a chosen-but-unpainted tile: the pin that
  // lost its grant (dropped by the resolver — the guide's shrink-with-an-
  // explanation), and the selection whose relation is not in this schema
  // (painted as hidden). One list, one count line, no re-derivation client-side.
  const dropped = Array.isArray(ctx.pins)
    ? ctx.pins.filter((id) => !selection.ids.includes(id))
    : [];
  painted.hidden = [...new Set([...dropped, ...painted.hidden])];
  painted.currency = legacy.revenue_currency || "XAF";
  return { ...legacy, band: painted };
}

/**
 * What the picker offers — the same precedence inputs rendered as a choice
 * surface. Availability (does the tile's relation exist in THIS mode) is
 * joined here, once, so the picker can promise that every tile it lists is a
 * tile the band will actually paint — and the count line can explain the rest
 * without enumerating what the tenant lacks.
 */
async function kpiCatalogPayload(bizClient, ctx) {
  const available = await kpiCatalog.availableRelations(bizClient);
  const scope = scopeFilter(ctx);
  // `ctx.eligible` is already live ∩ grants ∩ field-visibility (the eligibility
  // resolver admits nothing else). Two narrows remain: availability in THIS
  // environment — a warehouse tenant's picker does not offer fleet tiles it has
  // no table for — and the role's SCOPE, when the admin narrowed it. Scope
  // governs CHOICE only: role defaults paint from beyond the scope by design
  // (the admin's own four stand even if they outlive a later narrowing).
  // `available` answers RELATION names (the to_regclass probe), tiles speak
  // ids — the join key is the entry's sourceRelation, and it is the one place
  // the two vocabularies meet.
  const offerable = [...ctx.eligible].filter(
    (id) =>
      available.has(kpiCatalog.BY_ID.get(id).sourceRelation) &&
      (scope === null || scope.has(id)),
  );
  const locked = kpiResolve.keepEligible(
    [...new Set(ctx.roleConfigs.flatMap((c) => c.lockedIds))],
    ctx.eligible,
  );
  const defaultIds = kpiResolve.keepEligible(
    ctx.roleConfigs.flatMap((c) => c.defaultIds),
    ctx.eligible,
  );
  const currentIds = Array.isArray(ctx.pins) ? ctx.pins : null;
  const model = kpiResolve.pickerModel({
    eligible: [...ctx.eligible],
    available: offerable,
    locked,
    defaultIds,
    currentIds:
      currentIds === null
        ? null
        : currentIds.filter((id) => (scope === null || scope.has(id)) && ctx.eligible.has(id)),
  });
  return {
    ...model,
    // Which base the picker shows as current, and WHOSE default it restores
    // to — the same precedence the band painted, computed identically.
    source: kpiResolve.selectBand({ pins: ctx.pins, roleConfigs: ctx.roleConfigs, eligible: ctx.eligible }).source,
    roleNames: ctx.roleConfigs.map((c) => c.roleCode).filter(Boolean),
  };
}

/**
 * Attach `from`/`to` coordinates to each live shipment.
 *
 * Additive and best-effort: a lane whose endpoints can't be resolved keeps every
 * existing field and simply carries `coords: null`, so the shipment list is
 * unaffected and the map just omits that one lane. If the whole resolution fails
 * (0478 unapplied, no Geoapify key, provider down) every lane degrades the same
 * way and the Control Tower still renders.
 */
async function withLaneGeometry(client, shipments) {
  if (!Array.isArray(shipments) || !shipments.length) return shipments;

  // Dossiers that used the place picker already carry exact coordinates off the
  // FK join — leave those alone. So does a file whose itinerary has a plottable
  // leg: it has real geometry, and resolving its parent lane by name would spend
  // a fuzzy lookup to draw a line the legs already describe better.
  const needsResolve = shipments.filter(
    (s) => !s.coords && !(Array.isArray(s.legs) && s.legs.some((l) => l.plottable)),
  );
  if (!needsResolve.length) return shipments;

  const places = [];
  needsResolve.forEach((s) => {
    if (s.origin) places.push(s.origin);
    if (s.destination) places.push(s.destination);
  });
  if (!places.length) return shipments;

  let resolved = new Map();
  try {
    resolved = await geoPlace.resolveMany(client, places);
  } catch (err) {
    logger.warn({ err }, "[control-tower] lane geometry unavailable");
    return shipments.map((s) => ({ ...s, coords: null }));
  }

  return shipments.map((s) => {
    if (s.coords) return s; // already exact, off the picker's FK
    const from = s.origin ? resolved.get(s.origin) || null : null;
    const to = s.destination ? resolved.get(s.destination) || null : null;
    return {
      ...s,
      // Both ends required — a single plotted point isn't a lane, and half a
      // route drawn to nowhere is exactly the kind of thing the old hardcoded
      // map did. Callers can still read origin/destination as text.
      coords: from && to ? { from, to } : null,
    };
  });
}

/**
 * Attach each file's structured itinerary.
 *
 * WHY THE MAP NEEDS THIS AND NOT JUST pol/pod. A dossier's POL and POD describe
 * the main carriage and nothing else, so an end-to-end file had two of its six
 * movements recorded anywhere — and the tower drew one line between two ports
 * while the operator was being chased about the truck that had not collected yet.
 * With legs, the same file draws pickup, sail, customs, inland and delivery, each
 * in its own mode's colour.
 *
 * ONE QUERY for the whole page (see `itinerary.forDossiers`), not one per file.
 * Additive and best-effort: a tenant whose 0672 table is missing, or a file with
 * no legs, keeps every existing field and carries `legs: []`, so the tower falls
 * back to the parent POL→POD lane exactly as before.
 */
async function withItineraries(client, shipments) {
  if (!Array.isArray(shipments) || !shipments.length) return shipments;
  const ids = shipments.map((s) => s.dossier_id).filter(Boolean);
  if (!ids.length) return shipments.map((s) => ({ ...s, legs: [] }));

  let byDossier = new Map();
  try {
    byDossier = await itinerary.forDossiers(client, ids);
  } catch (err) {
    logger.warn({ err }, "[control-tower] itinerary legs unavailable");
    return shipments.map((s) => ({ ...s, legs: [] }));
  }
  return shipments.map((s) => ({ ...s, legs: byDossier.get(s.dossier_id) || [] }));
}

module.exports = {
  kpis: (client) => repo.kpis(client),
  bandIdentity,
  kpiBand,
  kpiCatalogPayload,
  async controlTower(client, options = {}) {
    const base = await repo.controlTower(client, options);
    // Order matters: the legs are attached first so `withLaneGeometry` can see
    // that a file already has plottable geometry and skip resolving its parent
    // lane by name — which is the only remaining path that can reach Geoapify
    // from a dashboard load.
    const withLegs = await withItineraries(client, base.live_shipments);
    return { ...base, live_shipments: await withLaneGeometry(client, withLegs) };
  },
};
