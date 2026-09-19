"use strict";

/**
 * C-PR-01 — base-currency invariant + FORMAL REBASE (Currency audit #7).
 *
 * Two layers are pinned here:
 *   1. currency.rules.rebaseRates — the PURE cross-rate math (no DB), so the
 *      arithmetic that reinterprets the whole rate table is provable in isolation.
 *   2. currency.service.setBase — the orchestration: it rebases inside a
 *      transaction, writes the derived pairs as source 'rebase' overrides, flips
 *      the flag, refuses when there is no old→new anchor, and never rebases the
 *      first-ever base. A fake client records every query so the behaviour is
 *      asserted without a live Postgres.
 */
const { rebaseRates, round8 } = require("../../src/modules/master/currency/currency.rules");
const service = require("../../src/modules/master/currency/currency.service");

describe("rebaseRates (pure cross-rate math)", () => {
  const rows = [
    { quote_code: "USD", rate: 0.00163 },
    { quote_code: "EUR", rate: 0.00152 },
    { quote_code: "NGN", rate: 2.5 },
  ];

  it("derives new→old as the reciprocal of old→new", () => {
    const { pairs, missing } = rebaseRates(rows, "XAF", "USD");
    expect(missing).toBe(false);
    const oldPair = pairs.find((p) => p.quote === "XAF");
    expect(oldPair.rate).toBe(round8(1 / 0.00163)); // USD→XAF
  });

  it("cancels the old base out of every cross rate", () => {
    const { pairs } = rebaseRates(rows, "XAF", "USD");
    const eur = pairs.find((p) => p.quote === "EUR");
    const ngn = pairs.find((p) => p.quote === "NGN");
    expect(eur.rate).toBe(round8(0.00152 / 0.00163)); // USD→EUR
    expect(ngn.rate).toBe(round8(2.5 / 0.00163)); // USD→NGN
  });

  it("never emits a self pair (new→new)", () => {
    const { pairs } = rebaseRates(rows, "XAF", "USD");
    expect(pairs.some((p) => p.quote === "USD")).toBe(false);
  });

  it("flags missing when there is no old→new rate to anchor on", () => {
    const { pairs, missing } = rebaseRates(
      [{ quote_code: "EUR", rate: 0.00152 }],
      "XAF",
      "USD",
    );
    expect(missing).toBe(true);
    expect(pairs).toEqual([]);
  });

  it("is a no-op when old and new base are the same", () => {
    expect(rebaseRates(rows, "XAF", "XAF")).toEqual({ pairs: [], missing: false });
  });

  it("round-trips: rebasing to USD then back to XAF restores XAF→quote", () => {
    const fwd = rebaseRates(rows, "XAF", "USD");
    // Build the USD table the way it would be stored (USD→XAF, USD→EUR, USD→NGN).
    const usdRows = fwd.pairs.map((p) => ({ quote_code: p.quote, rate: p.rate }));
    const back = rebaseRates(usdRows, "USD", "XAF");
    const eur = back.pairs.find((p) => p.quote === "EUR");
    // Within rounding, XAF→EUR is recovered.
    expect(Math.abs(eur.rate - 0.00152)).toBeLessThan(1e-6);
  });
});

/**
 * A fake tenant client for setBase. Records queries; answers the handful setBase
 * needs: the SAVEPOINT probe (tx helper), BEGIN/COMMIT, getCurrency, getBaseCode,
 * latestRatesFromBase, upsertRate, setBase flag flip. Events/audit fall through to
 * the generic empty-rows branch.
 */
function fakeClient({ targetIsBase = false, oldBase = "XAF", latest = [] } = {}) {
  const queries = [];
  const upserts = [];
  return {
    queries,
    upserts,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SAVEPOINT/i.test(sql)) return { rows: [] };
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
      // getCurrency(target)
      if (/SELECT \* FROM currency WHERE code = \$1/i.test(sql)) {
        return { rows: [{ code: params[0], is_base: targetIsBase, is_active: true, name: params[0], decimals: 2 }] };
      }
      // getBaseCode
      if (/WHERE is_base = true ORDER BY code/i.test(sql)) {
        return { rows: oldBase ? [{ code: oldBase }] : [] };
      }
      // latestRatesFromBase
      if (/DISTINCT ON \(quote_code\)/i.test(sql)) {
        return { rows: latest.map((r) => ({ quote_code: r.quote_code, rate: r.rate, as_of_date: "2026-09-19", source: "manual", is_override: false })) };
      }
      // upsertRate (INSERT INTO fx_rate_daily)
      if (/INSERT INTO fx_rate_daily/i.test(sql)) {
        const [base, quote, rate, asOfDate, source, isOverride] = params;
        const row = { base_code: base, quote_code: quote, rate, as_of_date: asOfDate, source, is_override: isOverride };
        upserts.push(row);
        return { rows: [row] };
      }
      // setBase flag flip — TWO ordered statements (off-sweep, then target on).
      // The order is the contract: 13951's partial unique index is checked per
      // row, so the old base must be cleared before the target is flagged.
      if (/SET\s+is_base\s*=\s*false[\s\S]*WHERE\s+is_base\s+AND\s+code\s+<>\s*\$1/i.test(sql)) {
        return { rows: oldBase && oldBase !== params[0] ? [{ code: oldBase, is_base: false, is_active: true }] : [] };
      }
      if (/SET\s+is_base\s*=\s*true[\s\S]*WHERE\s+code\s*=\s*\$1/i.test(sql)) {
        return { rows: [{ code: params[0], is_base: true, is_active: true }] };
      }
      return { rows: [] };
    },
  };
}

describe("service.setBase — formal rebase orchestration", () => {
  it("writes rebased pairs as source 'rebase' overrides and flips the flag", async () => {
    const c = fakeClient({
      target: "USD",
      oldBase: "XAF",
      latest: [
        { quote_code: "USD", rate: 0.00163 },
        { quote_code: "EUR", rate: 0.00152 },
      ],
    });
    const out = await service.setBase(c, "USD", { user_id: null });
    expect(out.base).toBe("USD");
    expect(out.previous_base).toBe("XAF");
    // USD→XAF and USD→EUR written.
    const quotes = c.upserts.map((u) => u.quote_code).sort();
    expect(quotes).toEqual(["EUR", "XAF"]);
    for (const u of c.upserts) {
      expect(u.source).toBe("rebase");
      expect(u.is_override).toBe(true);
      expect(u.base_code).toBe("USD");
    }
  });

  it("refuses the rebase when there is no old→new anchor rate", async () => {
    const c = fakeClient({
      target: "USD",
      oldBase: "XAF",
      latest: [{ quote_code: "EUR", rate: 0.00152 }], // no XAF→USD
    });
    await expect(service.setBase(c, "USD", {})).rejects.toMatchObject({ code: "NO_REBASE_RATE" });
    expect(c.upserts).toEqual([]); // nothing written — transaction would roll back
  });

  it("does not rebase the first-ever base (no old base to convert from)", async () => {
    const c = fakeClient({ target: "XAF", oldBase: null, latest: [] });
    const out = await service.setBase(c, "XAF", {});
    expect(out.rebased).toEqual([]);
    expect(c.upserts).toEqual([]);
  });

  it("is a no-op when the target is already the base", async () => {
    const c = fakeClient({ target: "XAF", targetIsBase: true, oldBase: "XAF" });
    const out = await service.setBase(c, "XAF", {});
    expect(out.skipped).toBe("already-base");
    expect(c.upserts).toEqual([]);
  });

  // ── Regression: rebase-BACK (XAF→EUR→XAF) 500'd in production ──────────────
  // The old single-statement flip `SET is_base = (code = $1)` violated 13951's
  // partial unique index whenever Postgres visited the target row before the
  // old base row (23505 duplicate key on ux_currency_single_base), so a second
  // base change to any earlier-sorting currency was refused. setBase must now
  // sweep every other base OFF first, then flag the target ON.
  it("flips the old base off BEFORE the new base on (ordered statements, rebase-back 23505)", async () => {
    const c = fakeClient({
      target: "XAF",
      oldBase: "EUR",
      latest: [{ quote_code: "XAF", rate: 655.9 }],
    });
    const out = await service.setBase(c, "XAF", {});
    expect(out.base).toBe("XAF");
    const sqls = c.queries.map((q) => q.sql);
    const offIdx = sqls.findIndex((s) => /SET\s+is_base\s*=\s*false/i.test(s));
    const onIdx = sqls.findIndex((s) => /SET\s+is_base\s*=\s*true/i.test(s));
    expect(offIdx).toBeGreaterThanOrEqual(0);
    expect(onIdx).toBeGreaterThan(offIdx);
    // The off-sweep must exclude the target; the on-statement must also activate it.
    expect(sqls[offIdx]).toMatch(/WHERE\s+is_base\s+AND\s+code\s+<>\s*\$1/i);
    expect(sqls[onIdx]).toMatch(/is_active\s*=\s*true/i);
  });
});
