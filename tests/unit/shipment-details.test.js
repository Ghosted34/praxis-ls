"use strict";
/**
 * The Shared Shipment/Service Detail Component (0660).
 *
 * The tests that matter here are the ones that pin BEHAVIOUR THE LEGACY SYSTEM
 * GOT WRONG, because that is what this module exists to fix:
 *
 *   - one panel serves every service type, so a sea file resolves its transport
 *     reference to a BL and an air file to a MAWB with no service-type name
 *     anywhere in the projection code;
 *   - a warehousing file has NO route, NO conveyance and NO transport reference
 *     — the facets are absent, not blank, so nothing renders "Vessel: —";
 *   - an actual arrival supersedes an estimate wherever a date is printed;
 *   - a value the service type does not define is refused rather than stored.
 */
const rules = require("../../src/modules/operations/shipment_details/shipment_details.rules");
const service = require("../../src/modules/operations/shipment_details/shipment_details.service");

/** Minimal field definition — only what the rules actually read. */
const f = (o) => ({
  group_code: "TRANSPORT",
  group_label_en: "Transport",
  group_seq: 10,
  seq: 10,
  data_type: "TEXT",
  is_active: true,
  is_required: false,
  options_json: [],
  validation_json: {},
  ...o,
});

const SEA = [
  f({ key: "bl_number", label_en: "Bill of Lading", facet_role: "TRANSPORT_REF", column_name: "bl_mawb", seq: 10 }),
  f({ key: "vessel_name", label_en: "Vessel", facet_role: "CONVEYANCE", column_name: "vessel_flight", seq: 20 }),
  f({ key: "voyage_no", label_en: "Voyage No", facet_role: "CONVEYANCE", seq: 30 }),
  f({ key: "pol", label_en: "POL", facet_role: "ORIGIN", column_name: "pol", seq: 40 }),
  f({ key: "pod", label_en: "POD", facet_role: "DESTINATION", column_name: "pod", seq: 50 }),
  f({ key: "eta", label_en: "ETA", data_type: "DATE", facet_role: "ARRIVAL_DATE", column_name: "eta", seq: 60 }),
  f({ key: "ata", label_en: "ATA", data_type: "DATE", facet_role: "ARRIVAL_DATE", column_name: "ata", seq: 70 }),
  f({ key: "gross_weight", label_en: "Gross weight", data_type: "NUMBER", facet_role: "CARGO_WEIGHT", column_name: "gross_weight", seq: 80 }),
];

const AIR = [
  f({ key: "mawb", label_en: "MAWB", facet_role: "TRANSPORT_REF", column_name: "bl_mawb", seq: 10 }),
  f({ key: "hawb", label_en: "HAWB", facet_role: "TRANSPORT_REF", seq: 20 }),
  f({ key: "flight_no", label_en: "Flight No", facet_role: "CONVEYANCE", column_name: "vessel_flight", seq: 30 }),
  f({ key: "origin_airport", label_en: "Origin", facet_role: "ORIGIN", column_name: "pol", seq: 40 }),
  f({ key: "dest_airport", label_en: "Destination", facet_role: "DESTINATION", column_name: "pod", seq: 50 }),
];

const WAREHOUSE = [
  f({ key: "warehouse_location", label_en: "Warehouse", facet_role: "CUSTODY_LOCATION", group_code: "STORAGE", seq: 10, is_required: true }),
  f({
    key: "bonded_status", label_en: "Bonded status", data_type: "SELECT", facet_role: "CUSTODY_STATUS",
    group_code: "STORAGE", seq: 20, is_required: true,
    options_json: [{ value: "BONDED", label_fr: "Sous douane", label_en: "Bonded" }, { value: "NON_BONDED", label_fr: "Hors douane", label_en: "Non-bonded" }],
  }),
  f({ key: "free_storage_days", label_en: "Free days", data_type: "INTEGER", group_code: "STORAGE", seq: 30, validation_json: { min: 0, max: 3650 } }),
];

describe("SSDC — one panel, every service type", () => {
  it("resolves the transport reference per service type without naming one", () => {
    const sea = rules.toFacets(SEA, { bl_mawb: "MSCU123456" }, {});
    const air = rules.toFacets(AIR, { bl_mawb: "020-12345678" }, { hawb: "H-99" });
    expect(sea.TRANSPORT_REF.value).toBe("MSCU123456");
    expect(air.TRANSPORT_REF.value).toBe("020-12345678 / H-99");
  });

  it("joins a multi-part conveyance the way the legacy panel read", () => {
    const sea = rules.toFacets(SEA, { vessel_flight: "MSC ARUSHI" }, { voyage_no: "128W" });
    expect(sea.CONVEYANCE.value).toBe("MSC ARUSHI / 128W");
    expect(sea.CONVEYANCE.parts.map((p) => p.key)).toEqual(["vessel_name", "voyage_no"]);
  });

  it("prefers an ACTUAL arrival over the estimate", () => {
    const est = rules.toFacets(SEA, { eta: "2026-09-01" }, {});
    expect(est.ARRIVAL_DATE.value).toBe("2026-09-01");
    const actual = rules.toFacets(SEA, { eta: "2026-09-01", ata: "2026-09-04" }, {});
    expect(actual.ARRIVAL_DATE.value).toBe("2026-09-04");
  });

  it("builds a route label, and none at all when there is no route", () => {
    const sea = rules.toFacets(SEA, { pol: "Shanghai", pod: "Douala" }, {});
    expect(rules.routeLabel(sea)).toBe("Shanghai → Douala");
    const partial = rules.toFacets(SEA, { pol: "Shanghai" }, {});
    expect(rules.routeLabel(partial)).toBeNull();
  });

  it("appends the unit to a weight, because 12500 alone is not a weight", () => {
    const sea = rules.toFacets(SEA, { gross_weight: 12500, weight_unit: "KG" }, {});
    expect(sea.CARGO_WEIGHT.value).toBe("12500 KG");
  });
});

describe("SSDC — a warehousing file carries no freight vocabulary", () => {
  const dossier = {};
  const details = { warehouse_location: "Bonabéri Bonded 2", bonded_status: "BONDED" };

  it("has custody facets and NO transport, route or conveyance facets", () => {
    const facets = rules.toFacets(WAREHOUSE, dossier, details);
    expect(facets.CUSTODY_LOCATION.value).toBe("Bonabéri Bonded 2");
    // Absent, not blank — this is the bug the legacy panel had, where a
    // warehousing job rendered "Transport ref: -", "Route: -", "Vessel: -".
    expect(facets.TRANSPORT_REF).toBeUndefined();
    expect(facets.CONVEYANCE).toBeUndefined();
    expect(facets.ORIGIN).toBeUndefined();
    expect(facets.DESTINATION).toBeUndefined();
    expect(rules.routeLabel(facets)).toBeNull();
  });

  it("renders a SELECT by its label, not its stored code", () => {
    const facets = rules.toFacets(WAREHOUSE, dossier, details);
    expect(facets.CUSTODY_STATUS.value).toBe("Bonded");
    const fr = rules.toFacets(WAREHOUSE, dossier, details, { lang: "fr" });
    expect(fr.CUSTODY_STATUS.value).toBe("Sous douane");
  });

  it("orders facets canonically and lists only the ones that exist", () => {
    const facets = rules.toFacets(WAREHOUSE, dossier, details);
    const order = rules.FACET_ORDER.filter((r) => facets[r]);
    expect(order).toEqual(["CUSTODY_LOCATION", "CUSTODY_STATUS"]);
  });
});

describe("SSDC — completeness reports rather than blocks", () => {
  it("counts what is filled and names what is required and missing", () => {
    const c = rules.completeness(WAREHOUSE, {}, { warehouse_location: "Bonabéri" });
    expect(c.total).toBe(3);
    expect(c.filled).toBe(1);
    expect(c.missing_required).toEqual(["bonded_status"]);
    expect(c.is_complete).toBe(false);
  });

  it("is complete when every active field has a value", () => {
    const c = rules.completeness(WAREHOUSE, {}, {
      warehouse_location: "Bonabéri", bonded_status: "BONDED", free_storage_days: 7,
    });
    expect(c.percent).toBe(100);
    expect(c.is_complete).toBe(true);
  });
});

describe("SSDC — the write path is the only way into details_json", () => {
  it("splits values between dossier columns and details_json", () => {
    const { columns, details } = service.partition(SEA, {
      bl_number: "MSCU123456", voyage_no: "128W", pol: "Shanghai",
    });
    expect(columns).toEqual({ bl_mawb: "MSCU123456", pol: "Shanghai" });
    expect(details).toEqual({ voyage_no: "128W" });
  });

  it("refuses a field the service type does not define", () => {
    expect(() => service.partition(WAREHOUSE, { sea_pol: "Shanghai" }))
      .toThrow(/not a field on this service type/);
  });

  it("refuses a retired field", () => {
    const retired = [f({ key: "old_ref", label_en: "Old", is_active: false })];
    expect(() => service.partition(retired, { old_ref: "x" })).toThrow(/retired/i);
  });

  it("enforces required fields on create and not on update", () => {
    expect(() => service.partition(WAREHOUSE, { warehouse_location: "B" }, { enforceRequired: true }))
      .toThrow(/requires: bonded_status/);
    expect(() => service.partition(WAREHOUSE, { warehouse_location: "B" }, { enforceRequired: false }))
      .not.toThrow();
  });

  it("merges over existing details so a partial save does not wipe the rest", () => {
    const { details } = service.partition(SEA, { voyage_no: "129E" }, {
      existingDetails: { voyage_no: "128W", something_else: "kept" },
    });
    expect(details).toEqual({ voyage_no: "129E", something_else: "kept" });
  });

  it("clears a detail when the value is blanked", () => {
    const { details } = service.partition(SEA, { voyage_no: "" }, {
      existingDetails: { voyage_no: "128W" },
    });
    expect(details.voyage_no).toBeUndefined();
  });
});

describe("SSDC — values are coerced and checked against their definition", () => {
  const num = f({ key: "n", label_en: "N", data_type: "NUMBER", validation_json: { min: 0, max: 10 } });
  const int = f({ key: "i", label_en: "I", data_type: "INTEGER" });
  const sel = WAREHOUSE[1];
  const date = f({ key: "d", label_en: "D", data_type: "DATE" });

  it("coerces numbers and enforces min/max", () => {
    expect(service.coerce(num, "5")).toBe(5);
    expect(() => service.coerce(num, "-1")).toThrow(/at least 0/);
    expect(() => service.coerce(num, "11")).toThrow(/at most 10/);
    expect(() => service.coerce(num, "abc")).toThrow(/must be a number/);
  });

  it("rejects a fraction where a whole number is declared", () => {
    expect(service.coerce(int, "4")).toBe(4);
    expect(() => service.coerce(int, "4.5")).toThrow(/whole number/);
  });

  it("rejects a value outside a SELECT's options", () => {
    expect(service.coerce(sel, "BONDED")).toBe("BONDED");
    expect(() => service.coerce(sel, "MAYBE")).toThrow(/must be one of/);
  });

  it("rejects a date that is not one, and trims a datetime to the day", () => {
    expect(service.coerce(date, "2026-09-01T10:30")).toBe("2026-09-01");
    expect(() => service.coerce(date, "01/09/2026")).toThrow(/must be a date/);
  });

  it("treats blank as null rather than as a value", () => {
    expect(service.coerce(num, "")).toBeNull();
    expect(service.coerce(num, null)).toBeNull();
  });
});

describe("SSDC — equipment summary", () => {
  it("totals boxes and TEU from the registry's own capacity figures", () => {
    const s = service.summariseContainers([
      { qty: 3, container_type_extra: { teu: 2 }, units: [{ container_no: "MSCU1234567" }] },
      { qty: 2, container_type_extra: { teu: 1 }, units: [] },
    ]);
    expect(s.boxes).toBe(5);
    expect(s.teu).toBe(8);
    expect(s.identified).toBe(1);
  });

  it("counts boxes even when a container type carries no TEU figure", () => {
    const s = service.summariseContainers([{ qty: 4, container_type_extra: {}, units: [] }]);
    expect(s.boxes).toBe(4);
    expect(s.teu).toBe(0);
  });
});

describe("SSDC — groups drive the form and the panel from one definition", () => {
  it("orders groups by group_seq and fields by seq", () => {
    const mixed = [
      f({ key: "b", label_en: "B", group_code: "CARGO", group_label_en: "Cargo", group_seq: 20, seq: 10 }),
      f({ key: "a", label_en: "A", group_code: "TRANSPORT", group_label_en: "Transport", group_seq: 10, seq: 20 }),
      f({ key: "c", label_en: "C", group_code: "TRANSPORT", group_label_en: "Transport", group_seq: 10, seq: 5 }),
    ];
    const groups = rules.toGroups(mixed);
    expect(groups.map((g) => g.code)).toEqual(["TRANSPORT", "CARGO"]);
    expect(groups[0].fields.map((x) => x.key)).toEqual(["c", "a"]);
  });

  it("omits retired fields from the form", () => {
    const withRetired = [...WAREHOUSE, f({ key: "gone", label_en: "Gone", group_code: "STORAGE", is_active: false })];
    const keys = rules.toGroups(withRetired).flatMap((g) => g.fields.map((x) => x.key));
    expect(keys).not.toContain("gone");
  });
});

describe("SSDC — a field definition names a format, never a regex", () => {
  /**
   * The first version let a definition carry its own `pattern` and did
   * `new RegExp(pattern).test(value)`. The pattern is authored by a tenant admin
   * through the API, so that is regex injection: `(a+)+$` against a long value
   * hangs the save path for everyone on the tenant, and Node cannot time a regex
   * out. CodeQL flagged it (js/regex-injection) and was right to.
   */
  const f = (validation) => ({
    key: "x", label_en: "X", data_type: "TEXT", is_active: true,
    options_json: [], validation_json: validation,
  });

  it("accepts a value matching a named format", () => {
    expect(service.coerce(f({ format: "EMAIL" }), "ops@example.com")).toBe("ops@example.com");
    expect(service.coerce(f({ format: "CONTAINER_NO" }), "MSKU1234567")).toBe("MSKU1234567");
  });

  it("rejects one that does not, naming the format in plain words", () => {
    expect(() => service.coerce(f({ format: "EMAIL" }), "not-an-email")).toThrow(/must be an email address/);
    expect(() => service.coerce(f({ format: "CONTAINER_NO" }), "1234")).toThrow(/container number/);
  });

  it("ignores an unknown format rather than failing the save", () => {
    // A definition written against a format this build does not know is the
    // thing to fix; refusing the user's save is not.
    expect(service.coerce(f({ format: "NOT_A_FORMAT" }), "anything")).toBe("anything");
  });

  it("never treats a raw pattern as an expression", () => {
    // The catastrophic-backtracking payload that made this exploitable. It must
    // be inert: `pattern` is not a key the validator accepts and not one the
    // coercer reads.
    const evil = f({ pattern: "^(a+)+$" });
    const start = Date.now();
    expect(service.coerce(evil, "a".repeat(60) + "!")).toBe("a".repeat(60) + "!");
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe("SSDC — a request key is never used as a property name", () => {
  /**
   * CodeQL raised four high-severity `js/remote-property-injection` alerts on
   * the first version of `partition`, which iterated the REQUEST body and did
   * `details[key] = value`. A property name taken from a request and used as a
   * write target reaches `Object.prototype` through `__proto__`, and the
   * "is this a known field?" guard sitting above it is not something a dataflow
   * analyser can see through — nor should it have to.
   *
   * The loop is now driven by the field DEFINITIONS, so every name written comes
   * from a database row. These tests pin the behaviour that change has to keep.
   */
  const FIELDS = [
    f({ key: "voyage_no", label_en: "Voyage No" }),
    f({ key: "pol", label_en: "POL", column_name: "pol" }),
  ];

  it("leaves Object.prototype alone when a payload tries to reach it", () => {
    // Built with JSON.parse, not an object literal, because that is what express
    // hands the route — and the two differ exactly here: a literal's `__proto__`
    // SETS the prototype and never becomes an own property, while JSON.parse
    // creates a real own key called "__proto__". A test written as a literal
    // would pass against code that is still vulnerable.
    const payload = JSON.parse(String.raw`{"__proto__":{"polluted":true},"voyage_no":"128W"}`);
    expect(() => service.partition(FIELDS, payload)).toThrow(/not a field/);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it("writes nothing at all from a payload that is only an attack", () => {
    const payload = JSON.parse(String.raw`{"__proto__":{"polluted":true}}`);
    expect(() => service.partition(FIELDS, payload)).toThrow(/not a field/);
    expect(Object.prototype.polluted).toBeUndefined();
    // And the prototype of a fresh details object is untouched.
    const { details } = service.partition(FIELDS, { voyage_no: "1" });
    expect(Object.getPrototypeOf(details)).toBe(Object.prototype);
  });

  it("does not let a payload shadow a built-in via a defined-looking key", () => {
    const { details } = service.partition(FIELDS, { voyage_no: "128W" });
    expect(Object.prototype.hasOwnProperty.call(details, "voyage_no")).toBe(true);
    expect(Object.getPrototypeOf(details)).toBe(Object.prototype);
    expect(details.constructor).toBe(Object);
  });

  it("still names every unknown key it refused", () => {
    let caught;
    try {
      service.partition(FIELDS, { sea_pol: "x", air_mawb: "y" });
    } catch (e) {
      caught = e;
    }
    expect(caught.message).toMatch(/"sea_pol"/);
    expect(caught.message).toMatch(/"air_mawb"/);
    // Reported as VALUES under a fixed key — never as property names.
    expect(Object.keys(caught.details || {})).toEqual(["details"]);
  });

  it("ignores a definition the payload did not mention", () => {
    const { details, columns } = service.partition(FIELDS, { pol: "Shanghai" });
    expect(columns).toEqual({ pol: "Shanghai" });
    expect(details).toEqual({});
  });
});
