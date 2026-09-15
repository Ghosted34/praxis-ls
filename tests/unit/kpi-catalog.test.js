/**
 * The KPI band catalog — structure, coverage, guards.
 *
 * This suite IS the require-time boot check's twin: `index.js` self-checks at
 * require time so a broken catalog cannot run in production, and these tests
 * assert the SAME rules over the data — because require-time only proves the
 * catalog that SHIPPED today is coherent. When PR-2/3/4 flip entries to live
 * and add queries, the rules here catch the half-done flip that slips past
 * `require`: an entry with no value source, a duplicated id across two domain
 * files, a hidden tile quietly gaining a query, the guard contract bent into a
 * throw. Those are merge-time failures for parallel PRs, and a PR that cannot
 * break them cannot break the band.
 */
"use strict";

const catalog = require("../../src/modules/dashboard/kpi_catalog");
const {
  CATALOG,
  BY_ID,
  LIVE_IDS,
  MAX_BAND_TILES,
  DOMAINS,
  UNITS,
  TONES,
  assertCatalogSane,
  checkValueCoverage,
  valuesFor,
} = catalog;
const { MAX_BAND_TILES: SHARED_MAX } = require("../../src/modules/dashboard/kpi_catalog/shared");

describe("catalog structure", () => {
  it("holds the v1 promise: 31 entries across the five domains", () => {
    expect(CATALOG).toHaveLength(31);
    expect(new Set(CATALOG.map((e) => e.domain))).toEqual(new Set(DOMAINS));
    expect(DOMAINS).toEqual([
      "money",
      "operations",
      "fleet_warehouse",
      "sales_procurement",
      "human_capital",
    ]);
  });

  it("ships exactly ten live tiles in PR-1 — the four cards plus six free counts", () => {
    expect([...LIVE_IDS].sort()).toEqual(
      [
        "approvals_awaiting",
        "compliance_open",
        "files_active",
        "fleet_utilisation",
        "journals_unposted",
        "needs_location",
        "proformas_open",
        "receivables_overdue",
        "revenue",
        "sla_on_time",
      ].sort(),
    );
    expect(LIVE_IDS.length).toBeLessThanOrEqual(32);
  });

  it("ids are unique and the index agrees with the list", () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(BY_ID.has(id)).toBe(true);
    expect(BY_ID.size).toBe(ids.length);
  });

  it("every entry carries the fields the band reads unconditionally", () => {
    for (const e of CATALOG) {
      expect(e).toMatchObject({
        unit: expect.stringMatching(new RegExp(`^(${UNITS.join("|")})$`)),
        tone: expect.stringMatching(new RegExp(`^(${TONES.join("|")})$`)),
        status: expect.stringMatching(/^(live|hidden)$/),
        module: expect.stringMatching(/^MOD-[0-9A-Z]+$/),
        labelKey: expect.stringMatching(/^dash\.[A-Za-z0-9]+$/),
        hintKey: expect.stringMatching(/^dash\.[A-Za-z0-9]+$/),
        sourceRelation: expect.any(String),
      });
      expect(typeof e.icon).toBe("string");
      expect(typeof e.drillTo).toBe("string");
    }
  });

  it("the two MAX_BAND_TILES exports are the same number (the layout promise has one owner)", () => {
    expect(MAX_BAND_TILES).toBe(SHARED_MAX);
    expect(MAX_BAND_TILES).toBe(4);
  });

  it("sensitive fields are only the seeded field_visibility keys", () => {
    const sensitive = CATALOG.filter((e) => e.sensitive_field);
    expect(sensitive.map((e) => e.sensitive_field).sort()).toEqual([
      "dossier.margin",
      "employee.salary",
    ]);
  });

  it("assertCatalogSane passes on the shipped catalog and fails on a duplicate", () => {
    expect(() => assertCatalogSane()).not.toThrow();
  });
});

describe("label keys resolve in the i18n contract (en is the shape source)", () => {
  // The dictionary is a TS module the vitest suite owns; the SERVER cannot
  // import it. What the server CAN guarantee is the naming contract —
  // `dash.<camelKey>` — and that the live tiles' keys follow it, which is what
  // drifts when a domain PR forgets one. The key EXISTENCE half is asserted in
  // `kpi-model.test.ts` (client), where the dictionary lives.
  it("live tiles have a distinct label key and every entry a hint key", () => {
    const labelKeys = new Set(CATALOG.map((e) => e.labelKey));
    expect(labelKeys.size).toBe(CATALOG.length);
    for (const e of CATALOG) {
      expect(e.hintKey.startsWith("dash.")).toBe(true);
    }
  });
});

describe("value coverage (the PR-flip guard)", () => {
  it("every live id has exactly one answering value source; no hidden id answers", async () => {
    await expect(checkValueCoverage()).resolves.toEqual([]);
  });
});

describe("valuesFor guard contract", () => {
  const rejectingClient = {
    query: () => Promise.reject(new Error("relation does not exist")),
  };
  const emptySchemaClient = {
    query: (sql) => {
      // An empty-but-installed tenant: every aggregate answers, with 0/NULL.
      if (/SUM\(total_ttc\)/.test(sql)) return Promise.resolve({ rows: [{ n: 0 }] });
      if (/count\(\*\) FILTER/.test(sql)) return Promise.resolve({ rows: [{ value: null, denominator: 0 }] });
      return Promise.resolve({ rows: [{ n: 0 }] });
    },
  };

  it("a missing module answers null for its tiles — the tile is unavailable, not zero", async () => {
    const out = await valuesFor(rejectingClient, LIVE_IDS);
    expect(out.revenue).toBeNull();
    expect(out.sla_on_time).toBeNull();
    expect(out.fleet_utilisation).toBeNull();
    // …and every LIVE id is answered SOME way, so the resolver never sees a
    // silent gap it might paint as an empty slot.
    for (const id of LIVE_IDS) expect(out).toHaveProperty(id);
  });

  it("an empty tenant answers 0 — the assert-the-zero policy, per tile", async () => {
    const out = await valuesFor(emptySchemaClient, ["revenue", "proformas_open", "sla_on_time", "fleet_utilisation"]);
    expect(out.revenue).toBe(0);
    expect(out.proformas_open).toBe(0);
    expect(out.sla_on_time).toEqual({ value: 0, denominator: 0 });
    expect(out.fleet_utilisation).toEqual({ value: 0, denominator: 0 });
  });

  it("unknown and hidden ids are never answered, even when asked", async () => {
    const out = await valuesFor(emptySchemaClient, ["revenue", "made_up_id", "headcount"]);
    expect(Object.keys(out)).toEqual(["revenue"]);
  });
});
