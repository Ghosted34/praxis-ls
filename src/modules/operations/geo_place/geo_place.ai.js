/**
 * AI action manifest (AI_ARCHITECTURE §2) for geo places (MOD-29).
 *
 * Ports, borders, terminals and delivery points — the vocabulary a transit
 * order and a delivery note are written in. "Is Douala port already in our
 * places" and "add this border post" are both natural to ask, and neither was
 * reachable.
 *
 * `resolveMany` / `resolveVerified` are absent: they are the batch resolvers the
 * intake pipeline calls with an array of raw strings, not an operator action.
 */
"use strict";

const service = require("./geo_place.service");
const validator = require("./geo_place.validator");

const MOD = "MOD-29";

module.exports = {
  entity: "geo_place",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_geo_places", service: service.list, permission: { module: MOD, action: "view" }, describe: "List the tenant's known places (ports, borders, terminals, delivery points)." },
    { key: "search_geo_places", service: (c, p) => service.search(c, p || {}), permission: { module: MOD, action: "view" }, describe: "Search places by name and country. `provider: true` also asks the geocoder for candidates that are not saved yet." },
  ],

  writes: [
    {
      key: "create_geo_place",
      service: (c, p, actor) => service.createManual(c, { name: p.name, latitude: p.latitude, longitude: p.longitude, country: p.country, kind: p.kind, region: p.region, unlocode: p.unlocode, formatted: p.formatted, isReferencePoint: p.is_reference_point, actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Add a place by hand, with its coordinates — for somewhere the geocoder does not know.",
    },
    {
      key: "confirm_geo_place",
      service: (c, p, actor) => service.confirmSuggestion(c, { query: p.query, providerPlaceId: p.provider_place_id, country: p.country, kind: p.kind, isReferencePoint: p.is_reference_point, actor }),
      schema: validator.schemas.confirm,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Save a geocoder suggestion as a known place, so the next search finds it without asking the provider.",
    },
  ],
};
