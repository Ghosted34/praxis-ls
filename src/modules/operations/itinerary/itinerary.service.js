/**
 * The itinerary: what a file's cargo actually does, leg by leg.
 *
 * WHY THIS EXISTS ALONGSIDE pol/pod. A dossier's POL and POD describe the main
 * carriage and nothing else, so an end-to-end file — collect from the shipper's
 * yard, export customs, sail, import customs, truck inland, deliver to the door —
 * had exactly two of its six movements recorded anywhere. The Control Tower drew
 * a single line between two ports and the four legs an operator is actually
 * chased about were invisible.
 *
 * THE SERVICE TYPE PROPOSES, THE FILE DECIDES. `service_type.itinerary_template`
 * (0673) says what a Sea Import usually looks like; the instance is editable,
 * because the exceptions are the job. What the template DOES bind is which legs
 * are structural: a Sea Import without a main carriage is not a Sea Import, and
 * `assertTemplateLegsPresent` is where that is enforced.
 */
"use strict";

const repo = require("./itinerary.repo");
const geoPlace = require("../geo_place/geo_place.service");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/* ── read side ────────────────────────────────────────────────────────────── */

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One endpoint of a leg, as the map and the panel read it.
 *
 * `state` is the honest per-endpoint verdict, and the four values are the same
 * four the picker's badge shows, so a leg on the map and the same leg in the
 * dossier form cannot disagree about what is known:
 *
 *   verified    a confirmed place with a coordinate — plottable, and true
 *   reference   plottable, and explicitly NOT the exact spot
 *   unverified  plottable, but nobody ever looked at the coordinate
 *   unknown     text only. NOT plottable, and the map must not invent a point.
 */
function endpointOf(leg, side) {
  const p = (k) => leg[`${side}_${k}`];
  const latitude = num(p("latitude"));
  const longitude = num(p("longitude"));
  const hasPoint = latitude !== null && longitude !== null;
  const state = !hasPoint
    ? "unknown"
    : p("is_reference_point")
      ? "reference"
      : p("verified_at")
        ? "verified"
        : "unverified";
  return {
    // The leg's own text is the label of record — it is what the operator typed
    // or picked, and what every document prints. The place's name is the
    // fallback for a leg that carries only a reference.
    name: leg[side] || p("place_name") || null,
    place_id: leg[`${side}_place_id`] || null,
    kind: p("kind") || null,
    unlocode: p("unlocode") || null,
    latitude,
    longitude,
    state,
  };
}

/**
 * A leg, projected.
 *
 * `plottable` is computed once here rather than in the browser, because it is the
 * rule that stops the map lying: BOTH ends must resolve to a coordinate. One end
 * is not a leg, and a line drawn from a real port to an assumed point is exactly
 * the fabricated route the old hardcoded map drew.
 */
function projectLeg(leg) {
  const origin = endpointOf(leg, "origin");
  const destination = endpointOf(leg, "destination");
  return {
    itinerary_leg_id: leg.itinerary_leg_id,
    dossier_id: leg.dossier_id,
    seq: num(leg.seq),
    leg_type: leg.leg_type,
    mode: leg.mode,
    status: leg.status,
    is_optional: leg.is_optional === true,
    source: leg.source || "MANUAL",
    planned_departure: leg.planned_departure || null,
    planned_arrival: leg.planned_arrival || null,
    actual_departure: leg.actual_departure || null,
    actual_arrival: leg.actual_arrival || null,
    provider_id: leg.provider_id || null,
    provider_name: leg.provider_name || null,
    notes: leg.notes || null,
    milestone_instance_id: leg.milestone_instance_id || null,
    // THE TEXT, under the same key the write shape uses. The nested projections
    // ride alongside under `*_endpoint` rather than replacing them, because the
    // editor reads a leg and writes it straight back: if `origin` were an object
    // on the way out and a string on the way in, every save would be rejected by
    // the validator, and the round trip is the whole point of an editor.
    origin: leg.origin || null,
    destination: leg.destination || null,
    origin_place_id: leg.origin_place_id || null,
    destination_place_id: leg.destination_place_id || null,
    origin_endpoint: origin,
    destination_endpoint: destination,
    plottable: origin.latitude !== null && destination.latitude !== null,
    // "Is anything about this leg's geography unresolved?" — one boolean for the
    // location-needed queue, so the queue and the map agree by construction.
    needs_location: origin.state === "unknown" || destination.state === "unknown",
  };
}

async function list(client, dossierId) {
  return (await repo.list(client, dossierId)).map(projectLeg);
}

/** Legs for many dossiers, grouped by dossier id — the Control Tower's shape. */
async function forDossiers(client, dossierIds) {
  const rows = await repo.listForDossiers(client, dossierIds);
  const byDossier = new Map();
  for (const row of rows) {
    const leg = projectLeg(row);
    if (!byDossier.has(leg.dossier_id)) byDossier.set(leg.dossier_id, []);
    byDossier.get(leg.dossier_id).push(leg);
  }
  return byDossier;
}

/* ── write side ───────────────────────────────────────────────────────────── */

/** Leg types that describe an ACTIVITY at a place rather than a movement between
 *  two. Their destination is optional by nature — a customs clearance happens at
 *  one location, and demanding a second would be asking for invented data. */
const SINGLE_POINT_LEGS = new Set(["CUSTOMS", "WAREHOUSE", "OTHER"]);

/** A leg type's own label, for a validation message a person can act on. */
const LEG_LABEL = {
  PICKUP: "Pickup",
  MAIN_CARRIAGE: "Main carriage",
  CUSTOMS: "Customs",
  INLAND_TRANSIT: "Inland transit",
  WAREHOUSE: "Warehouse",
  FINAL_DELIVERY: "Final delivery",
  OTHER: "Other",
};

const legLabel = (type) => LEG_LABEL[type] || type;

/**
 * The service type's structural legs must survive an edit.
 *
 * WHY. The template is a proposal, and the editor is free to add, remove and
 * reorder — that is the whole point of having an instance. But a Sea Import with
 * its main carriage deleted is not an edited Sea Import, it is a file whose
 * service type no longer describes it, and everything downstream (the milestone
 * chain, the documents, the costing) still assumes it does. So the legs the
 * template did NOT mark optional are required, and removing one is refused with
 * the leg named.
 *
 * A service type with no template constrains nothing, which is correct: Project
 * Cargo is configurable by design and Business Representation has no route at
 * all.
 */
async function assertTemplateLegsPresent(client, dossierId, legs) {
  let template = [];
  try {
    const { rows } = await client.query(
      "SELECT st.itinerary_template FROM dossier d " +
        "JOIN service_type st ON st.service_type_id = d.service_type_id WHERE d.dossier_id = $1",
      [dossierId],
    );
    template = Array.isArray(rows[0] && rows[0].itinerary_template) ? rows[0].itinerary_template : [];
  } catch (err) {
    // A file with no service type, or a tenant whose 0673 column is absent. The
    // edit is allowed: this rule exists to protect a declared shape, and there
    // is no declared shape to protect.
    logger.warn({ err, dossierId }, "[itinerary] template not readable; structural legs not enforced");
    return;
  }
  const required = template.filter((t) => t && t.is_optional !== true).map((t) => t.leg_type);
  if (!required.length) return;

  const present = new Set((legs || []).map((l) => l.leg_type));
  const missing = [...new Set(required)].filter((type) => !present.has(type));
  if (!missing.length) return;

  throw new AppError(
    "ITINERARY_LEG_REQUIRED",
    `This service type requires ${missing.map(legLabel).join(" and ")}. ` +
      "Add the leg back, or change the file's service type if the shape is genuinely different.",
    422,
    { legs: missing.map((type) => `${legLabel(type)} is required by this service type`) },
  );
}

/**
 * Every place a leg names must be a place we know, and each leg must make sense
 * as a movement.
 *
 * SAME RULE AS THE DOSSIER'S OWN ORIGIN AND DESTINATION, and for the same
 * reason: this is where a route on the meeting-room map comes from. The
 * difference is that a leg may legitimately carry NO location at all — an
 * optional customs leg on a file whose broker has not confirmed where it will
 * clear — so blank is allowed and unverified is not.
 *
 * Errors are keyed by leg INDEX (`legs.0.origin`), which is what lets the editor
 * mark the offending row rather than showing one message above the whole form.
 */
async function assertLegsResolvable(client, legs) {
  const wanted = [];
  (legs || []).forEach((l) => {
    if (l.origin) wanted.push(l.origin);
    if (l.destination) wanted.push(l.destination);
  });
  const resolved = wanted.length ? await geoPlace.resolveVerified(client, wanted) : new Map();

  const fields = {};
  (legs || []).forEach((l, i) => {
    const check = (side) => {
      const value = l[side];
      if (!value) return;
      // An explicit place reference is proof in itself — the editor sends both
      // the id and the name, and the id came from the picker.
      if (l[`${side}_place_id`]) return;
      if (resolved.get(String(value).trim())) return;
      fields[`legs.${i}.${side}`] = [
        `"${value}" is not a place in the catalogue yet. Pick it from the place search, or add it there first.`,
      ];
    };
    check("origin");
    check("destination");

    // A movement leg with an origin and no destination (or the reverse) cannot be
    // drawn and cannot be planned against. Activity legs are exempt by nature.
    if (!SINGLE_POINT_LEGS.has(l.leg_type)) {
      const hasOrigin = !!(l.origin || l.origin_place_id);
      const hasDestination = !!(l.destination || l.destination_place_id);
      if (hasOrigin !== hasDestination) {
        fields[`legs.${i}.${hasOrigin ? "destination" : "origin"}`] = [
          `${legLabel(l.leg_type)} moves cargo between two places — give it both ends, or leave both blank until they are known.`,
        ];
      }
    }

    if (l.planned_departure && l.planned_arrival && l.planned_arrival < l.planned_departure) {
      fields[`legs.${i}.planned_arrival`] = ["Planned arrival cannot be before planned departure."];
    }
    if (l.actual_departure && l.actual_arrival && l.actual_arrival < l.actual_departure) {
      fields[`legs.${i}.actual_arrival`] = ["Actual arrival cannot be before actual departure."];
    }
  });

  const keys = Object.keys(fields);
  if (keys.length) {
    throw new AppError(
      "ITINERARY_INVALID",
      keys.length === 1
        ? "One leg needs attention before this itinerary can be saved."
        : `${keys.length} legs need attention before this itinerary can be saved.`,
      422,
      fields,
    );
  }
}

/**
 * Save an itinerary.
 *
 * PLACE REFERENCES ARE FILLED FROM THE CATALOGUE, not geocoded. The previous
 * version called `geoPlace.resolveMany`, which reaches Geoapify on a miss — so
 * saving an itinerary could silently invent a coordinate for a mistyped place,
 * the exact failure the dossier's own save path was fixed to stop doing. Now the
 * value must already BE a catalogue place (validated above) and the id is looked
 * up locally.
 */
async function replace(client, dossierId, legs) {
  await assertLegsResolvable(client, legs);
  await assertTemplateLegsPresent(client, dossierId, legs);

  const wanted = (legs || []).flatMap((l) => [l.origin, l.destination]).filter(Boolean);
  const found = wanted.length ? await geoPlace.resolveVerified(client, wanted) : new Map();
  const resolved = (legs || []).map((l) => {
    const idOf = (side) => {
      if (l[`${side}_place_id`]) return l[`${side}_place_id`];
      const hit = l[side] ? found.get(String(l[side]).trim()) : null;
      return (hit && hit.geo_place_id) || null;
    };
    return { ...l, origin_place_id: idOf("origin"), destination_place_id: idOf("destination") };
  });

  return (await repo.replace(client, dossierId, resolved)).map(projectLeg);
}

/**
 * Where each leg type starts and ends, in terms of the dossier's OWN place
 * columns. `null` means "this leg type has no opinion" and the walk below falls
 * back to where the cargo currently is.
 *
 * These four columns are the whole geographic vocabulary of a file, and 0678
 * finished giving every freight service type a field for each one it needs:
 *
 *   place_receipt   COLLECTION      the shipper's door
 *   pol             ORIGIN          the main carriage's start
 *   pod             DESTINATION     …its end (ROUTE_VIA on a door-to-door file)
 *   place_delivery  FINAL_DELIVERY  the consignee's door
 */
const LEG_ENDS = {
  PICKUP: ["place_receipt", "pol"],
  MAIN_CARRIAGE: ["pol", "pod"],
  INLAND_TRANSIT: ["pod", "place_delivery"],
  FINAL_DELIVERY: ["pod", "place_delivery"],
};

/**
 * Instantiate a service type's template onto a new file.
 *
 * Called from `operations_file` at promotion. Legs are marked `source:'TEMPLATE'`
 * so the editor can say where they came from and the required-leg rule knows
 * which ones it may insist on.
 *
 * ── THE WALK, AND WHY IT IS A WALK ──────────────────────────────────────────
 *
 * This used to fill the main carriage from POL/POD and leave every other leg
 * blank. That was defensible while POL and POD were the only verified places a
 * file had — but it meant a door-to-door file opened with four of its five legs
 * empty, and the create wizard grew its own "collect from the shipper" and
 * "deliver to the consignee" pickers to compensate. Those pickers then APPENDED
 * legs, on top of the ones the template had already produced: two PICKUPs, two
 * FINAL_DELIVERYs, and a delivery address that could differ between the dossier
 * column and the leg.
 *
 * So the template is instantiated as a JOURNEY instead. A cursor follows the
 * cargo, each leg starts where the last one ended, and a leg's own preference
 * (`LEG_ENDS`) overrides the cursor when the file names the place — an inland
 * transit begins at the port of entry, not back at the load port. Every place
 * comes from a field an operator filled in once, so the wizard has nothing left
 * to ask and the itinerary cannot disagree with the file.
 *
 * ── THE TWO RULES THAT KEEP IT HONEST ───────────────────────────────────────
 *
 *   1. BOTH ENDS OR NEITHER. `assertLegsResolvable` refuses a movement leg with
 *      one end, and rightly: half a leg cannot be drawn or planned against. So a
 *      leg whose target the file does not name stays entirely blank rather than
 *      carrying a dangling origin.
 *   2. A LEG THAT MOVES NOTHING GETS NO PLACES. When a leg's target is where the
 *      cargo already is, filling it would draw a second line between the same two
 *      points — which is what a hinterland file would get, its optional
 *      FINAL_DELIVERY duplicating the inland transit that already ends at the
 *      final destination.
 *
 * Activity legs (customs, warehousing) are pinned to where the cargo is and carry
 * no destination: a clearance happens at one place, and inventing a second end so
 * the shape matches a movement leg is how a customs leg ends up drawn as a
 * journey. `SINGLE_POINT_LEGS` exempts them from rule 1.
 *
 * Every place named here has already been verified by `shipment_details`
 * (a movement file cannot be opened otherwise), so the seeded route is plottable
 * on first render rather than after somebody edits it.
 */
function legsFromTemplate(template, dossier) {
  const place = (column) => {
    const value = dossier && dossier[column];
    const text = value === null || value === undefined ? "" : String(value).trim();
    return text || null;
  };
  // Where the cargo starts: the shipper's door when the file names one, else the
  // load port. A file that names neither has no geography yet and every leg comes
  // out blank, which is the correct answer rather than a guess.
  let cursor = place("place_receipt") || place("pol");

  return (Array.isArray(template) ? template : []).map((t) => {
    const leg = {
      leg_type: t.leg_type,
      mode: t.mode || "OTHER",
      is_optional: t.is_optional === true,
      status: "PLANNED",
      source: "TEMPLATE",
      origin: null,
      destination: null,
    };

    if (SINGLE_POINT_LEGS.has(t.leg_type)) {
      // Pinned to where the cargo is, and no further: the cursor does not move,
      // because clearing customs is not a movement.
      leg.origin = cursor;
      return leg;
    }

    const ends = LEG_ENDS[t.leg_type];
    if (!ends) return leg;
    const from = place(ends[0]) || cursor;
    const to = place(ends[1]);
    if (!from || !to) return leg;
    // Rule 2, and it is checked against the CURSOR rather than against `from`:
    // a hinterland file's optional final delivery prefers to start at the port of
    // entry, but its inland transit has already carried the cargo to the final
    // destination — so the test that matters is "has the cargo arrived", not
    // "are this leg's two ends different".
    if (to === cursor || to === from) return leg;

    leg.origin = from;
    leg.destination = to;
    cursor = to;
    return leg;
  });
}

module.exports = {
  list,
  forDossiers,
  replace,
  legsFromTemplate,
  projectLeg,
  LEG_TYPES: repo.LEG_TYPES,
  MODES: repo.MODES,
  STATUSES: repo.STATUSES,
  SOURCES: repo.SOURCES,
  LEG_LABEL,
};
