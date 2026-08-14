/**
 * The itinerary's write path: verified places, structural legs, date order, and
 * the transaction that stops a failed save destroying the route.
 *
 * ── THE ONE THAT MATTERS MOST ───────────────────────────────────────────────
 *
 * `replace` is a DELETE followed by INSERTs, and it was neither wrapped in a
 * transaction nor validated. So a leg that violated a CHECK constraint on insert
 * left the dossier with NO ITINERARY AT ALL — the whole route silently gone,
 * while the operator looked at a save error that said nothing about it. The
 * "rolls back" tests below are that fix.
 *
 * ── THE SECOND ──────────────────────────────────────────────────────────────
 *
 * Saving used to call `geoPlace.resolveMany`, which reaches Geoapify on a miss.
 * So an itinerary could silently invent a coordinate for a mistyped place — the
 * exact failure the dossier's own save path was fixed to stop. A leg's place must
 * now already BE in the catalogue, and the lookup is local.
 */
"use strict";

jest.mock("../../src/services/geoapify.service", () => ({
  searchPlaces: jest.fn(),
  forwardGeocode: jest.fn(),
  MAX_RESULTS: 10,
  MIN_QUERY_CHARS: 3,
}));

const geoapify = require("../../src/services/geoapify.service");
const itinerary = require("../../src/modules/operations/itinerary/itinerary.service");
const repo = require("../../src/modules/operations/geo_place/geo_place.repo");

/** The catalogue, as `query_key -> display name`. */
const CATALOGUE = new Map([
  ["douala", "Douala"],
  ["shanghai", "Shanghai"],
  ["yaounde", "Yaoundé"],
  ["antwerp", "Antwerp"],
]);

/**
 * A tenant client modelling the four queries this path issues: the catalogue
 * lookup, the service type's template, the DELETE and the INSERT. Throws on
 * anything else, so a new query cannot silently return nothing.
 */
function fakeClient({ template = [], failOnInsertSeq = null, known = CATALOGUE } = {}) {
  const state = { sql: [], inserted: [], deleted: 0, tx: [], rows: [] };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);

      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) {
        state.tx.push(s.toUpperCase());
        return { rows: [] };
      }
      if (/FROM geo_place WHERE query_key = ANY/i.test(s)) {
        return {
          rows: params[0]
            .filter((k) => known.has(k))
            .map((k) => ({ geo_place_id: `gp-${k}`, query_key: k, name: known.get(k), latitude: "4.0", longitude: "9.7", verified_at: "2026-01-01T00:00:00.000Z" })),
        };
      }
      if (/itinerary_template FROM dossier/i.test(s)) {
        return { rows: [{ itinerary_template: template }] };
      }
      if (/^DELETE FROM dossier_itinerary_leg/i.test(s)) {
        state.deleted += 1;
        state.rows = [];
        return { rows: [] };
      }
      if (/^INSERT INTO dossier_itinerary_leg/i.test(s)) {
        const seq = params[1];
        if (failOnInsertSeq !== null && seq === failOnInsertSeq) {
          const err = new Error('new row for relation "dossier_itinerary_leg" violates check constraint');
          err.code = "23514";
          throw err;
        }
        state.inserted.push({ seq, leg_type: params[2], mode: params[3], origin: params[4], destination: params[5], origin_place_id: params[6], destination_place_id: params[7], source: params[16] });
        state.rows.push({ itinerary_leg_id: `l-${seq}`, dossier_id: params[0], seq, leg_type: params[2], mode: params[3], origin: params[4], destination: params[5], origin_place_id: params[6], destination_place_id: params[7], status: params[12], source: params[16], is_optional: params[15] });
        return { rows: [] };
      }
      if (/FROM dossier_itinerary_leg l/i.test(s)) return { rows: state.rows };
      throw new Error("fakeClient: unmodelled SQL: " + s.slice(0, 140));
    },
  };
}

const leg = (over = {}) => ({ leg_type: "MAIN_CARRIAGE", mode: "SEA", origin: "Shanghai", destination: "Douala", ...over });

beforeEach(() => jest.clearAllMocks());

describe("places on a leg", () => {
  test("a catalogue place is accepted and its reference filled in", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg()]);
    expect(c.state.inserted[0]).toMatchObject({
      origin: "Shanghai",
      destination: "Douala",
      origin_place_id: "gp-shanghai",
      destination_place_id: "gp-douala",
    });
  });

  test("a typo is REFUSED, keyed to the leg it is on", async () => {
    const c = fakeClient();
    const err = await itinerary.replace(c, "d-1", [leg(), leg({ origin: "Doula" })]).catch((e) => e);
    expect(err.code).toBe("ITINERARY_INVALID");
    expect(err.status).toBe(422);
    // The index is what lets the editor mark the offending row rather than
    // printing one message above the whole form.
    expect(Object.keys(err.details)).toEqual(["legs.1.origin"]);
  });

  test("nothing is written when a place is unverified", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg({ origin: "Doula" })]).catch(() => {});
    expect(c.state.deleted).toBe(0);
    expect(c.state.inserted).toEqual([]);
  });

  test("a blank location is fine — an unplanned leg is not an invalid one", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg({ leg_type: "CUSTOMS", mode: "OTHER", origin: null, destination: null })]);
    expect(c.state.inserted).toHaveLength(1);
  });

  test("an explicit place reference is proof in itself", async () => {
    // The editor sends both the id and the name; the id came from the picker.
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg({ origin: "Somewhere New", origin_place_id: "gp-new" })]);
    expect(c.state.inserted[0].origin_place_id).toBe("gp-new");
  });

  test("it NEVER geocodes — a save must not invent a coordinate", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg()]);
    expect(geoapify.forwardGeocode).not.toHaveBeenCalled();
    expect(geoapify.searchPlaces).not.toHaveBeenCalled();
  });

  test("a movement leg with one end is refused, naming the missing end", async () => {
    const c = fakeClient();
    const err = await itinerary.replace(c, "d-1", [leg({ destination: null })]).catch((e) => e);
    expect(err.details["legs.0.destination"][0]).toMatch(/both ends/);
  });

  test("…but an activity leg happens at ONE place by nature", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg({ leg_type: "WAREHOUSE", mode: "OTHER", destination: null })]);
    expect(c.state.inserted).toHaveLength(1);
  });
});

describe("dates", () => {
  test("planned arrival cannot precede planned departure", async () => {
    const c = fakeClient();
    const err = await itinerary
      .replace(c, "d-1", [leg({ planned_departure: "2026-07-20", planned_arrival: "2026-07-01" })])
      .catch((e) => e);
    expect(err.details["legs.0.planned_arrival"]).toBeTruthy();
  });

  test("actual arrival cannot precede actual departure", async () => {
    const c = fakeClient();
    const err = await itinerary
      .replace(c, "d-1", [leg({ actual_departure: "2026-07-20", actual_arrival: "2026-07-01" })])
      .catch((e) => e);
    expect(err.details["legs.0.actual_arrival"]).toBeTruthy();
  });

  test("an actual date earlier than the plan is not an error — that is just early", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [
      leg({ planned_departure: "2026-07-20", actual_departure: "2026-07-18", actual_arrival: "2026-07-25" }),
    ]);
    expect(c.state.inserted).toHaveLength(1);
  });
});

describe("the service type's structural legs", () => {
  const SEA_TEMPLATE = [
    { leg_type: "MAIN_CARRIAGE", mode: "SEA" },
    { leg_type: "CUSTOMS", mode: "OTHER", is_optional: true },
  ];

  test("a required leg cannot be removed, and the message says which", async () => {
    const c = fakeClient({ template: SEA_TEMPLATE });
    const err = await itinerary
      .replace(c, "d-1", [leg({ leg_type: "FINAL_DELIVERY", mode: "LAND", origin: "Douala", destination: "Yaoundé" })])
      .catch((e) => e);
    expect(err.code).toBe("ITINERARY_LEG_REQUIRED");
    expect(err.message).toContain("Main carriage");
    // Keyed on `legs`, not a row: the row it is about has been deleted, so there
    // is nowhere to put a field error.
    expect(err.details.legs[0]).toContain("Main carriage");
  });

  test("an OPTIONAL leg can be removed without argument", async () => {
    const c = fakeClient({ template: SEA_TEMPLATE });
    await itinerary.replace(c, "d-1", [leg()]);
    expect(c.state.inserted).toHaveLength(1);
  });

  test("a service type with no template constrains nothing", async () => {
    // Project Cargo is configurable by design; Business Representation has no
    // route at all. Insisting on a shape neither declares would be us deciding.
    const c = fakeClient({ template: [] });
    await itinerary.replace(c, "d-1", [leg({ leg_type: "OTHER", mode: "OTHER", origin: null, destination: null })]);
    expect(c.state.inserted).toHaveLength(1);
  });

  test("an unreadable template does not block the edit", async () => {
    const c = fakeClient({ template: SEA_TEMPLATE });
    const original = c.query.bind(c);
    c.query = async (sql, params) => {
      if (/itinerary_template/i.test(String(sql))) throw new Error("column does not exist");
      return original(sql, params);
    };
    await expect(itinerary.replace(c, "d-1", [leg()])).resolves.toBeTruthy();
  });
});

describe("ordering", () => {
  test("seq comes from array position, not from the caller", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [
      leg({ seq: 99, leg_type: "PICKUP", mode: "LAND", origin: "Douala", destination: "Yaoundé" }),
      leg({ seq: 4 }),
    ]);
    // Array order IS the itinerary's order. Honouring a client's own numbering is
    // how you get two legs numbered 3 and a UNIQUE violation reported as a
    // database error.
    expect(c.state.inserted.map((l) => l.seq)).toEqual([1, 2]);
    expect(c.state.inserted.map((l) => l.leg_type)).toEqual(["PICKUP", "MAIN_CARRIAGE"]);
  });

  test("reordering is a rewrite, so a swap cannot collide on seq", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg(), leg({ leg_type: "PICKUP", mode: "LAND", origin: "Douala", destination: "Yaoundé" })]);
    expect(c.state.deleted).toBe(1);
    expect(c.state.inserted).toHaveLength(2);
  });
});

describe("the transaction", () => {
  test("a successful replace commits once", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg()]);
    expect(c.state.tx).toEqual(["BEGIN", "COMMIT"]);
  });

  test("a failing insert ROLLS BACK — it must not leave the file with no route", async () => {
    // The defect this replaces: DELETE and INSERT were separate statements on a
    // pooled client, so a constraint violation on the second leg destroyed the
    // whole itinerary and reported a save error that said nothing about it.
    const c = fakeClient({ failOnInsertSeq: 2 });
    await expect(
      itinerary.replace(c, "d-1", [leg(), leg({ leg_type: "PICKUP", mode: "LAND", origin: "Douala", destination: "Yaoundé" })]),
    ).rejects.toThrow(/check constraint/);
    expect(c.state.tx).toEqual(["BEGIN", "ROLLBACK"]);
  });

  test("an invalid leg type is refused before any transaction opens", async () => {
    const c = fakeClient();
    await expect(itinerary.replace(c, "d-1", [leg({ leg_type: "TELEPORT" })])).rejects.toThrow(/leg type/);
    expect(c.state.tx).toEqual([]);
  });
});

describe("the read projection", () => {
  const row = (over = {}) => ({
    itinerary_leg_id: "l1",
    dossier_id: "d-1",
    seq: "1.0000",
    leg_type: "MAIN_CARRIAGE",
    mode: "SEA",
    status: "PLANNED",
    origin: "Shanghai",
    destination: "Douala",
    origin_place_id: "gp-shanghai",
    destination_place_id: "gp-douala",
    origin_latitude: "31.229200",
    origin_longitude: "121.474400",
    origin_verified_at: "2026-01-01T00:00:00.000Z",
    destination_latitude: "4.048200",
    destination_longitude: "9.700400",
    destination_verified_at: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  test("coordinates are numbers, not the strings pg returns for numeric", async () => {
    const leg = itinerary.projectLeg(row());
    // numeric(9,6) comes back as a string; the frontend doing arithmetic on
    // "4.048200" silently produces NaN in the projection.
    expect(leg.origin_endpoint.latitude).toBe(31.2292);
    expect(typeof leg.origin_endpoint.longitude).toBe("number");
  });

  test("the text stays under the key the write shape uses, so a leg round-trips", () => {
    const leg = itinerary.projectLeg(row());
    expect(leg.origin).toBe("Shanghai");
    expect(leg.origin_endpoint.name).toBe("Shanghai");
  });

  test("both ends resolved means plottable", () => {
    expect(itinerary.projectLeg(row()).plottable).toBe(true);
  });

  test("one end unresolved is NOT plottable — half a route is a fabrication", () => {
    const leg = itinerary.projectLeg(row({ destination_latitude: null, destination_longitude: null }));
    expect(leg.plottable).toBe(false);
    expect(leg.needs_location).toBe(true);
    expect(leg.destination_endpoint.state).toBe("unknown");
  });

  test("a reference point reports itself as one", () => {
    const leg = itinerary.projectLeg(row({ destination_is_reference_point: true }));
    expect(leg.destination_endpoint.state).toBe("reference");
  });

  test("a background geocode nobody confirmed is unverified, not verified", () => {
    const leg = itinerary.projectLeg(row({ destination_verified_at: null }));
    expect(leg.destination_endpoint.state).toBe("unverified");
    // Still plottable — it has a coordinate. It is the CONFIDENCE that differs,
    // which is why these are two separate facts.
    expect(leg.plottable).toBe(true);
  });
});

describe("legsFromTemplate", () => {
  test("the main carriage inherits the file's verified POL and POD", () => {
    const legs = itinerary.legsFromTemplate(
      [{ leg_type: "MAIN_CARRIAGE", mode: "SEA" }, { leg_type: "FINAL_DELIVERY", mode: "LAND", is_optional: true }],
      { pol: "Shanghai", pod: "Douala" },
    );
    expect(legs[0]).toMatchObject({ origin: "Shanghai", destination: "Douala", source: "TEMPLATE" });
  });

  test("every other leg starts empty rather than guessing", () => {
    // Assuming a pickup happens at the port of loading would put a truck leg on
    // the map that nobody planned.
    const legs = itinerary.legsFromTemplate(
      [{ leg_type: "PICKUP", mode: "LAND" }],
      { pol: "Shanghai", pod: "Douala" },
    );
    expect(legs[0]).toMatchObject({ origin: null, destination: null });
  });

  test("a missing or malformed template yields no legs rather than throwing", () => {
    expect(itinerary.legsFromTemplate(null, {})).toEqual([]);
    expect(itinerary.legsFromTemplate("nonsense", {})).toEqual([]);
  });

  test("template legs are marked as such, so the required-leg rule can act", () => {
    const legs = itinerary.legsFromTemplate([{ leg_type: "CUSTOMS", mode: "OTHER", is_optional: true }], {});
    expect(legs[0]).toMatchObject({ source: "TEMPLATE", is_optional: true });
  });
});

describe("normalisation agrees with the catalogue", () => {
  test("the keys looked up are the ones 0675 seeded", async () => {
    const c = fakeClient();
    await itinerary.replace(c, "d-1", [leg({ origin: "  SHANGHAI ", destination: "Yaoundé" })]);
    expect(repo.normalise("  SHANGHAI ")).toBe("shanghai");
    expect(repo.normalise("Yaoundé")).toBe("yaounde");
    expect(c.state.inserted[0].origin_place_id).toBe("gp-shanghai");
  });
});
