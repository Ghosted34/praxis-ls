"use strict";

/**
 * What the public tracking payload says, and what it refuses to say.
 *
 * The two additions WS1 needed — the service type behind the mode icon, and
 * when the shipment last actually moved — are both derived rather than read,
 * and both have a wrong answer that looks right. `serviceMode` must never guess
 * a mode it was not given; `lastUpdate` must never report an edit as progress.
 *
 * The client name, the internal status and the delay attribution are checked as
 * absences: those are the fields this endpoint exists to withhold.
 */

const {
  get,
  routeLabels,
  serviceMode,
  serviceType,
  lastUpdate,
} = require("../../src/modules/operations/tracking_public/tracking_public.service");

/** A client that answers the dossier query first, then the milestone query. */
const clientFor = (dossierRows, milestoneRows = []) => {
  const answers = [{ rows: dossierRows }, { rows: milestoneRows }];
  return { query: jest.fn(async () => answers.shift() || { rows: [] }) };
};

const dossier = (over = {}) => ({
  dossier_id: "d1",
  ref: "SBL-OPS-2026-0142",
  pol: "Shanghai",
  pod: "Douala",
  place_receipt: null,
  place_delivery: null,
  details_json: {},
  service_key: "SEA_FREIGHT_IMPORT",
  service_name_fr: "Fret maritime import",
  service_name_en: "Sea freight import",
  ...over,
});

const stage = (over = {}) => ({
  code: "ARRIVAL",
  label: "Arrival",
  label_en: "Arrival",
  internal_status: "DONE",
  due_date: null,
  completed_at: "2026-03-01T10:00:00.000Z",
  public_location: null,
  public_stage_reference: null,
  public_progress_note: null,
  ...over,
});

describe("serviceMode", () => {
  it.each([
    ["SEA_FREIGHT_IMPORT", "SEA"],
    ["SEA_FREIGHT_EXPORT", "SEA"],
    ["END_TO_END_SEA_FREIGHT", "SEA"],
    ["SHIPPING_LINE", "SEA"],
    ["AIR_FREIGHT_IMPORT", "AIR"],
    ["END_TO_END_AIR_FREIGHT", "AIR"],
    ["RAIL_TRANSPORTATION", "RAIL"],
    ["RAIL_HINTERLAND_TRANSIT", "RAIL"],
    ["HINTERLAND_TRANSIT", "ROAD"],
    ["ROAD_HAULAGE", "ROAD"],
    ["WAREHOUSING", "WAREHOUSE"],
    ["CUSTOMS_BROKERAGE", "CUSTOMS"],
  ])("reads %s as %s", (key, mode) => {
    expect(serviceMode(key)).toBe(mode);
  });

  it("answers OTHER for a key it does not recognise, never nothing", () => {
    // Service types are user-creatable. A tenant's own key must render a
    // neutral icon rather than an undefined one.
    expect(serviceMode("PROJECT_CARGO")).toBe("OTHER");
    expect(serviceMode("SOMETHING_A_TENANT_INVENTED")).toBe("OTHER");
  });

  it("answers OTHER for no key at all", () => {
    expect(serviceMode(null)).toBe("OTHER");
    expect(serviceMode("")).toBe("OTHER");
    expect(serviceMode(undefined)).toBe("OTHER");
  });

  it("is case-insensitive, because `key` is citext", () => {
    expect(serviceMode("sea_freight_import")).toBe("SEA");
  });

  it("puts rail ahead of the road leg it also runs on", () => {
    // RAIL_HINTERLAND_TRANSIT matches both tokens; the leg that names the
    // service is the rail one.
    expect(serviceMode("RAIL_HINTERLAND_TRANSIT")).toBe("RAIL");
  });
});

describe("routeLabels reads the fields its mode uses", () => {
  it("takes the ports for a sea file", () => {
    expect(routeLabels(dossier())).toEqual({
      origin: "Shanghai",
      destination: "Douala",
    });
  });

  it("takes the airports for an air file", () => {
    const d = dossier({
      service_key: "AIR_FREIGHT_IMPORT",
      details_json: { air_origin: "CDG", air_destination: "DLA" },
    });
    expect(routeLabels(d)).toEqual({ origin: "CDG", destination: "DLA" });
  });

  it("takes receipt and delivery for anything else", () => {
    const d = dossier({
      service_key: "ROAD_HAULAGE",
      place_receipt: "Douala",
      place_delivery: "N'Djamena",
    });
    expect(routeLabels(d)).toEqual({
      origin: "Douala",
      destination: "N'Djamena",
    });
  });
});

describe("serviceType", () => {
  it("sends both names and the mode, resolving neither", () => {
    // The visitor's language can change without a request; a server that picked
    // one would make the language toggle refetch the page.
    expect(serviceType(dossier())).toEqual({
      key: "SEA_FREIGHT_IMPORT",
      name_fr: "Fret maritime import",
      name_en: "Sea freight import",
      mode: "SEA",
    });
  });

  it("is null on a file the desk has not classified yet", () => {
    expect(serviceType(dossier({ service_key: null }))).toBeNull();
  });

  it("survives a service type with no English name", () => {
    // name_en is nullable; name_fr is not.
    const out = serviceType(dossier({ service_name_en: null }));
    expect(out.name_en).toBeNull();
    expect(out.name_fr).toBe("Fret maritime import");
  });
});

describe("lastUpdate", () => {
  it("is the latest completion, not the last row", () => {
    // stage_seq order is not completion order — documents verified after
    // arrival happens constantly.
    const at = lastUpdate([
      stage({ completed_at: "2026-03-05T08:00:00.000Z" }),
      stage({ completed_at: "2026-03-02T08:00:00.000Z" }),
    ]);
    expect(at).toBe("2026-03-05T08:00:00.000Z");
  });

  it("is null while nothing has completed", () => {
    // An opened file that has not started. The page must not print its creation
    // date under a heading that says "last update".
    expect(lastUpdate([stage({ completed_at: null, internal_status: "PENDING" })])).toBeNull();
    expect(lastUpdate([])).toBeNull();
  });

  it("ignores a completion timestamp that will not parse", () => {
    expect(lastUpdate([stage({ completed_at: "not a date" })])).toBeNull();
  });

  it("accepts a Date as well as a string, because pg returns one", () => {
    const at = lastUpdate([stage({ completed_at: new Date("2026-03-05T08:00:00.000Z") })]);
    expect(at).toBe("2026-03-05T08:00:00.000Z");
  });
});

describe("the response", () => {
  it("carries the service type and the last update", async () => {
    const client = clientFor(
      [dossier()],
      [
        stage({ code: "ARRIVAL", completed_at: "2026-03-01T10:00:00.000Z" }),
        stage({ code: "DISCHARGE", completed_at: "2026-03-03T10:00:00.000Z" }),
        stage({ code: "DELIVERY", internal_status: "PENDING", completed_at: null }),
      ],
    );
    const out = await get(client, "SBL-OPS-2026-0142");
    expect(out.service_type).toEqual({
      key: "SEA_FREIGHT_IMPORT",
      name_fr: "Fret maritime import",
      name_en: "Sea freight import",
      mode: "SEA",
    });
    expect(out.last_update).toBe("2026-03-03T10:00:00.000Z");
    expect(out.progress).toEqual({ completed: 2, total: 3, percent: 67 });
    expect(out.computed_status).toBe("IN_PROGRESS");
  });

  it("still answers on a file with no service type and no completions", async () => {
    const client = clientFor([dossier({ service_key: null })], [stage({
      internal_status: "PENDING",
      completed_at: null,
    })]);
    const out = await get(client, "SBL-OPS-2026-0142");
    expect(out.service_type).toBeNull();
    expect(out.last_update).toBeNull();
    expect(out.computed_status).toBe("PENDING");
  });

  it("reads dossier_visible, so a DRAFT file is not publicly trackable", async () => {
    const client = clientFor([dossier()], []);
    await get(client, "SBL-OPS-2026-0142");
    const sql = client.query.mock.calls[0][0];
    expect(sql).toContain("dossier_visible");
    expect(sql).not.toMatch(/FROM\s+dossier\s/);
  });

  it("404s a reference nobody recognises", async () => {
    await expect(get(clientFor([]), "NOPE")).rejects.toMatchObject({ status: 404 });
  });

  it("names no client and leaks no internal status", async () => {
    // The absences are the point of this endpoint.
    const client = clientFor([dossier()], [stage()]);
    const out = await get(client, "SBL-OPS-2026-0142");
    const json = JSON.stringify(out);
    expect(json).not.toContain("client");
    expect(json).not.toContain("internal_status");
    expect(json).not.toContain("DONE");
    expect(out.milestones[0].public_state).toBe("COMPLETED");
  });
});
