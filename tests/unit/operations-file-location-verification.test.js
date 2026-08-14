/**
 * The rule: a movement file cannot be OPENED with an origin or destination that
 * is not a real place.
 *
 * ── WHAT THIS PREVENTS, CONCRETELY ──────────────────────────────────────────
 *
 * "Doula" is one letter short of Cameroon's main port. Before this gate it saved
 * cleanly, because `pol` is a text column and the picker allowed free text. What
 * happened next is the part that mattered: the save path forward-geocoded it in
 * the background, the provider answered with something plausible rather than
 * failing, and the dossier was linked to a coordinate nobody had ever looked at.
 * No error anywhere, and a lane in the wrong place on the map the Monday meeting
 * runs off. A geocoder handed a typo does not fail — it guesses, confidently.
 *
 * ── THE FOUR THINGS THESE TESTS PIN ────────────────────────────────────────
 *
 *   1. An unverified movement place blocks the OPEN, and the error names the
 *      field and says which of the four ways out to use.
 *   2. Only geographic roles are checked. A cargo description is prose and a
 *      customs reference is a number; a place check on either would refuse
 *      perfectly good files, which is how a gate gets deleted.
 *   3. Only at OPEN. Editing an existing file is never blocked — a legacy value
 *      typed in 2024 must not stand between an operator and an ETA correction.
 *   4. It is a local lookup. Opening a file must never wait on a third party.
 */
"use strict";

const details = require("../../src/modules/operations/shipment_details/shipment_details.service");
const geoapify = require("../../src/services/geoapify.service");
const repo = require("../../src/modules/operations/geo_place/geo_place.repo");

/** A service_type_field row, as `fieldsOf` returns it. */
const field = (over = {}) => ({
  service_type_field_id: `f-${over.key || "x"}`,
  key: "pol",
  label_en: "Port of loading (POL)",
  label_fr: "Port de chargement",
  data_type: "GEO_PLACE",
  facet_role: "ORIGIN",
  column_name: "pol",
  is_required: true,
  is_active: true,
  is_readonly: false,
  validation_json: {},
  group_code: "TRANSPORT",
  group_seq: 10,
  seq: 10,
  width: "HALF",
  options: [],
  ...over,
});

/** The catalogue, as `query_key -> display name` — the shape geo_place really
 *  has, so the canonical-spelling assertions below mean something. */
const KNOWN = new Map([
  ["douala", "Douala"],
  ["kribi", "Kribi"],
  ["antwerp", "Antwerp"],
  ["zone industrielle bassa douala", "Zone Industrielle Bassa, Douala"],
]);

/**
 * A client modelling the form lookup and the catalogue lookup, and nothing else.
 * Throws on anything unmodelled so an unnoticed extra query cannot pass as an
 * empty result.
 */
function fakeClient({ fields, known = KNOWN } = {}) {
  const state = { sql: [], keysAsked: [] };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      if (/FROM service_type_field_set/i.test(s)) {
        return { rows: [{ service_type_field_set_id: "fs-1", version: 1, is_active: true }] };
      }
      if (/FROM service_type_field\b/i.test(s)) return { rows: fields };
      if (/FROM geo_place WHERE query_key = ANY/i.test(s)) {
        state.keysAsked.push(...params[0]);
        return {
          rows: params[0]
            .filter((k) => known.has(k))
            .map((k) => ({ geo_place_id: `gp-${k}`, query_key: k, name: known.get(k), latitude: "4.0", longitude: "9.7", verified_at: "2026-01-01T00:00:00.000Z", is_active: true })),
        };
      }
      throw new Error("fakeClient: unmodelled SQL: " + s.slice(0, 140));
    },
  };
}

const apply = (client, values, { enforceRequired = true } = {}) =>
  details.applyValues(client, {
    serviceTypeId: "st-1",
    values,
    existingDetails: {},
    enforceRequired,
  });

beforeEach(() => jest.restoreAllMocks());

describe("opening a movement file", () => {
  test("a place from the catalogue is accepted", async () => {
    const c = fakeClient({ fields: [field()] });
    const { patch } = await apply(c, { pol: "Douala" });
    expect(patch.pol).toBe("Douala");
  });

  test("normalisation applies — DOUALA and douala are the same place", async () => {
    const c = fakeClient({ fields: [field()] });
    await expect(apply(c, { pol: "  DOUALA " })).resolves.toBeTruthy();
  });

  test("a verified value is stored under the CATALOGUE'S spelling", async () => {
    // `pol` is the display value on every document this file produces and the
    // grouping key in every report about it. Three spellings of one port is
    // three rows in a pivot table, so the proven-correct row's name wins.
    const c = fakeClient({ fields: [field()] });
    const { patch } = await apply(c, { pol: "  dOUALA " });
    expect(patch.pol).toBe("Douala");
  });

  test("a typo is REFUSED, and the error names the field", async () => {
    const c = fakeClient({ fields: [field()] });
    await expect(apply(c, { pol: "Doula" })).rejects.toMatchObject({
      code: "UNVERIFIED_PLACE",
      status: 422,
    });
  });

  test("the refusal says which of the four ways out to use", async () => {
    const c = fakeClient({ fields: [field()] });
    const err = await apply(c, { pol: "Doula" }).catch((e) => e);
    expect(err.message).toContain("Port of loading (POL)");
    const hint = err.details.pol[0];
    expect(hint).toContain('"Doula"');
    expect(hint).toMatch(/place search/i);
    expect(hint).toMatch(/worldwide/i);
    expect(hint).toMatch(/reference point/i);
    expect(hint).toMatch(/manually/i);
  });

  test("several unverified places are reported together, not one per attempt", async () => {
    const c = fakeClient({
      fields: [field(), field({ key: "pod", label_en: "Port of discharge (POD)", facet_role: "DESTINATION", column_name: "pod" })],
    });
    const err = await apply(c, { pol: "Doula", pod: "Antwerpen" }).catch((e) => e);
    expect(Object.keys(err.details).sort()).toEqual(["pod", "pol"]);
    expect(err.message).toContain("Port of loading (POL)");
    expect(err.message).toContain("Port of discharge (POD)");
  });

  test("a place confirmed from a provider search satisfies the gate", async () => {
    // Exactly what geo_place.service.confirmSuggestion stores for a confirmed
    // Geoapify result: the disambiguated label, normalised into the key.
    const c = fakeClient({ fields: [field({ key: "place_receipt", facet_role: "ORIGIN", column_name: "place_receipt", label_en: "Place of collection" })] });
    await expect(apply(c, { place_receipt: "Zone Industrielle Bassa, Douala" })).resolves.toBeTruthy();
  });

  test("a value stored in details_json rather than a column is checked too", async () => {
    const c = fakeClient({ fields: [field({ key: "entry_port", facet_role: "ROUTE_VIA", column_name: null })] });
    await expect(apply(c, { entry_port: "Nowhere" })).rejects.toMatchObject({ code: "UNVERIFIED_PLACE" });
  });

  test("a custody location is a place too — a warehousing file names a real site", async () => {
    const c = fakeClient({
      fields: [field({ key: "warehouse_location", facet_role: "CUSTODY_LOCATION", column_name: null, label_en: "Warehouse" })],
    });
    await expect(apply(c, { warehouse_location: "Shed 9" })).rejects.toMatchObject({ code: "UNVERIFIED_PLACE" });
  });
});

describe("what is deliberately NOT checked", () => {
  test("an empty optional place is fine — that is is_required's business", async () => {
    const c = fakeClient({ fields: [field({ is_required: false })] });
    const { patch } = await apply(c, { pol: "" });
    expect(patch.pol).toBeNull();
  });

  test("a non-geographic field is never place-checked", async () => {
    const c = fakeClient({
      fields: [field({ key: "cargo_desc", data_type: "TEXT", facet_role: "CARGO_DESC", column_name: null, is_required: false })],
    });
    await expect(apply(c, { cargo_desc: "40 pallets of sorghum" })).resolves.toBeTruthy();
  });

  test("a GEO_PLACE field with no geographic role is not gated", async () => {
    // Defensive: a tenant could define a GEO_PLACE field for reference without
    // it being the file's origin or destination. Blocking that would be us
    // deciding what their form means.
    const c = fakeClient({ fields: [field({ key: "nearest_town", facet_role: null, column_name: null, is_required: false })] });
    await expect(apply(c, { nearest_town: "Somewhere" })).resolves.toBeTruthy();
  });

  test("a role field that is still TEXT is not gated — no catalogue, no picker", async () => {
    // 0676 converts the seeded ones. A tenant who deliberately reverted a field
    // to free text has said they want free text, and this is not the layer that
    // argues with them.
    const c = fakeClient({ fields: [field({ data_type: "TEXT", key: "final_destination", column_name: null })] });
    await expect(apply(c, { final_destination: "the usual yard" })).resolves.toBeTruthy();
  });

  test("EDITING an existing file is never blocked by an unverified legacy value", async () => {
    const c = fakeClient({ fields: [field()] });
    const { patch } = await apply(c, { pol: "Doula" }, { enforceRequired: false });
    expect(patch.pol).toBe("Doula");
    // …and nothing was even looked up, so the edit path costs no extra query.
    expect(c.state.keysAsked).toEqual([]);
  });
});

describe("the gate stays local", () => {
  test("no provider call, ever — a file must not wait on a geocoder to open", async () => {
    const search = jest.spyOn(geoapify, "searchPlaces");
    const forward = jest.spyOn(geoapify, "forwardGeocode");
    const c = fakeClient({ fields: [field()] });
    await apply(c, { pol: "Doula" }).catch(() => {});
    expect(search).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  test("many places cost one query", async () => {
    const c = fakeClient({
      fields: [
        field(),
        field({ key: "pod", facet_role: "DESTINATION", column_name: "pod" }),
        field({ key: "entry_port", facet_role: "ROUTE_VIA", column_name: null }),
      ],
    });
    await apply(c, { pol: "Douala", pod: "Antwerp", entry_port: "Kribi" });
    expect(c.state.sql.filter((s) => /query_key = ANY/.test(s))).toHaveLength(1);
  });

  test("the keys asked for are the normalised forms, matching what 0675 seeded", async () => {
    const c = fakeClient({ fields: [field()] });
    await apply(c, { pol: "Yaoundé" }).catch(() => {});
    expect(c.state.keysAsked).toEqual(["yaounde"]);
    // The same normalisation the catalogue's query_key column was built from.
    expect(repo.normalise("Yaoundé")).toBe("yaounde");
  });
});
