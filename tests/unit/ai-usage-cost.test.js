"use strict";
/**
 * AI usage metering — the ledger must cost a call, not just count it.
 *
 * The screen that prompted these tests showed 29 metered calls, ~250k tokens,
 * and "0.00 XAF" on every row. Three separate things had to be true at once for
 * that to happen, so there is a test for each:
 *   1. the vendor row carries no token rates → nothing to multiply by;
 *   2. the rate is in USD and was never converted → $0.0027 rounded to 0.00;
 *   3. the model that was billed was never written to the row.
 */
const governance = require("../../src/modules/ai/governance/governance.service");
const {
  estimateCostNative,
} = require("../../src/modules/ai/governance/governance.rules");

const DEEPSEEK = {
  vendor: "deepseek",
  current_model: "deepseek-chat",
  cost_per_1k_input_tokens: "0.000270",
  cost_per_1k_output_tokens: "0.001100",
  cost_per_audio_minute: "0",
  cost_native_currency: "USD",
};

/**
 * Tenant client answering by SQL shape. `fx` is the XAF→USD rate the currency
 * feed stores (base→quote, the direction fx-sync writes); null = unpriced pair.
 * Captures the INSERT so a test can assert what was actually written.
 */
function fakeClient({ vendor = DEEPSEEK, fx = 0.0016, base = "XAF" } = {}) {
  const inserted = [];
  return {
    inserted,
    query: async (sql, params) => {
      if (/FROM ai_budget_period/.test(sql))
        return { rows: [{ period_id: "p1" }] };
      if (/FROM ai_vendor_credential/.test(sql))
        return { rows: vendor ? [vendor] : [] };
      if (/FROM currency\b/.test(sql) && /is_base/.test(sql))
        return { rows: base ? [{ code: base }] : [] };
      if (/FROM fx_rate_daily/.test(sql)) {
        const [b, q] = params;
        if (fx === null || b !== "XAF" || q !== "USD") return { rows: [] };
        return {
          rows: [
            {
              base_code: b,
              quote_code: q,
              rate: fx,
              as_of_date: "2020-01-01",
              source: "exchangerate-api",
              is_override: false,
            },
          ],
        };
      }
      if (/INSERT INTO ai_usage_ledger/i.test(sql)) {
        inserted.push({ sql, params });
        return { rows: [{ usage_id: 1 }] };
      }
      return { rows: [] };
    },
  };
}

/** Read a written column out of the captured parameterised INSERT. */
function written(client, column) {
  const { sql, params } = client.inserted[0];
  const cols = sql
    .slice(sql.indexOf("(") + 1, sql.indexOf(")"))
    .split(",")
    .map((c) => c.trim().replace(/"/g, ""));
  const i = cols.indexOf(column);
  return i === -1 ? undefined : params[i];
}

const CALL = {
  userId: "11111111-1111-1111-1111-111111111111",
  featureKey: "assistant",
  provider: "deepseek",
  callType: "chat",
  inputTokens: 10000,
  outputTokens: 200,
};

describe("ai usage cost", () => {
  test("native cost keeps the precision a per-1k USD rate needs", () => {
    // 10 × 0.00027 + 0.2 × 0.0011 = 0.0027 + 0.00022
    expect(
      estimateCostNative({
        inputTokens: 10000,
        outputTokens: 200,
        vendor: DEEPSEEK,
      }),
    ).toBeCloseTo(0.00292, 6);
  });

  test("a USD-priced call converts into the base currency instead of rounding to zero", async () => {
    const client = fakeClient();
    await governance.recordUsage(client, CALL);
    // 0.00292 USD ÷ 0.0016 (XAF→USD) = 1.825 → 1.82 XAF. Visible at 2dp, which
    // the unconverted USD figure never was.
    expect(Number(written(client, "cost_xaf"))).toBeCloseTo(1.82, 2);
    expect(Number(written(client, "cost_native"))).toBeCloseTo(0.00292, 6);
    expect(written(client, "cost_native_currency")).toBe("USD");
  });

  test("the billed model is recorded, not just the vendor", async () => {
    const client = fakeClient();
    await governance.recordUsage(client, CALL);
    expect(written(client, "model")).toBe("deepseek-chat");
    const explicit = fakeClient();
    await governance.recordUsage(explicit, { ...CALL, model: "deepseek-reasoner" });
    expect(written(explicit, "model")).toBe("deepseek-reasoner");
  });

  test("an unpriced vendor costs nothing — and says so in native terms too", async () => {
    const client = fakeClient({
      vendor: { ...DEEPSEEK, cost_per_1k_input_tokens: "0", cost_per_1k_output_tokens: "0" },
    });
    await governance.recordUsage(client, CALL);
    expect(Number(written(client, "cost_xaf"))).toBe(0);
    expect(Number(written(client, "cost_native"))).toBe(0);
  });

  test("no FX rate on file → native cost stands, base cost is 0 (never the raw USD)", async () => {
    const client = fakeClient({ fx: null });
    await governance.recordUsage(client, CALL);
    expect(Number(written(client, "cost_xaf"))).toBe(0);
    expect(Number(written(client, "cost_native"))).toBeCloseTo(0.00292, 6);
  });

  test("a caller that priced the call itself is not second-guessed", async () => {
    const client = fakeClient();
    await governance.recordUsage(client, { ...CALL, costXaf: 42 });
    expect(Number(written(client, "cost_xaf"))).toBe(42);
  });
});
