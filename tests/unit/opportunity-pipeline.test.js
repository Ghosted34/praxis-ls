"use strict";
/**
 * F7 (doc/SALES_CRM_FEATURES.md#F7) — the sales pipeline board.
 *
 * These are the three things the feature gets wrong silently if it gets them
 * wrong at all: the stage ladder, the probability a deal inherits, and the win
 * rate. All three are pure arithmetic, so all three are tested without a
 * database — a KPI that only fails against production data fails too late.
 */
const rules = require("../../src/modules/sales/opportunity/opportunity.rules");
const fs = require("fs");
const path = require("path");

describe("F7 stage ladder", () => {
  test("seven stages ship, not six", () => {
    // migrations/seeds/9030 seeds six; the legacy permits seven
    // (api/sales_pipeline/_common.php line 26). Migration 0684 adds the
    // seventh to existing tenants and new ones alike.
    expect(rules.DEFAULT_STAGES).toHaveLength(7);
  });

  test("PRICING_IN_PROGRESS is the missing one, at 50%", () => {
    const s = rules.DEFAULT_STAGES.find((x) => x.code === "PRICING_IN_PROGRESS");
    expect(s).toBeDefined();
    expect(s.probability).toBe(50);
    // It sits between QUALIFIED and PROPOSAL — the handoff to commercial
    // pricing, not an afterthought appended to the end of the board.
    const codes = rules.DEFAULT_STAGES.map((x) => x.code);
    expect(codes.indexOf("PRICING_IN_PROGRESS")).toBeGreaterThan(codes.indexOf("QUALIFIED"));
    expect(codes.indexOf("PRICING_IN_PROGRESS")).toBeLessThan(codes.indexOf("PROPOSAL"));
  });

  test("the legacy's four probabilities are carried over unchanged", () => {
    // STAGE_CONFIG, sales-pipelining.php ~515. PROPOSAL is this repo's name
    // for the legacy's QUOTATION_SENT.
    const p = Object.fromEntries(rules.DEFAULT_STAGES.map((s) => [s.code, s.probability]));
    expect(p.NEW).toBe(10);
    expect(p.QUALIFIED).toBe(30);
    expect(p.PRICING_IN_PROGRESS).toBe(50);
    expect(p.PROPOSAL).toBe(70);
    expect(p.WON).toBe(100);
    expect(p.LOST).toBe(0);
  });

  test("sort_order is dense and starts at zero, and exactly one stage wins", () => {
    expect(rules.DEFAULT_STAGES.map((s) => s.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rules.DEFAULT_STAGES.filter((s) => s.is_won)).toHaveLength(1);
    expect(rules.DEFAULT_STAGES.filter((s) => s.is_lost)).toHaveLength(1);
  });

  test("the migration seeds exactly the ladder this module declares", () => {
    // The SQL and the JS are two statements of one fact, and they are edited
    // in different files months apart. This is the join.
    const sql = fs.readFileSync(
      path.join(__dirname, "../../migrations/tenant/0684_sales_crm_f7_pipeline.sql"),
      "utf8",
    );
    for (const s of rules.DEFAULT_STAGES) {
      const re = new RegExp(
        `default_probability\\s*=\\s*${s.probability}\\s+WHERE code = '${s.code}'`,
      );
      expect(sql).toMatch(re);
    }
  });
});

describe("F7 probability derivation", () => {
  const stage = { default_probability: 70 };

  test("a deal with no probability inherits the stage's", () => {
    expect(rules.deriveProbability({ stage, current: null })).toEqual({
      probability: 70,
      probability_is_manual: false,
    });
  });

  test("a hand-typed number wins and claims the field", () => {
    expect(rules.deriveProbability({ stage, current: 70, explicit: 15 })).toEqual({
      probability: 15,
      probability_is_manual: true,
    });
  });

  test("a manual value SURVIVES a stage move — the whole point of the flag", () => {
    expect(rules.deriveProbability({ stage, current: 15, isManual: true })).toBeNull();
  });

  test("no change is signalled as null, so the caller writes no column", () => {
    // Already at the stage's number: nothing to write, no spurious audit row.
    expect(rules.deriveProbability({ stage, current: 70 })).toBeNull();
  });

  test("an unconfigured stage leaves the existing value alone rather than nulling it", () => {
    expect(
      rules.deriveProbability({ stage: { default_probability: null }, current: 42 }),
    ).toBeNull();
    expect(rules.deriveProbability({ stage: null, current: 42 })).toBeNull();
  });
});

describe("F7 weighted value", () => {
  test("value × probability, rounded to the cent", () => {
    expect(rules.weighted(5000000, 70)).toBe(3500000);
    expect(rules.weighted(1000, 33)).toBe(330);
    expect(rules.weighted(null, 50)).toBe(0);
    expect(rules.weighted(1000, null)).toBe(0);
  });
});

describe("F7 win rate — both denominators, by hand", () => {
  test("settled is won / (won + lost); all_deals is won / everything", () => {
    // 6 won, 4 lost, 10 still open.
    const r = rules.winRate({ won: 6, lost: 4, open: 10 });
    expect(r.settled).toBe(60); // 6/10 decided
    expect(r.all_deals).toBe(30); // 6/20 total
    expect(r.settled_count).toBe(10);
  });

  test("the two diverge exactly when the pipeline is full — which is why both ship", () => {
    const quiet = rules.winRate({ won: 3, lost: 1, open: 0 });
    const busy = rules.winRate({ won: 3, lost: 1, open: 20 });
    // Nothing about closing performance changed between these two.
    expect(quiet.settled).toBe(busy.settled);
    expect(quiet.all_deals).toBe(75);
    expect(busy.all_deals).toBe(13);
  });

  test("an empty denominator is null, never 0% — those are different facts", () => {
    const none = rules.winRate({ won: 0, lost: 0, open: 5 });
    expect(none.settled).toBeNull(); // nothing decided yet
    expect(none.all_deals).toBe(0); // five deals, none won: genuinely 0%
    expect(rules.winRate({}).all_deals).toBeNull();
  });

  test("rounds to whole percent", () => {
    expect(rules.winRate({ won: 1, lost: 2 }).settled).toBe(33);
    expect(rules.winRate({ won: 2, lost: 1 }).settled).toBe(67);
  });
});

describe("F7 settled lock", () => {
  test("a settled opportunity refuses to move — the legacy accepts any status by POST", () => {
    expect(rules.assertOpen({ status: "OPEN" }, "move")).toBe(true);
    expect(() => rules.assertOpen({ status: "WON" }, "move")).toThrow(/settled/i);
    expect(() => rules.assertOpen({ status: "LOST" }, "move")).toThrow(/settled/i);
  });

  test("a missing opportunity is a 404, not a lock error", () => {
    expect(() => rules.assertOpen(null)).toThrow(/not found/i);
  });
});

describe("F7 source vocabulary", () => {
  test("is the 0683 intake channel set plus the in-system origins", () => {
    for (const c of ["WEBSITE", "MANUAL", "REFERRAL", "CAMPAIGN"]) {
      expect(rules.SOURCES).toContain(c);
    }
    expect(rules.SOURCES).toContain("QUOTE_REQUEST");
    expect(new Set(rules.SOURCES).size).toBe(rules.SOURCES.length);
  });

  test("the CHECK constraint in the migration lists exactly these values", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../migrations/tenant/0684_sales_crm_f7_pipeline.sql"),
      "utf8",
    );
    const m = sql.match(/CHECK \(source IN \(([^)]+)\)\)/);
    expect(m).not.toBeNull();
    const inSql = m[1].split(",").map((x) => x.trim().replace(/'/g, ""));
    expect(new Set(inSql)).toEqual(new Set(rules.SOURCES));
  });
});
