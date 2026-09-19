"use strict";

/**
 * C-PR-02 — the shared FX sync CORE (currency.sync.syncRates), audit #6.
 *
 * The provider HTTP is mocked; the tenant client is a fake that records queries.
 * Pins:
 *   - the daily run is wrapped in ONE transaction (BEGIN/COMMIT around the
 *     upserts), so a mid-run DB failure cannot leave a partial day silently;
 *   - feed rows are written is_override=false (source 'exchangerate-api'), so a
 *     manual override is never overwritten by the feed;
 *   - quotes the provider returned no rate for land on `unsupported`, not as a
 *     zero/garbage rate;
 *   - a non-200 / provider-error response throws (recorded by syncNow as an
 *     error run) and never mentions the URL (the API key is a path segment).
 */

jest.mock("axios");
const axios = require("axios");
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn().mockResolvedValue(null) }));
jest.mock("../../src/modules/security/setting/setting.service", () => ({ readSecret: jest.fn().mockResolvedValue("TESTKEY") }));

const sync = require("../../src/modules/master/currency/currency.sync");

function fakeClient({ base = "XAF", active = ["USD", "EUR", "ZZZ"] } = {}) {
  const queries = [];
  const upserts = [];
  return {
    queries,
    upserts,
    async query(sql, params) {
      queries.push({ sql, params });
      // A connection NOT already in a transaction: the tx-helper's SAVEPOINT
      // probe fails (25P01), so atomically() opens its own BEGIN/COMMIT.
      if (/SAVEPOINT/i.test(sql)) throw Object.assign(new Error("25P01"), { code: "25P01" });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
      if (/WHERE is_base = true ORDER BY code/i.test(sql)) return { rows: [{ code: base }] };
      if (/SELECT code FROM currency WHERE is_active = true/i.test(sql)) return { rows: active.map((code) => ({ code })) };
      if (/INSERT INTO fx_rate_daily/i.test(sql)) {
        upserts.push(params);
        return { rows: [{ base_code: params[0], quote_code: params[1] }] };
      }
      return { rows: [] };
    },
  };
}

afterEach(() => jest.clearAllMocks());

describe("syncRates — provider success", () => {
  it("wraps the upserts in a single transaction and writes feed rows", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { result: "success", conversion_rates: { USD: 0.0016, EUR: 0.0015 } } });
    const c = fakeClient({ active: ["USD", "EUR", "ZZZ"] });
    const out = await sync.syncRates(c, {});

    const sqls = c.queries.map((q) => q.sql);
    expect(sqls.some((s) => /^\s*BEGIN/i.test(s))).toBe(true);
    expect(sqls.some((s) => /^\s*COMMIT/i.test(s))).toBe(true);

    // Two written, ZZZ unsupported.
    expect(out.updated.map((u) => u.quote).sort()).toEqual(["EUR", "USD"]);
    expect(out.unsupported).toEqual(["ZZZ"]);

    // Every write is a feed row (is_override=false, source exchangerate-api).
    for (const p of c.upserts) {
      expect(p[4]).toBe("exchangerate-api"); // source
      expect(p[5]).toBe(false); // is_override
    }
  });

  it("skips (no HTTP) when there are no active quote currencies", async () => {
    const c = fakeClient({ active: ["XAF"] }); // only the base
    const out = await sync.syncRates(c, {});
    expect(out.skipped).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("syncRates — provider failure", () => {
  it("throws on a non-200 without leaking the URL/key", async () => {
    axios.get.mockResolvedValue({ status: 500, data: { "error-type": "server-error" } });
    const c = fakeClient();
    await expect(sync.syncRates(c, {})).rejects.toThrow(/HTTP 500/);
    await expect(sync.syncRates(c, {})).rejects.not.toThrow(/TESTKEY/);
    expect(c.upserts).toHaveLength(0); // nothing written on failure
  });

  it("throws a helpful message on a 404 (unrecognised key) without the URL", async () => {
    axios.get.mockResolvedValue({ status: 404, data: {} });
    const c = fakeClient();
    const err = await sync.syncRates(c, {}).catch((e) => e);
    expect(err.message).toMatch(/404/);
    expect(err.message).not.toMatch(/TESTKEY/);
  });
});
