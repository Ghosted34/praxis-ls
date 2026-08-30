"use strict";

/**
 * The public place picker — what it will and will not tell a stranger.
 *
 * Two things are being protected here, and neither is visible in the happy
 * path:
 *
 *   · the tenant's own `geo_place` catalogue never appears in a response. It
 *     holds customer doors and named clients' yards, put there deliberately by
 *     `geo_place.createManual`, and `geo_place.search` returns it. A public
 *     wrapper built on that function would let anyone enumerate a forwarder's
 *     client addresses three letters at a time.
 *   · the provider's failure modes are collapsed. NO_KEY and UNAUTHORISED are
 *     sentences about OUR configuration, and a visitor can act on none of them.
 */

jest.mock("../../src/services/geoapify.service");
jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const geoapify = require("../../src/services/geoapify.service");
const { logger } = require("../../src/config/logger");
const service = require("../../src/modules/operations/geo_place_public/geo_place_public.service");
const { schemas } = require("../../src/modules/operations/geo_place_public/geo_place_public.validator");

const candidate = (over = {}) => ({
  provider_place_id: "p1",
  name: "Douala",
  formatted: "Douala, Littoral, Cameroon",
  country: "CM",
  region: "Littoral",
  latitude: 4.05,
  longitude: 9.7,
  kind: "CITY",
  result_type: "city",
  confidence: 0.94,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe("what comes back", () => {
  it("returns the provider's candidates, trimmed to what a visitor needs", async () => {
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [candidate()], query: "dou" });
    const out = await service.search("douala");
    expect(out.status).toBe("OK");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toEqual({
      provider_place_id: "p1",
      name: "Douala",
      formatted: "Douala, Littoral, Cameroon",
      country: "CM",
      latitude: 4.05,
      longitude: 9.7,
      kind: "CITY",
    });
  });

  it("withholds the provider's ranking internals", async () => {
    // confidence and result_type are how WE rank and classify; a visitor has no
    // use for either and they are the shape of a provider fingerprint.
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [candidate()], query: "dou" });
    const out = await service.search("douala");
    expect(out.results[0]).not.toHaveProperty("confidence");
    expect(out.results[0]).not.toHaveProperty("result_type");
    expect(out.results[0]).not.toHaveProperty("region");
  });

  it("biases towards the region this tenant works in without filtering to it", async () => {
    // A prospect shipping from Shanghai must still find Shanghai.
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [], query: "port" });
    await service.search("port");
    const opts = geoapify.searchPlaces.mock.calls[0][1];
    expect(opts.bias).toBe(service.DEFAULT_BIAS);
    expect(opts.countryCodes).toBeNull();
  });

  it("passes a country filter through when one is asked for", async () => {
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [], query: "port" });
    await service.search("port", { country: "CM" });
    expect(geoapify.searchPlaces.mock.calls[0][1].countryCodes).toEqual(["CM"]);
  });
});

describe("the catalogue is never reached", () => {
  it("asks the provider and opens no database connection", async () => {
    // Every other public service in this codebase takes a `client` first. This
    // one takes the query text — there is no connection to thread through it
    // and so no schema for a visitor to select, which is a stronger version of
    // the "pinned to LIVE" guarantee rather than an exception to it. Arity of 1
    // (the options object is defaulted, so it does not count) is the mechanical
    // form of that: adding a client parameter fails here.
    geoapify.searchPlaces.mockResolvedValue({ status: "OK", results: [], query: "x" });
    expect(service.search).toHaveLength(1);
    await service.search("douala");
    expect(geoapify.searchPlaces).toHaveBeenCalledTimes(1);
  });
});

describe("failures a visitor cannot act on", () => {
  it.each(["NO_KEY", "UNAUTHORISED", "RATE_LIMITED", "TIMEOUT", "PROVIDER_ERROR"])(
    "reports %s as a plain UNAVAILABLE",
    async (status) => {
      // "The place provider rejected our key" is a sentence about our Platform
      // Console, addressed to the internet.
      geoapify.searchPlaces.mockResolvedValue({ status, results: [], query: "dou" });
      const out = await service.search("douala");
      expect(out).toEqual({ status: "UNAVAILABLE", results: [] });
    },
  );

  it("logs the real status, so an outage is still tellable from a misconfiguration", async () => {
    geoapify.searchPlaces.mockResolvedValue({ status: "NO_KEY", results: [], query: "dou" });
    await service.search("douala");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ providerStatus: "NO_KEY" }),
      expect.any(String),
    );
  });

  it("says TOO_SHORT rather than pretending nothing matched", async () => {
    // "Nothing found" for two characters teaches a visitor their port is not
    // listed. The provider refuses to spend a request; say why.
    geoapify.searchPlaces.mockResolvedValue({ status: "QUERY_TOO_SHORT", results: [], query: "do" });
    const out = await service.search("do");
    expect(out.status).toBe("TOO_SHORT");
  });

  it("carries no message, because the site is bilingual", async () => {
    // A sentence composed on the server is English on a French page.
    geoapify.searchPlaces.mockResolvedValue({ status: "TIMEOUT", results: [], query: "dou" });
    const out = await service.search("douala");
    expect(out).not.toHaveProperty("message");
  });
});

describe("the query is bounded", () => {
  it("refuses an unbounded search string", () => {
    // The provider is paid per request; a 4 kB query is not somebody looking
    // for a port.
    expect(schemas.search.safeParse({ q: "x".repeat(121) }).success).toBe(false);
    expect(schemas.search.safeParse({ q: "Douala" }).success).toBe(true);
  });

  it("refuses a country code that is not two letters", () => {
    // searchPlaces relies on this to stop a value smuggling a second clause
    // into the provider's filter grammar.
    expect(schemas.search.safeParse({ q: "port", country: "CMR" }).success).toBe(false);
    expect(schemas.search.safeParse({ q: "port", country: "c,m" }).success).toBe(false);
    expect(schemas.search.safeParse({ q: "port", country: "cm" }).success).toBe(true);
  });

  it("refuses an unknown parameter rather than ignoring it", () => {
    expect(schemas.search.safeParse({ q: "port", apiKey: "hunter2" }).success).toBe(false);
  });

  it("caps how many results one caller may ask for", () => {
    expect(schemas.search.safeParse({ q: "port", limit: 50 }).success).toBe(false);
    expect(schemas.search.safeParse({ q: "port", limit: "6" }).success).toBe(true);
  });
});
