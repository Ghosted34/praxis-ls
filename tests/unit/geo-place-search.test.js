/**
 * The place catalogue: search ranking, cache-first provider policy, confirmation
 * of a provider suggestion, and the collision rule that stops a dossier being
 * pinned to somebody else's coordinate.
 *
 * WHY THE FAKE CLIENT INTERPRETS SQL RATHER THAN MATCHING ON IT. The ranking
 * ladder in `geo_place.repo.search` is the product behaviour under test —
 * "typing dou puts Douala first" is a promise to an operator, not an
 * implementation detail — and asserting that the SQL merely CONTAINS "match_rank"
 * would pass just as happily with the ORDER BY clauses in the wrong order. So the
 * fake below runs the same ladder against an in-memory table and the tests assert
 * on the ROWS, which is the thing anybody would notice was broken.
 *
 * The fake throws on SQL it does not model, so a new query cannot silently
 * receive an empty result and make every assertion after it meaningless.
 */
"use strict";

jest.mock("../../src/services/geoapify.service", () => ({
  searchPlaces: jest.fn(),
  forwardGeocode: jest.fn(),
  MAX_RESULTS: 10,
  MIN_QUERY_CHARS: 3,
}));

const geoapify = require("../../src/services/geoapify.service");
const service = require("../../src/modules/operations/geo_place/geo_place.service");
const repo = require("../../src/modules/operations/geo_place/geo_place.repo");

/* ── the in-memory catalogue ─────────────────────────────────────────────── */

let nextId = 1;
const place = (over = {}) => {
  const name = over.name || "Somewhere";
  return {
    geo_place_id: `gp-${nextId++}`,
    query_key: repo.normalise(name),
    name,
    country: "CM",
    region: null,
    kind: "SEAPORT",
    unlocode: null,
    formatted: null,
    latitude: "4.048200",
    longitude: "9.700400",
    source: "CATALOGUE",
    provenance: null,
    confidence: null,
    is_reference_point: false,
    is_active: true,
    verified_at: "2026-01-01T00:00:00.000Z",
    resolved_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
};

const KIND_ORDER = ["SEAPORT", "AIRPORT", "TERMINAL", "RAIL_TERMINAL", "INLAND", "BORDER_POST", "WAREHOUSE", "CITY", "ADDRESS"];

/**
 * A tenant client over an array of rows, implementing exactly the three queries
 * this module issues: findByKeys, the ranked search, and the guarded insert.
 */
function fakeClient(rows = []) {
  const state = { rows: [...rows], sql: [], inserts: [], audits: [] };
  const client = {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);

      if (/^SELECT .* FROM geo_place WHERE query_key = ANY/i.test(s)) {
        const keys = params[0];
        return { rows: state.rows.filter((r) => keys.includes(r.query_key)) };
      }

      if (/^SELECT .* FROM geo_place WHERE geo_place_id = ANY/i.test(s)) {
        const ids = params[0];
        return { rows: state.rows.filter((r) => ids.includes(r.geo_place_id)) };
      }

      if (/^INSERT INTO geo_place/i.test(s)) {
        const [queryKey, name, country, kind, latitude, longitude, source, formatted,
          unlocode, region, providerPlaceId, confidence, isReferencePoint, verifiedAt, provenance] = params;
        state.inserts.push({ queryKey, name, source, isReferencePoint, verifiedAt, kind, unlocode });
        // ON CONFLICT (query_key) DO NOTHING RETURNING *
        if (state.rows.some((r) => r.query_key === queryKey)) return { rows: [] };
        const row = place({
          query_key: queryKey, name, country, kind, latitude, longitude, source,
          formatted, unlocode, region, provider_place_id: providerPlaceId,
          confidence, is_reference_point: isReferencePoint, verified_at: verifiedAt,
          provenance,
        });
        state.rows.push(row);
        return { rows: [row] };
      }

      if (/^SELECT .* FROM geo_place/i.test(s)) return { rows: rankedSearch(s, params, state.rows) };

      // Audit writes ride through this same client. `audit()` writes the
      // immutable ledger and resolves the actor against app_user; both are
      // modelled rather than ignored, because the audit row is part of what
      // creating a place is FOR — a coordinate somebody added by hand has to be
      // attributable — and a fake that swallowed it would let that regress.
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [] };
      if (/^INSERT INTO immutable_ledger/i.test(s)) {
        state.audits.push({ action: params[4], entityRef: params[6] });
        return { rows: [{ ledger_id: `l-${state.audits.length}` }] };
      }
      if (/^SELECT .* FROM app_user/i.test(s)) return { rows: [] };
      if (/^SELECT .* FROM event_type/i.test(s)) return { rows: [] };
      throw new Error("fakeClient: unmodelled SQL: " + s.slice(0, 160));
    },
  };
  return client;
}

/** The ladder from geo_place.repo.search, applied to rows in memory. */
function rankedSearch(sql, params, rows) {
  const limit = params[params.length - 1];
  const ranked = sql.includes("match_rank");
  // Params are appended in source order: [country?], [kinds?], code, term,
  // prefix, contains, limit — read from the end, which is stable either way.
  const [code, term, prefix, contains] = ranked ? params.slice(-5, -1) : [null, null, null, null];
  const country = /country = \$/.test(sql) ? params[0] : null;
  const kindsIdx = sql.indexOf("kind = ANY");
  const kinds = kindsIdx === -1 ? null : params[country ? 1 : 0];

  let out = rows.filter((r) => r.is_active);
  if (country) out = out.filter((r) => r.country === country);
  if (kinds) out = out.filter((r) => kinds.includes(r.kind));

  const like = (value, pattern) => {
    if (value === null || value === undefined) return false;
    const re = new RegExp("^" + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
    return re.test(String(value));
  };

  if (ranked) {
    const rankOf = (r) => {
      if (r.unlocode && r.unlocode === code) return 0;
      if (r.query_key === term) return 1;
      if (like(r.query_key, prefix)) return 2;
      if (like(r.query_key, contains)) return 3;
      return 4;
    };
    out = out.filter((r) => rankOf(r) < 4 || like(r.formatted, contains));
    out = out.map((r) => ({ ...r, match_rank: rankOf(r) }));
    out.sort(
      (a, b) =>
        a.match_rank - b.match_rank ||
        Number(!!b.verified_at) - Number(!!a.verified_at) ||
        Number(a.is_reference_point) - Number(b.is_reference_point) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.name.localeCompare(b.name) ||
        a.geo_place_id.localeCompare(b.geo_place_id),
    );
  } else {
    out.sort(
      (a, b) =>
        Number(!!b.verified_at) - Number(!!a.verified_at) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.name.localeCompare(b.name) ||
        a.geo_place_id.localeCompare(b.geo_place_id),
    );
  }
  return out.slice(0, limit);
}

const CATALOGUE = () => [
  place({ name: "Douala", unlocode: "CMDLA", kind: "SEAPORT", latitude: "4.048200", longitude: "9.700400" }),
  place({ name: "Douala Airport", kind: "AIRPORT", formatted: "DLA · Douala Airport airport, Douala", latitude: "4.006100", longitude: "9.719500" }),
  place({ name: "Kribi", unlocode: "CMKBI", kind: "SEAPORT", latitude: "2.936900", longitude: "9.910700" }),
  place({ name: "Port-Gentil", country: "GA", unlocode: "GAPOG", kind: "SEAPORT", latitude: "-0.716700", longitude: "8.783300" }),
  place({ name: "Nairobi Jomo Kenyatta", country: "KE", kind: "AIRPORT", formatted: "NBO · Nairobi Jomo Kenyatta airport, Nairobi", latitude: "-1.319200", longitude: "36.927800" }),
  place({ name: "Yaoundé", unlocode: "CMYAO", kind: "CITY", latitude: "3.848000", longitude: "11.502100" }),
];

beforeEach(() => {
  jest.clearAllMocks();
  nextId = 1;
  geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [], query: "" });
});

/* ── ranking ─────────────────────────────────────────────────────────────── */

describe("search ranking", () => {
  test("an exact UN/LOCODE wins outright", async () => {
    const c = fakeClient(CATALOGUE());
    const { places } = await service.search(c, { q: "CMKBI" });
    expect(places[0].name).toBe("Kribi");
  });

  test("an IATA code in the formatted address finds the airport", async () => {
    const c = fakeClient(CATALOGUE());
    const { places } = await service.search(c, { q: "NBO" });
    expect(places[0].name).toBe("Nairobi Jomo Kenyatta");
  });

  test("an exact name beats a prefix match", async () => {
    const c = fakeClient(CATALOGUE());
    const { places } = await service.search(c, { q: "Douala" });
    expect(places.map((p) => p.name)).toEqual(["Douala", "Douala Airport"]);
  });

  test("a prefix ranks above a substring", async () => {
    const c = fakeClient([
      place({ name: "Port-Gentil", kind: "SEAPORT" }),
      place({ name: "Genoa", kind: "SEAPORT" }),
    ]);
    const { places } = await service.search(c, { q: "gen" });
    expect(places.map((p) => p.name)).toEqual(["Genoa", "Port-Gentil"]);
  });

  test("accents and punctuation are folded — Yaounde finds Yaoundé", async () => {
    const c = fakeClient(CATALOGUE());
    const { places } = await service.search(c, { q: "yaounde" });
    expect(places[0].name).toBe("Yaoundé");
  });

  test("an apostrophe is folded — ndjamena finds N'Djamena", async () => {
    const c = fakeClient([place({ name: "N'Djamena", country: "TD", kind: "CITY" })]);
    const { places } = await service.search(c, { q: "N’Djamena" });
    expect(places[0].name).toBe("N'Djamena");
  });

  test("within a rank, a port comes before a city", async () => {
    const c = fakeClient([
      place({ name: "Tema City", kind: "CITY", country: "GH" }),
      place({ name: "Tema Port", kind: "SEAPORT", country: "GH" }),
    ]);
    const { places } = await service.search(c, { q: "tema" });
    expect(places.map((p) => p.kind)).toEqual(["SEAPORT", "CITY"]);
  });

  test("a verified place outranks an unverified one with the same match", async () => {
    const c = fakeClient([
      place({ name: "Bassa Depot", kind: "ADDRESS", verified_at: null, source: "GEOAPIFY" }),
      place({ name: "Bassa Depot Two", kind: "ADDRESS", verified_at: "2026-01-01T00:00:00.000Z" }),
    ]);
    const { places } = await service.search(c, { q: "bassa" });
    expect(places[0].name).toBe("Bassa Depot Two");
  });

  test("an exact place outranks a reference point", async () => {
    const c = fakeClient([
      place({ name: "Gate A", kind: "ADDRESS", is_reference_point: true }),
      place({ name: "Gate B", kind: "ADDRESS", is_reference_point: false }),
    ]);
    const { places } = await service.search(c, { q: "gate" });
    expect(places[0].name).toBe("Gate B");
  });

  test("an inactive place is never offered", async () => {
    const c = fakeClient([place({ name: "Closed Terminal", kind: "TERMINAL", is_active: false })]);
    const { places } = await service.search(c, { q: "closed" });
    expect(places).toEqual([]);
  });

  test("…but it still RESOLVES, so a file already routed through it keeps working", async () => {
    const c = fakeClient([place({ name: "Closed Terminal", kind: "TERMINAL", is_active: false })]);
    const found = await service.resolveVerified(c, ["Closed Terminal"]);
    expect(found.get("Closed Terminal")).toMatchObject({ name: "Closed Terminal" });
  });

  test("country and kind filters both apply", async () => {
    const c = fakeClient(CATALOGUE());
    const { places } = await service.search(c, { q: null, country: "CM", kinds: ["AIRPORT"] });
    expect(places.map((p) => p.name)).toEqual(["Douala Airport"]);
  });

  test("no term at all browses the catalogue instead of returning nothing", async () => {
    const c = fakeClient(CATALOGUE());
    const { places } = await service.search(c, { q: null });
    expect(places.length).toBe(6);
    // Ports first — a freight file usually means the port.
    expect(places[0].kind).toBe("SEAPORT");
  });

  test("a wildcard typed by the user is not a wildcard", async () => {
    const c = fakeClient([place({ name: "Douala" }), place({ name: "Kribi" })]);
    // normalise() strips % and _, so "%" becomes an empty term and this is a
    // browse, not a match-everything LIKE injected into the pattern.
    const { places } = await service.search(c, { q: "%" });
    expect(places.length).toBe(2);
    const searchSql = c.state.sql.find((s) => s.includes("FROM geo_place"));
    expect(searchSql).not.toContain("match_rank");
  });
});

/* ── the provider policy ─────────────────────────────────────────────────── */

describe("when the provider is consulted", () => {
  test("never, unless the caller asks", async () => {
    const c = fakeClient(CATALOGUE());
    const out = await service.search(c, { q: "zone industrielle" });
    expect(geoapify.searchPlaces).not.toHaveBeenCalled();
    expect(out.provider).toEqual({ requested: false, status: "NOT_REQUESTED", message: null, results: [] });
  });

  test("not even when asked, if the catalogue has an exact answer", async () => {
    const c = fakeClient(CATALOGUE());
    const out = await service.search(c, { q: "Douala", provider: true });
    expect(geoapify.searchPlaces).not.toHaveBeenCalled();
    expect(out.has_exact).toBe(true);
  });

  test("not even when asked, if the exact answer was found by its code", async () => {
    const c = fakeClient(CATALOGUE());
    await service.search(c, { q: "CMDLA", provider: true });
    expect(geoapify.searchPlaces).not.toHaveBeenCalled();
  });

  test("yes, when asked and the catalogue has only near misses", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({
      status: "OK",
      query: "zone industrielle bassa",
      results: [{ provider_place_id: "pid-1", name: "Zone Industrielle Bassa", formatted: "Zone Industrielle Bassa, Douala, Cameroon", country: "CM", region: "Littoral", latitude: 4.0311, longitude: 9.7085, kind: "ADDRESS", confidence: 0.8 }],
    });
    const out = await service.search(c, { q: "zone industrielle bassa", provider: true });
    expect(geoapify.searchPlaces).toHaveBeenCalledTimes(1);
    expect(out.provider.results).toHaveLength(1);
    expect(out.provider.status).toBe("OK");
  });

  test("a suggestion the catalogue already holds is folded out", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({
      status: "OK",
      query: "krib",
      results: [
        { provider_place_id: "p1", name: "Kribi", formatted: "Kribi, Cameroon", country: "CM", region: null, latitude: 2.9369, longitude: 9.9107, kind: "CITY", confidence: 0.9 },
        { provider_place_id: "p2", name: "Kribi Deep Sea Port", formatted: "Kribi Deep Sea Port, Cameroon", country: "CM", region: null, latitude: 2.8, longitude: 9.85, kind: "ADDRESS", confidence: 0.7 },
      ],
    });
    // "krib" is a PREFIX match, not an exact one, so the provider is consulted —
    // and Kribi is nonetheless already on screen from the catalogue, so the
    // provider's copy of it must not appear a second time underneath.
    const out = await service.search(c, { q: "krib", provider: true });
    expect(out.provider.results.map((r) => r.provider_place_id)).toEqual(["p2"]);
  });

  test("a provider failure is reported with its status, not as an empty list", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "RATE_LIMITED", results: [], query: "x" });
    const out = await service.search(c, { q: "somewhere new", provider: true });
    expect(out.provider.status).toBe("RATE_LIMITED");
    expect(out.provider.results).toEqual([]);
    // And the sentence the operator reads travels with it, from the server, so
    // the browser never owns a second copy of this mapping.
    expect(out.provider.message).toMatch(/quota/i);
    expect(out.provider.message).toBe(service.PROVIDER_MESSAGES.RATE_LIMITED);
  });

  test("every provider status has an operator-facing message", () => {
    for (const status of ["NO_KEY", "TIMEOUT", "RATE_LIMITED", "UNAUTHORISED", "PROVIDER_ERROR", "QUERY_TOO_SHORT"]) {
      expect(service.PROVIDER_MESSAGES[status]).toBeTruthy();
    }
  });
});

/* ── confirmation ────────────────────────────────────────────────────────── */

const SUGGESTION = {
  provider_place_id: "pid-1",
  name: "Zone Industrielle Bassa",
  formatted: "Zone Industrielle Bassa, Douala, Cameroon",
  country: "CM",
  region: "Littoral",
  latitude: 4.0311,
  longitude: 9.7085,
  kind: "ADDRESS",
  confidence: 0.84,
};

describe("confirming a provider suggestion", () => {
  test("the coordinate is taken from the provider, not from the request", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [SUGGESTION], query: "bassa" });
    const row = await service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1" });
    expect(Number(row.latitude)).toBe(4.0311);
    expect(row.source).toBe("GEOAPIFY");
    // Re-queried server-side: the body carried no coordinate at all.
    expect(geoapify.searchPlaces).toHaveBeenCalledWith("bassa", expect.objectContaining({ limit: 10 }));
  });

  test("the stored name carries the locality, so the field value stands alone", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [SUGGESTION], query: "bassa" });
    const row = await service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1" });
    expect(row.name).toBe("Zone Industrielle Bassa, Douala");
    expect(row.query_key).toBe("zone industrielle bassa douala");
  });

  test("a city keeps its bare name — 'Douala, Littoral' belongs on no bill of lading", () => {
    expect(service.labelFor({ name: "Douala", formatted: "Douala, Littoral, Cameroon", kind: "CITY" })).toBe("Douala");
  });

  test("it is confirmed, so it is verified", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [SUGGESTION], query: "bassa" });
    const row = await service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1" });
    expect(row.verified_at).toBeTruthy();
  });

  test("the operator's kind overrides the provider's guess", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [SUGGESTION], query: "bassa" });
    const row = await service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1", kind: "WAREHOUSE" });
    expect(row.kind).toBe("WAREHOUSE");
  });

  test("a reference point is recorded as one, not as the exact place", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [SUGGESTION], query: "bassa" });
    const row = await service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1", isReferencePoint: true });
    expect(row.is_reference_point).toBe(true);
  });

  test("confirming twice yields one row, not two", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [SUGGESTION], query: "bassa" });
    const first = await service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1" });
    const second = await service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1" });
    expect(second.geo_place_id).toBe(first.geo_place_id);
    expect(c.state.rows.filter((r) => r.query_key === first.query_key)).toHaveLength(1);
  });

  test("a suggestion that has aged out of the results is refused, not guessed at", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [SUGGESTION], query: "bassa" });
    await expect(
      service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "some-other-id" }),
    ).rejects.toMatchObject({ code: "PLACE_SUGGESTION_EXPIRED", status: 409 });
  });

  test("a provider outage during confirmation is a typed 502, not a silent write", async () => {
    const c = fakeClient(CATALOGUE());
    geoapify.searchPlaces.mockResolvedValue({ status: "TIMEOUT", results: [], query: "bassa" });
    await expect(
      service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1" }),
    ).rejects.toMatchObject({ code: "PLACE_PROVIDER_UNAVAILABLE", status: 502 });
    expect(c.state.inserts).toHaveLength(0);
  });

  test("two different addresses that normalise alike do not merge", async () => {
    // The dangerous case: an existing place whose key the new one would take.
    // Same name, 300 km apart. Silently reusing the first would pin the dossier
    // to a coordinate nobody chose.
    const existing = place({ name: "Zone Industrielle, Douala", latitude: "4.031100", longitude: "9.708500", kind: "ADDRESS" });
    const c = fakeClient([existing]);
    geoapify.searchPlaces.mockResolvedValue({
      status: "OK",
      query: "zone industrielle",
      results: [{ ...SUGGESTION, name: "Zone Industrielle", formatted: "Zone Industrielle, Douala, Chad", region: "Logone", country: "TD", latitude: 12.1, longitude: 15.05 }],
    });
    const row = await service.confirmSuggestion(c, { query: "zone industrielle", providerPlaceId: "pid-1" });
    expect(row.geo_place_id).not.toBe(existing.geo_place_id);
    expect(row.name).toBe("Zone Industrielle, Douala (Logone)");
    expect(Number(row.latitude)).toBe(12.1);
  });

  test("the same place under the same key IS reused, and not overwritten", async () => {
    // A MANUAL correction lives under this key. Confirming the provider's answer
    // for the same point must return the correction, never replace it.
    const corrected = place({ name: "Zone Industrielle Bassa, Douala", latitude: "4.031500", longitude: "9.708900", source: "MANUAL", kind: "WAREHOUSE" });
    const c = fakeClient([corrected]);
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [SUGGESTION], query: "bassa" });
    const row = await service.confirmSuggestion(c, { query: "bassa", providerPlaceId: "pid-1" });
    expect(row.geo_place_id).toBe(corrected.geo_place_id);
    expect(row.source).toBe("MANUAL");
    expect(Number(row.latitude)).toBe(4.0315);
  });
});

/* ── manual places ───────────────────────────────────────────────────────── */

describe("adding a place by hand", () => {
  test("it is recorded as MANUAL and verified, whatever the caller says", async () => {
    const c = fakeClient([]);
    const row = await service.createManual(c, {
      name: "Entrepôt Bonabéri", latitude: 4.0669, longitude: 9.6759, country: "cm", kind: "WAREHOUSE",
      source: "SEED", // ignored on purpose
    });
    expect(row.source).toBe("MANUAL");
    expect(row.verified_at).toBeTruthy();
    expect(row.country).toBe("CM");
    expect(row.query_key).toBe("entrepot bonaberi");
  });

  test("adding the same place twice returns the first one", async () => {
    const c = fakeClient([]);
    const a = await service.createManual(c, { name: "Depot 12", latitude: 4.05, longitude: 9.7 });
    const b = await service.createManual(c, { name: "Depot 12", latitude: 4.05, longitude: 9.7 });
    expect(b.geo_place_id).toBe(a.geo_place_id);
  });

  test("reusing a name for a DIFFERENT point is refused, with the fix in the message", async () => {
    const c = fakeClient([]);
    await service.createManual(c, { name: "Depot 12", latitude: 4.05, longitude: 9.7 });
    await expect(
      service.createManual(c, { name: "Depot 12", latitude: 12.13, longitude: 15.05 }),
    ).rejects.toMatchObject({ code: "PLACE_NAME_TAKEN", status: 409 });
  });

  test("a manual place can be declared a reference point", async () => {
    const c = fakeClient([]);
    const row = await service.createManual(c, {
      name: "Carrefour Ndokoti", latitude: 4.0455, longitude: 9.7404, isReferencePoint: true,
    });
    expect(row.is_reference_point).toBe(true);
  });
});

/* ── verification ────────────────────────────────────────────────────────── */

describe("resolveVerified", () => {
  test("keys on the original value, so callers look up what they held", async () => {
    const c = fakeClient(CATALOGUE());
    const found = await service.resolveVerified(c, ["  DOUALA  ", "Kribi"]);
    expect(found.get("DOUALA").name).toBe("Douala");
    expect(found.get("Kribi").name).toBe("Kribi");
  });

  test("an unknown place maps to null rather than being absent", async () => {
    const c = fakeClient(CATALOGUE());
    const found = await service.resolveVerified(c, ["Doula"]);
    expect(found.has("Doula")).toBe(true);
    expect(found.get("Doula")).toBeNull();
  });

  test("it never reaches the network — opening a file cannot wait on a geocoder", async () => {
    const c = fakeClient(CATALOGUE());
    await service.resolveVerified(c, ["Somewhere Unknown"]);
    expect(geoapify.searchPlaces).not.toHaveBeenCalled();
    expect(geoapify.forwardGeocode).not.toHaveBeenCalled();
  });

  test("blank and duplicate values cost one query, not several", async () => {
    const c = fakeClient(CATALOGUE());
    await service.resolveVerified(c, ["Douala", "douala", "", null, "  "]);
    expect(c.state.sql.filter((s) => s.includes("query_key = ANY"))).toHaveLength(1);
  });
});
