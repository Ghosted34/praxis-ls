"use strict";

/**
 * CodeQL js/remote-property-injection on currency.service rateMap: `extra`
 * codes can originate in a request body (extra-charge simulator's currency),
 * and `out[code] = rate` is a write to a caller-influenced property name.
 * These tests pin the two-layer hardening: hostile keys are filtered by the
 * ISO-4217 shape, and even if one slipped the filter the map is built on a
 * null prototype so Object.prototype can never be reached.
 */
const service = require("../../src/modules/master/currency/currency.service");

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

function fakeClient({ active = ["USD"], rate = 615.5 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/is_base/.test(sql) && /SELECT/i.test(sql))
        return { rows: [{ code: "XAF" }] };
      if (/is_active/.test(sql) && /SELECT/i.test(sql))
        return { rows: active.map((code) => ({ code })) };
      if (/fx_rate_daily/.test(sql))
        return {
          rows: [
            {
              base_code: "XAF",
              quote_code: params && params[1],
              rate,
              as_of_date: "2026-08-19",
              source: "api",
              is_override: false,
              rate_id: UUID(1),
            },
          ],
        };
      return { rows: [] };
    },
  };
}

describe("rateMap — property-injection hardening", () => {
  it("drops extras that do not look like an ISO-4217 code", async () => {
    const out = await service.rateMap(fakeClient(), {
      extra: [
        "__proto__",
        "constructor",
        "prototype",
        "eur",
        "TOOLONG",
        "",
        null,
        "E!R",
      ],
    });
    // The hostile/garbage keys never became properties…
    expect(Object.keys(out).sort()).toEqual(["EUR", "USD", "XAF"]);
    // …and nothing leaked onto Object.prototype.
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.rate).toBeUndefined();
  });

  it("still returns a plain, spreadable record with the base at 1", async () => {
    const out = await service.rateMap(fakeClient(), { extra: ["EUR"] });
    expect(out.XAF).toBe(1);
    expect(out.USD).toBe(615.5);
    expect({ ...out }.EUR).toBe(615.5); // spread works — ordinary object out
  });

  it("a well-formed but unpriced code is omitted, not an error", async () => {
    const c = fakeClient();
    // Make the rate lookup fail for one code only.
    const origQuery = c.query.bind(c);
    c.query = async (sql, params) => {
      if (/fx_rate_daily/.test(sql) && params && params[1] === "GBP")
        return { rows: [] };
      return origQuery(sql, params);
    };
    const out = await service.rateMap(c, { extra: ["GBP"] });
    expect(out.GBP).toBeUndefined();
    expect(out.USD).toBe(615.5);
  });
});
