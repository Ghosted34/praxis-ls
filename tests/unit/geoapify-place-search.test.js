/**
 * `geoapify.searchPlaces` — the provider search behind the picker's "search
 * worldwide", and specifically the two things `forwardGeocode` cannot do:
 * return SEVERAL candidates, and say WHY it returned none.
 *
 * The error taxonomy is the reason this file is long. `forwardGeocode` collapses
 * every failure to null because its caller (the map) can only omit the lane
 * either way. The picker faces a person, and "no such place", "no API key
 * configured" and "today's quota is gone" need three different sentences —
 * two of which are somebody's job to fix. Each branch is pinned here because a
 * regression to a single null would be invisible in the UI: the operator would
 * just be told, forever, that their warehouse does not exist.
 *
 * Hermetic: axios and the platform settings store are both mocked, so no
 * network and no database.
 */
"use strict";

jest.mock("axios");
const axios = require("axios");

jest.mock("../../src/services/platform/settings.service", () => ({
  resolve: jest.fn(async () => ({ secret: "platform-key" })),
}));
const settings = require("../../src/services/platform/settings.service");

const geoapify = require("../../src/services/geoapify.service");
const { logger } = require("../../src/config/logger");

/** One Geoapify autocomplete result, in the `format=json` shape. */
const hit = (over = {}) => ({
  place_id: "pid-1",
  name: "Zone Industrielle Bassa",
  formatted: "Zone Industrielle Bassa, Douala, Cameroon",
  country_code: "cm",
  state: "Littoral",
  lat: 4.0311,
  lon: 9.7085,
  result_type: "amenity",
  rank: { confidence: 0.84 },
  ...over,
});

const upstream = (over) => ({ data: { results: [hit(over)] } });

/** An axios rejection shaped the way axios actually shapes them, INCLUDING the
 *  `config.params.apiKey` that the leak test below is about. */
function axiosError({ code = null, status = null } = {}) {
  const err = new Error(status ? `Request failed with status code ${status}` : "boom");
  if (code) err.code = code;
  if (status) err.response = { status, data: { message: "nope" } };
  err.config = { params: { text: "bassa", apiKey: "platform-key" } };
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  geoapify.resetCache();
  settings.resolve.mockResolvedValue({ secret: "platform-key" });
  delete process.env.GEOAPIFY_API_KEY;
});

describe("key resolution", () => {
  test("uses the platform setting when one is configured", async () => {
    axios.get.mockResolvedValue(upstream());
    const out = await geoapify.searchPlaces("bassa");
    expect(out.status).toBe("OK");
    expect(axios.get.mock.calls[0][1].params.apiKey).toBe("platform-key");
  });

  test("falls back to the environment when the platform store has no key", async () => {
    settings.resolve.mockResolvedValue({ secret: null });
    process.env.GEOAPIFY_API_KEY = "env-key";
    axios.get.mockResolvedValue(upstream());
    await geoapify.searchPlaces("bassa");
    expect(axios.get.mock.calls[0][1].params.apiKey).toBe("env-key");
  });

  test("falls back to the environment when the platform store itself throws", async () => {
    settings.resolve.mockRejectedValue(new Error("platform db down"));
    process.env.GEOAPIFY_API_KEY = "env-key";
    axios.get.mockResolvedValue(upstream());
    const out = await geoapify.searchPlaces("bassa");
    expect(out.status).toBe("OK");
  });

  test("NO_KEY, and no request, when nothing is configured anywhere", async () => {
    settings.resolve.mockResolvedValue({ secret: null });
    const out = await geoapify.searchPlaces("bassa");
    expect(out).toEqual({ status: "NO_KEY", results: [], query: "bassa" });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("resetCache re-reads the key, so a Platform Console change takes effect", async () => {
    axios.get.mockResolvedValue(upstream());
    await geoapify.searchPlaces("bassa");
    settings.resolve.mockResolvedValue({ secret: "rotated-key" });
    await geoapify.searchPlaces("bassa");
    // Still the old key: it is cached on purpose, one resolve per process.
    expect(axios.get.mock.calls[1][1].params.apiKey).toBe("platform-key");
    geoapify.resetCache();
    await geoapify.searchPlaces("bassa");
    expect(axios.get.mock.calls[2][1].params.apiKey).toBe("rotated-key");
  });
});

describe("spending a request at all", () => {
  test("a blank query never reaches the provider", async () => {
    const out = await geoapify.searchPlaces("   ");
    expect(out.status).toBe("QUERY_TOO_SHORT");
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("a query shorter than the minimum never reaches the provider", async () => {
    const out = await geoapify.searchPlaces("do");
    expect(out.status).toBe("QUERY_TOO_SHORT");
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("the result limit is capped, whatever the caller asks for", async () => {
    axios.get.mockResolvedValue(upstream());
    await geoapify.searchPlaces("bassa", { limit: 5000 });
    expect(axios.get.mock.calls[0][1].params.limit).toBe(geoapify.MAX_RESULTS);
  });

  test("a country filter is encoded as the provider's own filter grammar", async () => {
    axios.get.mockResolvedValue(upstream());
    await geoapify.searchPlaces("bassa", { countryCodes: ["CM", "TD"] });
    expect(axios.get.mock.calls[0][1].params.filter).toBe("countrycode:cm,td");
  });

  test("a country value that is not a country code is dropped, not forwarded", async () => {
    axios.get.mockResolvedValue(upstream());
    // The validator already constrains this; the service does not rely on that,
    // because a filter string is provider grammar and must not be assemblable
    // from arbitrary input.
    await geoapify.searchPlaces("bassa", { countryCodes: ["cm,de&bias=proximity:0,0"] });
    expect(axios.get.mock.calls[0][1].params.filter).toBeUndefined();
  });

  test("a proximity bias is passed through", async () => {
    axios.get.mockResolvedValue(upstream());
    await geoapify.searchPlaces("bassa", { bias: "9.70,4.05" });
    expect(axios.get.mock.calls[0][1].params.bias).toBe("proximity:9.70,4.05");
  });
});

describe("normalising what comes back", () => {
  test("a provider result becomes a flat candidate with only our fields", async () => {
    axios.get.mockResolvedValue(upstream());
    const { results } = await geoapify.searchPlaces("bassa");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      provider_place_id: "pid-1",
      name: "Zone Industrielle Bassa",
      formatted: "Zone Industrielle Bassa, Douala, Cameroon",
      country: "CM",
      region: "Littoral",
      latitude: 4.0311,
      longitude: 9.7085,
      kind: "ADDRESS",
      result_type: "amenity",
      confidence: 0.84,
    });
  });

  test("the GeoJSON shape is read too, in case format=json is dropped upstream", async () => {
    axios.get.mockResolvedValue({ data: { features: [{ properties: hit() }] } });
    const { results, status } = await geoapify.searchPlaces("bassa");
    expect(status).toBe("OK");
    expect(results[0].name).toBe("Zone Industrielle Bassa");
  });

  test("result_type maps to our kind vocabulary", async () => {
    axios.get.mockResolvedValue({
      data: {
        results: [
          hit({ place_id: "a", result_type: "city", lat: 1, lon: 1 }),
          hit({ place_id: "b", result_type: "building", lat: 2, lon: 2 }),
          hit({ place_id: "c", result_type: "county", lat: 3, lon: 3 }),
          hit({ place_id: "d", result_type: "something-new", lat: 4, lon: 4 }),
        ],
      },
    });
    const { results } = await geoapify.searchPlaces("bassa", { limit: 10 });
    expect(results.map((r) => r.kind)).toEqual(["CITY", "ADDRESS", "OTHER", "OTHER"]);
  });

  test("a candidate with no usable coordinate is dropped, not returned as NaN", async () => {
    axios.get.mockResolvedValue({
      data: { results: [hit({ lat: null, lon: null }), hit({ place_id: "ok", lat: 5, lon: 5 })] },
    });
    const { results } = await geoapify.searchPlaces("bassa", { limit: 10 });
    expect(results.map((r) => r.provider_place_id)).toEqual(["ok"]);
  });

  test("an out-of-range coordinate is dropped — provider data is untrusted", async () => {
    axios.get.mockResolvedValue({ data: { results: [hit({ lat: 91, lon: 500 })] } });
    const { results } = await geoapify.searchPlaces("bassa");
    expect(results).toEqual([]);
  });

  test("the same point returned twice under two ids is deduplicated", async () => {
    axios.get.mockResolvedValue({
      data: { results: [hit({ place_id: "a" }), hit({ place_id: "b" })] },
    });
    const { results } = await geoapify.searchPlaces("bassa", { limit: 10 });
    expect(results).toHaveLength(1);
  });

  test("a nameless city result takes its name from the address, not from nothing", async () => {
    axios.get.mockResolvedValue({
      data: { results: [hit({ name: undefined, city: undefined, state: undefined, formatted: "Kribi, Cameroon" })] },
    });
    const { results } = await geoapify.searchPlaces("kribi");
    expect(results[0].name).toBe("Kribi");
  });

  test("provider strings are length-capped so a hostile payload cannot travel", async () => {
    axios.get.mockResolvedValue({
      data: { results: [hit({ name: "x".repeat(5000), formatted: "y".repeat(5000) })] },
    });
    const { results } = await geoapify.searchPlaces("bassa");
    expect(results[0].name).toHaveLength(200);
    expect(results[0].formatted).toHaveLength(500);
  });

  test("a garbage payload yields an empty OK rather than throwing", async () => {
    axios.get.mockResolvedValue({ data: { unexpected: true } });
    const out = await geoapify.searchPlaces("bassa");
    expect(out).toEqual({ status: "OK", results: [], query: "bassa" });
  });

  test("confidence is clamped to 0..1", async () => {
    axios.get.mockResolvedValue({ data: { results: [hit({ rank: { confidence: 7 } })] } });
    const { results } = await geoapify.searchPlaces("bassa");
    expect(results[0].confidence).toBe(1);
  });
});

describe("the failure taxonomy", () => {
  test.each([
    ["a timeout", { code: "ECONNABORTED" }, "TIMEOUT"],
    ["a socket timeout", { code: "ETIMEDOUT" }, "TIMEOUT"],
    ["a rejected key", { status: 401 }, "UNAUTHORISED"],
    ["a forbidden key", { status: 403 }, "UNAUTHORISED"],
    ["an exhausted quota", { status: 429 }, "RATE_LIMITED"],
    ["anything else", { status: 500 }, "PROVIDER_ERROR"],
  ])("%s is reported as %s", async (_label, shape, expected) => {
    axios.get.mockRejectedValue(axiosError(shape));
    const out = await geoapify.searchPlaces("bassa");
    expect(out.status).toBe(expected);
    expect(out.results).toEqual([]);
  });

  test("it never throws — the picker must always get an answer", async () => {
    axios.get.mockRejectedValue(new Error("unshaped"));
    await expect(geoapify.searchPlaces("bassa")).resolves.toMatchObject({ status: "PROVIDER_ERROR" });
  });
});

describe("the API key never reaches a log", () => {
  test("a provider failure logs a description, not the axios error", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    axios.get.mockRejectedValue(axiosError({ status: 429 }));
    await geoapify.searchPlaces("bassa");

    expect(warn).toHaveBeenCalled();
    // The whole point: `logger.warn({ err })` would serialise err.config.params,
    // which holds the deploy-wide key. Assert on the FULL logged payload, not on
    // the absence of one field, so any future field that carries the key fails
    // this test too.
    const logged = JSON.stringify(warn.mock.calls.map((c) => c[0]));
    expect(logged).not.toContain("platform-key");
    expect(logged).not.toContain("apiKey");
    warn.mockRestore();
  });

  test("the same holds for forward geocoding, which had the original leak", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    axios.get.mockRejectedValue(axiosError({ status: 500 }));
    await geoapify.forwardGeocode("Douala");
    expect(JSON.stringify(warn.mock.calls.map((c) => c[0]))).not.toContain("platform-key");
    warn.mockRestore();
  });

  test("and for reverse geocoding", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    axios.get.mockRejectedValue(axiosError({ status: 500 }));
    await geoapify.reverseGeocode(4.05, 9.7);
    expect(JSON.stringify(warn.mock.calls.map((c) => c[0]))).not.toContain("platform-key");
    warn.mockRestore();
  });
});
