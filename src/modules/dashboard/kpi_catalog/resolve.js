/**
 * Which four tiles this user's band paints — pure, synchronous, total.
 *
 * THE PRECEDENCE, stated once because everything downstream obeys it:
 *
 *     user's own pick  >  role defaults  >  the four the tower shipped with
 *
 * with two modifiers. LOCKED tiles from the role config lead the band no
 * matter whose base list is in play — an admin locking "every exec sees the
 * same revenue figure" means it, including against a cleared band. And
 * ELIGIBILITY filters every source without exception: a pin, a default, a
 * seed id the subject cannot read drops out and is REPORTED as hidden, never
 * silently substituted (guide §6.2, "shrink, never pad").
 *
 * WHY `null` PINS MEAN SOMETHING DIFFERENT THAN `[]` PINS. The user-preference
 * doctrine (`preference.service.js`) is that "never chosen" and "chose to
 * clear it" are different facts, and collapsing them makes clearing
 * impossible. A user who removes all four tiles gets an empty band and the
 * picker explains it; only a user who never opened the picker falls through
 * to their roles.
 *
 * WHY THE ROLE MERGE IS CONCATENATION. "Earlier role wins per slot" invites a
 * person to ask which of their roles is "earlier" and find an answer nobody
 * configured. Concatenating each role's defaults in assignment order,
 * deduplicating, and taking four, is the same rule stated without the mystery:
 * your first role's band leads, your second role tops it up.
 *
 * The function does not read the database and cannot fail on the network.
 * The service composes it with eligibility (identity), values (business
 * schema), and this — so the hardest rule in the feature is testable with
 * plain objects, and it is (§kpi-band-resolve.test.js).
 */
"use strict";

const { MAX_BAND_TILES, CATALOG, BY_ID, LIVE_IDS, publicMeta } = require("./index");

/**
 * The fallback band: today's four cards, in today's left-to-right order.
 * Behavior-preserving on upgrade — every tenant that never touches a picker
 * sees what it saw before, modulo the one policy flip (zeros now render,
 * guide §6.3), which is the point of PR-1.
 */
const SYSTEM_DEFAULT_IDS = Object.freeze([
  "revenue",
  "receivables_overdue",
  "sla_on_time",
  "fleet_utilisation",
]);

/** Filter to ids that are live AND eligible, preserving order, deduping. */
function keepEligible(ids, eligible) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    if (typeof id !== "string") continue; // a malformed pin is dropped, not thrown on
    if (seen.has(id)) continue;
    seen.add(id);
    if (!LIVE_IDS.includes(id)) continue;
    if (!eligible.has(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * Pick the ids. Returns { source, ids }. `source` is what the UI explains the
 * band with ("Your choice", "Operations default", "Tower default") and is
 * deliberately part of the payload rather than re-derived client-side — the
 * moment two surfaces compute "who decided" differently is the moment the
 * picker's "Restore role default" starts lying about what it restores.
 */
function selectBand({ pins, roleConfigs = [], eligible }) {
  const locked = keepEligible(
    [...new Set(roleConfigs.flatMap((c) => c.lockedIds || []))],
    eligible,
  );
  const putFirst = (ids) => [...locked, ...(ids || []).filter((id) => !locked.includes(id))];

  if (Array.isArray(pins)) {
    return { source: "user", ids: putFirst(keepEligible(pins, eligible)).slice(0, MAX_BAND_TILES) };
  }

  const merged = keepEligible(
    roleConfigs.map((c) => (c && c.defaultIds) || []).flat(),
    eligible,
  );
  if (merged.length) {
    return { source: "role", ids: putFirst(merged).slice(0, MAX_BAND_TILES) };
  }

  // A user with no pins, whose roles have no config, on a tenant that cannot
  // read a single tile: empty band, `source` still truthful. The four seeded
  // ids only reach a subject that can actually read them.
  const fallback = keepEligible(SYSTEM_DEFAULT_IDS, eligible);
  return { source: "default", ids: putFirst(fallback).slice(0, MAX_BAND_TILES) };
}

/**
 * Turn the selection + resolved values into renderable slots + the honest
 * "hidden" list.
 *
 * A value of null is UNAVAILABLE (guard failed: module not installed in this
 * schema) and the slot drops out — shrink, not zero. A numeric 0 is an
 * asserted zero and renders. Ratio tiles keep their denominator so the card
 * can say 0 % truthfully, over nothing measurable, with the hint line naming
 * the source (§6.4). `hidden` lists what fell out, so the picker footer can
 * tell the user the count and the reason — absence explained beats absence
 * inferred.
 */
function paintBand(selection, values) {
  const slots = [];
  const hidden = [];
  for (const id of selection.ids) {
    const raw = values[id];
    if (raw === null || raw === undefined) {
      hidden.push(id);
      continue;
    }
    const entry = BY_ID.get(id);
    const slot = { ...publicMeta(entry), value: raw, denominator: null, measurable: true };
    if (typeof raw === "object") {
      slot.value = raw.value;
      slot.denominator = raw.denominator;
      slot.measurable = raw.denominator > 0;
    }
    slots.push(slot);
  }
  return { source: selection.source, slots, hidden };
}

/**
 * Everything the PICKER needs to be honest, from one call.
 *
 * Offered tiles are live ∩ eligible (∩ available when the service passes it)
 * — "not dimmed, not listed" (§4.1). Counted-out tiles (hiddenFromPicker)
 * are reported as a number, not enumerated: the line is "showing 12 of 15 —
 * the rest belong to modules you don't have," and an enumeration would leak
 * the shape of what the tenant does not have, which the grants leak no more
 * of than this.
 */
function pickerModel({ eligible, available = null, locked = [], defaultIds = [], currentIds }) {
  const offerable = CATALOG.filter(
    (e) =>
      e.status === "live" &&
      eligible.includes(e.id) &&
      (available === null || available.includes(e.id)),
  ).map(publicMeta);
  const liveEligible = CATALOG.filter(
    (e) => e.status === "live" && eligible.includes(e.id),
  ).length;
  return {
    maxTiles: MAX_BAND_TILES,
    tiles: offerable,
    lockedIds: locked,
    roleDefaultIds: defaultIds,
    currentIds:
      currentIds === null || currentIds === undefined
        ? null
        : keepEligible(currentIds, new Set(offerable.map((t) => t.id))),
    hiddenTileCount: Math.max(0, liveEligible - offerable.length),
    totalLive: CATALOG.filter((e) => e.status === "live").length,
  };
}

module.exports = {
  MAX_BAND_TILES,
  SYSTEM_DEFAULT_IDS,
  keepEligible,
  selectBand,
  paintBand,
  pickerModel,
};
