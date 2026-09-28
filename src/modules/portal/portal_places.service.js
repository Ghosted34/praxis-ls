/**
 * Places for the client portal's quote sheet — what a client may be offered
 * while typing a route, and how what they picked becomes a verified place.
 *
 * ── THE SAME ENGINE AS THE OPERATOR PICKER, WITH A DIFFERENT AUDIENCE ─────
 *
 * The desk's PlacePicker (client/src/components/operations/place-picker.tsx)
 * is the model: the catalogue answers every keystroke, a worldwide search
 * fills what the catalogue lacks, and a provider suggestion becomes a place
 * only when the SERVER re-asks the provider and takes its coordinate. What
 * changes here is who is asking, and that changes three things:
 *
 *   1. THE CATALOGUE IS FILTERED TO SHARED INFRASTRUCTURE. `geo_place` holds
 *      the desk's customer doors — a consignee's yard, a named client's
 *      warehouse. Offered unfiltered, three letters typed into a portal would
 *      enumerate another client's addresses. So the catalogue half answers only
 *      PUBLIC_KINDS (ports, airports, terminals, border posts, cities), and only
 *      places a human confirmed at the exact spot. A client's own addresses
 *      come back through `recent`, which is scoped to their client_id.
 *
 *   2. PROVIDER FAILURES ARE ONE FACT. "Add a Geoapify key in the Platform
 *      Console" is a sentence for an operator; a client can act on none of the
 *      five provider statuses. They collapse to UNAVAILABLE exactly as the
 *      public quote wizard's do (geo_place_public.service), and the sheet keeps
 *      taking typed text.
 *
 *   3. FREE TEXT IS ALLOWED, AND IS HONEST ABOUT IT. The operator picker refuses
 *      free text because an unverified place on a FILE misroutes a shipment.
 *      A quote REQUEST is a question to the desk, and refusing to send one
 *      because a supplier's yard is not on any map loses the enquiry to a
 *      nicety. So a typed place travels as text with no pin, and the desk pins
 *      it when the request becomes a file.
 *
 * ── RESOLVING A PICK NEVER COSTS THE REQUEST ──────────────────────────────
 *
 * `resolvePick` never throws, same contract as public_intake.resolvePlace: a
 * provider timeout at submit drops the pin and keeps the text the client
 * chose, which is what the desk reads anyway.
 */
"use strict";

const repo = require("./portal_places.repo");
const geoRepo = require("../operations/geo_place/geo_place.repo");
const geoPlace = require("../operations/geo_place/geo_place.service");
const geoPublic = require("../operations/geo_place_public/geo_place_public.service");
const { logger } = require("../../config/logger");

/**
 * Kinds that are shared geography rather than somebody's premises. WAREHOUSE,
 * ADDRESS and OTHER are absent on purpose: on this product they are the desk's
 * customer doors (see the header).
 */
const PUBLIC_KINDS = ["SEAPORT", "AIRPORT", "TERMINAL", "RAIL_TERMINAL", "BORDER_POST", "INLAND", "CITY"];

/** The requested kinds a catalogue search may answer: the public ones, narrowed
 *  further by the field when it asked (an airport field asks for AIRPORT). */
function catalogueKinds(kinds) {
  if (!Array.isArray(kinds) || !kinds.length) return PUBLIC_KINDS;
  return kinds.filter((k) => PUBLIC_KINDS.includes(k));
}

/** What a client reads about a place — never provenance, confidence or the
 *  provider's id, which describe the desk's trust in a row, not the row. */
function toPlace(row) {
  return {
    geo_place_id: row.geo_place_id,
    name: row.name,
    country: row.country || null,
    region: row.region || null,
    kind: row.kind || null,
    unlocode: row.unlocode || null,
    formatted: row.formatted || null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  };
}

const NOT_REQUESTED = { requested: false, status: "NOT_REQUESTED", results: [] };

/**
 * The database half: catalogue matches, the client's own places, and — with
 * nothing typed yet — the tenant's popular ones.
 *
 * Kept apart from the provider half so the controller can release the tenant
 * connection before the HTTP wait; a slow provider must not hold a pool slot.
 */
async function searchLocal(client, { clientId, q = "", kinds = null, limit = 8 }) {
  const term = String(q || "").trim();
  const allowed = catalogueKinds(kinds);
  const [catalogue, recent, popular] = await Promise.all([
    term && allowed.length
      ? geoRepo.search(client, { q: term, kinds: allowed, limit, confirmedOnly: true })
      : Promise.resolve([]),
    repo.recentPlaces(client, clientId, {
      kinds: Array.isArray(kinds) && kinds.length ? kinds : null,
      q: term || null,
      limit: term ? 3 : 5,
    }),
    // Popular only answers the empty box: once they type, what they typed is
    // the better guess than what everybody else ships.
    term || !allowed.length ? Promise.resolve([]) : repo.popularPlaces(client, { kinds: allowed, limit: 5 }),
  ]);

  // A place shows once, in the group that says the most about it: theirs
  // first, then the catalogue, then the tenant's popular list.
  const seen = new Set(recent.map((r) => r.geo_place_id));
  const places = catalogue.filter((p) => !seen.has(p.geo_place_id));
  places.forEach((p) => seen.add(p.geo_place_id));
  const pop = popular.filter((p) => !seen.has(p.geo_place_id));

  const key = geoRepo.normalise(term);
  const code = term.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const hasExact =
    !!key &&
    [...recent, ...catalogue].some(
      (p) => geoRepo.normalise(p.name) === key || (p.unlocode && p.unlocode === code),
    );

  return {
    places: places.map(toPlace),
    recent: recent.map(toPlace),
    popular: pop.map(toPlace),
    has_exact: hasExact,
  };
}

/**
 * The provider half, asked only when the caller wants it and the catalogue
 * has no exact answer — the rule that keeps "Douala" from spending a request
 * to re-derive a port the catalogue already holds.
 */
async function withProvider(local, { q = "", country = null, provider = false }) {
  const term = String(q || "").trim();
  if (!provider || local.has_exact || !term) return { ...local, provider: NOT_REQUESTED };
  const found = await geoPublic.search(term, { country, limit: 6 });
  // Fold out what the lists above already show, as the operator search does:
  // "Douala" as a new suggestion beside the Douala they can already pick is
  // the duplicate that makes a picker feel untrustworthy.
  const known = new Set([...local.places, ...local.recent].map((p) => geoRepo.normalise(p.name)));
  const results = found.results.filter((c) => !known.has(geoRepo.normalise(geoPlace.labelFor(c))));
  return { ...local, provider: { requested: true, status: found.status, results } };
}

/**
 * One pick → the verified place behind it, or null. NEVER throws.
 *
 * Two shapes arrive:
 *   { geo_place_id }  a place the client was offered. Re-checked here rather
 *                     than trusted — the id must be shared infrastructure, or
 *                     one of this client's own places. Any other id is dropped,
 *                     so a guessed uuid cannot hang another client's door on a
 *                     request.
 *   { provider_place_id, query, country? }
 *                     a worldwide suggestion. `confirmSuggestion` re-queries the
 *                     provider and stores ITS coordinate, with provenance naming
 *                     who confirmed it — a client, not an operator.
 */
async function resolvePick(client, { clientId, pick, label }) {
  if (!pick) return null;
  try {
    if (pick.geo_place_id) {
      const row = await repo.placeById(client, pick.geo_place_id);
      if (!row || !row.is_active) return null;
      const shared = PUBLIC_KINDS.includes(row.kind) && !!row.verified_at && !row.is_reference_point;
      if (shared || (await repo.clientHasPlace(client, clientId, row.geo_place_id))) return row;
      logger.warn({ label }, "[portal_places] a picked place is neither shared nor the client's own — dropped");
      return null;
    }
    if (pick.provider_place_id) {
      return await geoPlace.confirmSuggestion(client, {
        query: pick.query,
        providerPlaceId: pick.provider_place_id,
        country: pick.country || null,
        confirmedBy: "a client, in the portal",
        actor: {},
      });
    }
  } catch (err) {
    logger.warn(
      { err: { message: err && err.message, code: err && err.code }, label },
      "[portal_places] could not resolve the picked place — filing the request without a pin",
    );
  }
  return null;
}

/** The four ends of a quote route, as the quote_request row stores them. */
const ENDS = [
  { pick: "origin_place", text: "origin_location", id: "origin_place_id" },
  { pick: "destination_place", text: "destination_location", id: "destination_place_id" },
  { pick: "collection_place", text: "collection_location", id: "collection_place_id" },
  { pick: "delivery_place", text: "delivery_location", id: "delivery_place_id" },
];

/**
 * Resolve every pick on a portal quote and return the columns to write: each
 * end's place id, and its text — what the client chose, or the place's own
 * name when they picked without the text arriving.
 *
 * Runs BEFORE the quote's transaction opens (see portal.service): each provider
 * pick is an HTTP call, and a transaction held across one is how a slow
 * provider becomes pool exhaustion.
 */
async function resolveQuotePlaces(client, { clientId, data }) {
  const rows = await Promise.all(
    ENDS.map((end) => resolvePick(client, { clientId, pick: data[end.pick], label: end.pick })),
  );
  const out = {};
  ENDS.forEach((end, i) => {
    const row = rows[i];
    const text = String(data[end.text] || "").trim();
    out[end.id] = row ? row.geo_place_id : null;
    out[end.text] = text || (row ? row.name : null);
  });
  return out;
}

module.exports = {
  searchLocal,
  withProvider,
  resolvePick,
  resolveQuotePlaces,
  PUBLIC_KINDS,
  catalogueKinds,
  toPlace,
};
