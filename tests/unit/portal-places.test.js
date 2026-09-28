"use strict";

/**
 * The client portal's place search and pick resolution (portal_places).
 *
 * The happy path — type "dou", get Douala — is the least interesting thing
 * here. What these tests hold is the line the feature is built around: a
 * client is offered shared infrastructure and THEIR OWN places, and never
 * another client's door, whether they type for it, guess its id, or submit it.
 */

jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock("../../src/modules/operations/geo_place_public/geo_place_public.service", () => ({
  search: jest.fn(),
}));
jest.mock("../../src/modules/operations/geo_place/geo_place.service", () => ({
  ...jest.requireActual("../../src/modules/operations/geo_place/geo_place.service"),
  confirmSuggestion: jest.fn(),
}));

const geoPublic = require("../../src/modules/operations/geo_place_public/geo_place_public.service");
const geoPlace = require("../../src/modules/operations/geo_place/geo_place.service");
const service = require("../../src/modules/portal/portal_places.service");
const { schemas } = require("../../src/modules/portal_auth/portal_auth.validator");

const CLIENT = "11111111-1111-4111-8111-111111111111";

const place = (over = {}) => ({
  geo_place_id: "22222222-2222-4222-8222-222222222222",
  name: "Douala",
  country: "CM",
  region: "Littoral",
  kind: "SEAPORT",
  unlocode: "CMDLA",
  formatted: null,
  latitude: "4.05",
  longitude: "9.7",
  is_active: true,
  verified_at: "2026-01-01T00:00:00Z",
  is_reference_point: false,
  ...over,
});

/**
 * A client that answers each of the portal's queries by what the SQL is:
 * the catalogue search ranks (match_rank), the client's own places report
 * last_used, the popular list counts uses, the pick gate reads one row.
 */
function fakeClient({ catalogue = [], recent = [], popular = [], byId = null, owns = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("match_rank")) return { rows: catalogue };
      if (sql.includes("last_used")) return { rows: recent };
      if (sql.includes("AS uses")) return { rows: popular };
      if (sql.includes("SELECT 1 FROM")) return { rows: owns ? [{ "?column?": 1 }] : [] };
      if (sql.includes("g.is_reference_point") && sql.includes("WHERE g.geo_place_id = $1")) {
        return { rows: byId ? [byId] : [] };
      }
      return { rows: [] };
    },
  };
}

beforeEach(() => jest.clearAllMocks());

describe("what the catalogue half may offer", () => {
  it("offers only shared infrastructure a human confirmed at the exact spot", async () => {
    const c = fakeClient({ catalogue: [place()] });
    await service.searchLocal(c, { clientId: CLIENT, q: "dou" });
    const call = c.calls.find((x) => x.sql.includes("match_rank"));
    // Kinds: the public ones, never a door.
    const kinds = call.params.find((p) => Array.isArray(p));
    expect(kinds).toEqual(expect.arrayContaining(["SEAPORT", "AIRPORT", "CITY"]));
    expect(kinds).not.toContain("ADDRESS");
    expect(kinds).not.toContain("WAREHOUSE");
    expect(kinds).not.toContain("OTHER");
    // Confirmed, exact places only.
    expect(call.sql).toContain("verified_at IS NOT NULL AND NOT is_reference_point");
  });

  it("drops a door kind even when the field asks for one", async () => {
    const c = fakeClient();
    await service.searchLocal(c, { clientId: CLIENT, q: "bona", kinds: ["ADDRESS", "WAREHOUSE", "CITY"] });
    const call = c.calls.find((x) => x.sql.includes("match_rank"));
    expect(call.params.find((p) => Array.isArray(p))).toEqual(["CITY"]);
  });

  it("narrows to the field's kind — an airport field offers airports", async () => {
    const c = fakeClient();
    await service.searchLocal(c, { clientId: CLIENT, q: "nbo", kinds: ["AIRPORT"] });
    const call = c.calls.find((x) => x.sql.includes("match_rank"));
    expect(call.params.find((p) => Array.isArray(p))).toEqual(["AIRPORT"]);
  });

  it("does not search the catalogue at all for a field that only takes doors", async () => {
    const c = fakeClient();
    await service.searchLocal(c, { clientId: CLIENT, q: "bona", kinds: ["ADDRESS"] });
    expect(c.calls.some((x) => x.sql.includes("match_rank"))).toBe(false);
  });

  it("returns what a client needs to read, and none of the desk's provenance", async () => {
    const c = fakeClient({
      catalogue: [place({ source: "SEED", provenance: "seeded", confidence: 0.9, query_key: "douala", match_rank: 1 })],
    });
    const out = await service.searchLocal(c, { clientId: CLIENT, q: "dou" });
    expect(out.places[0]).toEqual({
      geo_place_id: place().geo_place_id,
      name: "Douala",
      country: "CM",
      region: "Littoral",
      kind: "SEAPORT",
      unlocode: "CMDLA",
      formatted: null,
      latitude: 4.05,
      longitude: 9.7,
    });
  });
});

describe("the client's own places", () => {
  it("scopes every branch of the union to this client", async () => {
    const c = fakeClient();
    await service.searchLocal(c, { clientId: CLIENT, q: "" });
    const call = c.calls.find((x) => x.sql.includes("last_used"));
    expect(call.params[0]).toBe(CLIENT);
    const branches = call.sql.split(/UNION ALL/);
    expect(branches).toHaveLength(6);
    branches.forEach((b) => expect(b).toContain("client_id = $1"));
  });

  it("shows a place once — theirs first, not again in the catalogue", async () => {
    const mine = place();
    const other = place({ geo_place_id: "33333333-3333-4333-8333-333333333333", name: "Douala Airport", kind: "AIRPORT" });
    const c = fakeClient({ recent: [mine], catalogue: [mine, other] });
    const out = await service.searchLocal(c, { clientId: CLIENT, q: "dou" });
    expect(out.recent.map((p) => p.name)).toEqual(["Douala"]);
    expect(out.places.map((p) => p.name)).toEqual(["Douala Airport"]);
  });

  it("keeps their own addresses reachable when the field takes doors", async () => {
    const door = place({ kind: "ADDRESS", name: "Rue 1.234, Bonabéri", unlocode: null });
    const c = fakeClient({ recent: [door] });
    const out = await service.searchLocal(c, { clientId: CLIENT, q: "bona", kinds: ["ADDRESS", "CITY"] });
    expect(out.recent.map((p) => p.name)).toEqual(["Rue 1.234, Bonabéri"]);
  });
});

describe("the popular list", () => {
  it("answers the empty box, restricted to public kinds", async () => {
    const c = fakeClient({ popular: [place()] });
    const out = await service.searchLocal(c, { clientId: CLIENT, q: "", kinds: ["SEAPORT"] });
    const call = c.calls.find((x) => x.sql.includes("AS uses"));
    expect(call.params[0]).toEqual(["SEAPORT"]);
    expect(call.sql).toContain("verified_at IS NOT NULL");
    expect(call.sql).toContain("NOT g.is_reference_point");
    expect(out.popular).toHaveLength(1);
  });

  it("stops once they type — what they typed is the better guess", async () => {
    const c = fakeClient({ popular: [place()] });
    await service.searchLocal(c, { clientId: CLIENT, q: "kri" });
    expect(c.calls.some((x) => x.sql.includes("AS uses"))).toBe(false);
  });

  it("is never asked for without kinds, so it cannot count a door", async () => {
    const c = fakeClient();
    await service.searchLocal(c, { clientId: CLIENT, q: "", kinds: ["ADDRESS"] });
    expect(c.calls.some((x) => x.sql.includes("AS uses"))).toBe(false);
  });
});

describe("the worldwide half", () => {
  const local = { places: [], recent: [], popular: [], has_exact: false };

  it("is not asked unless the client asked", async () => {
    const out = await service.withProvider(local, { q: "bonaberi", provider: false });
    expect(geoPublic.search).not.toHaveBeenCalled();
    expect(out.provider).toEqual({ requested: false, status: "NOT_REQUESTED", results: [] });
  });

  it("is not asked when the catalogue already has the exact answer", async () => {
    await service.withProvider({ ...local, has_exact: true }, { q: "douala", provider: true });
    expect(geoPublic.search).not.toHaveBeenCalled();
  });

  it("goes through the public wrapper, so a provider failure is one fact", async () => {
    geoPublic.search.mockResolvedValue({ status: "UNAVAILABLE", results: [] });
    const out = await service.withProvider(local, { q: "bonaberi", provider: true });
    expect(out.provider).toEqual({ requested: true, status: "UNAVAILABLE", results: [] });
  });

  it("folds out a suggestion the lists above already show", async () => {
    geoPublic.search.mockResolvedValue({
      status: "OK",
      results: [
        { provider_place_id: "a", name: "Douala", formatted: "Douala, Littoral, Cameroon", country: "CM", kind: "CITY" },
        { provider_place_id: "b", name: "Bonabéri", formatted: "Bonabéri, Douala, Cameroon", country: "CM", kind: "CITY" },
      ],
    });
    const out = await service.withProvider(
      { ...local, places: [{ name: "Douala" }] },
      { q: "d", provider: true },
    );
    expect(out.provider.results.map((r) => r.provider_place_id)).toEqual(["b"]);
  });
});

describe("resolving what they picked", () => {
  it("accepts shared infrastructure", async () => {
    const c = fakeClient({ byId: place() });
    const row = await service.resolvePick(c, { clientId: CLIENT, pick: { geo_place_id: place().geo_place_id } });
    expect(row.name).toBe("Douala");
  });

  it("drops another client's door, whatever id was guessed", async () => {
    const c = fakeClient({ byId: place({ kind: "ADDRESS" }), owns: false });
    const row = await service.resolvePick(c, { clientId: CLIENT, pick: { geo_place_id: place().geo_place_id } });
    expect(row).toBeNull();
    const gate = c.calls.find((x) => x.sql.includes("SELECT 1 FROM"));
    expect(gate.params).toEqual([CLIENT, place().geo_place_id]);
  });

  it("accepts the client's own door — 'same as last time' keeps its pin", async () => {
    const c = fakeClient({ byId: place({ kind: "ADDRESS" }), owns: true });
    const row = await service.resolvePick(c, { clientId: CLIENT, pick: { geo_place_id: place().geo_place_id } });
    expect(row).not.toBeNull();
  });

  it("drops a reference point or an unconfirmed place that is not theirs", async () => {
    const rows = await Promise.all(
      [{ is_reference_point: true }, { verified_at: null }, { is_active: false }].map((over) =>
        service.resolvePick(fakeClient({ byId: place(over), owns: false }), {
          clientId: CLIENT,
          pick: { geo_place_id: place().geo_place_id },
        })),
    );
    expect(rows).toEqual([null, null, null]);
  });

  it("confirms a worldwide pick through the provider, as the client", async () => {
    geoPlace.confirmSuggestion.mockResolvedValue(place({ kind: "ADDRESS", name: "Rue 1.234, Bonabéri" }));
    const c = fakeClient();
    const row = await service.resolvePick(c, {
      clientId: CLIENT,
      pick: { provider_place_id: "p9", query: "rue 1.234 bonaberi", country: "CM" },
    });
    expect(row.name).toBe("Rue 1.234, Bonabéri");
    expect(geoPlace.confirmSuggestion).toHaveBeenCalledWith(c, expect.objectContaining({
      providerPlaceId: "p9",
      query: "rue 1.234 bonaberi",
      country: "CM",
      confirmedBy: "a client, in the portal",
    }));
  });

  it("never costs the request: a provider failure drops the pin and nothing else", async () => {
    geoPlace.confirmSuggestion.mockRejectedValue(Object.assign(new Error("slow"), { code: "PLACE_PROVIDER_UNAVAILABLE" }));
    const c = fakeClient();
    await expect(
      service.resolvePick(c, { clientId: CLIENT, pick: { provider_place_id: "p9", query: "x" } }),
    ).resolves.toBeNull();
  });

  it("returns the four ends' ids and text, the place's name standing in for missing text", async () => {
    const c = fakeClient({ byId: place() });
    const out = await service.resolveQuotePlaces(c, {
      clientId: CLIENT,
      data: {
        origin_location: "Shanghai",
        destination_location: "",
        destination_place: { geo_place_id: place().geo_place_id },
        delivery_location: "Behind the Total station, Bonabéri",
      },
    });
    expect(out).toEqual({
      origin_place_id: null,
      origin_location: "Shanghai",
      destination_place_id: place().geo_place_id,
      destination_location: "Douala",
      collection_place_id: null,
      collection_location: null,
      delivery_place_id: null,
      delivery_location: "Behind the Total station, Bonabéri",
    });
  });
});

describe("the validators", () => {
  it("reads the search's query string, one kind or several", () => {
    expect(schemas.places.parse({ q: "dou", kind: "AIRPORT", provider: "true" })).toEqual({
      q: "dou",
      kind: ["AIRPORT"],
      provider: true,
    });
    expect(schemas.places.parse({ kind: ["SEAPORT", "TERMINAL"] }).kind).toEqual(["SEAPORT", "TERMINAL"]);
    expect(schemas.places.parse({}).provider).toBe(false);
  });

  it("refuses a kind outside the vocabulary and any key it does not know", () => {
    expect(schemas.places.safeParse({ kind: "PLANET" }).success).toBe(false);
    expect(schemas.places.safeParse({ q: "x", limit: "500" }).success).toBe(false);
  });

  it("takes a pick as an id or a provider suggestion — never a coordinate", () => {
    const base = { service_category: "Air · Import", origin_location: "Guangzhou", destination_location: "Douala" };
    expect(schemas.portalQuote.safeParse({ ...base, origin_place: { geo_place_id: place().geo_place_id } }).success).toBe(true);
    expect(
      schemas.portalQuote.safeParse({ ...base, origin_place: { provider_place_id: "p", query: "guangzhou", country: "CN" } }).success,
    ).toBe(true);
    expect(
      schemas.portalQuote.safeParse({
        ...base,
        origin_place: { provider_place_id: "p", query: "guangzhou", latitude: 23.1, longitude: 113.2 },
      }).success,
    ).toBe(false);
  });

  it("takes the two doors as optional text", () => {
    const base = { service_category: "Sea · Import", origin_location: "Shanghai", destination_location: "Douala" };
    const out = schemas.portalQuote.parse({ ...base, collection_location: "", delivery_location: "Bonabéri" });
    expect(out.collection_location).toBeUndefined();
    expect(out.delivery_location).toBe("Bonabéri");
  });
});
