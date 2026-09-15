/**
 * KPI band PR-2 — Operations, Fleet & Warehouse: the zero-vs-null split per
 * tile (guide §6.3/§6.4, §11).
 *
 * Each tile gets the two falsifying cases the policy demands: an installed
 * tenant with nothing to count must answer a NUMBER (0, or a {0, 0} pair), and
 * a tenant whose relation is missing must answer NULL — never the other way
 * round. `dwell_days` is the one that differs on purpose: an average over no
 * deliveries is NOT 0 days, so SQL NULL must survive `num()` and the tile must
 * drop out rather than assert a speed.
 */
"use strict";

const guards = require("../../src/modules/dashboard/kpi_catalog/guards");
const operations = require("../../src/modules/dashboard/kpi_catalog/operations");
const fleet = require("../../src/modules/dashboard/kpi_catalog/fleet_warehouse");
const { valuesFor, BY_ID } = require("../../src/modules/dashboard/kpi_catalog");

const PR2 = ["late_vs_eta", "dwell_days", "fleet_docs_expiring", "work_orders_open", "warehouse_occupancy"];

/** A client that answers by SQL shape, so each tile's statement is routable. */
const clientAnswering = (answer) => ({
  query: (sql) => {
    const out = answer(sql);
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve({ rows: [out] });
  },
});

const isDwell = (sql) => /is_target_lock/.test(sql);
const isOccupancy = (sql) => /capacity_units/.test(sql);
const isLate = (sql) => /eta < CURRENT_DATE/.test(sql);
const isDocs = (sql) => /vehicle_compliance/.test(sql);
const isWorkOrders = (sql) => /FROM work_order/.test(sql);

describe("PR-2 catalogue entries", () => {
  it("the five flipped tiles are live, keep their module and unit, and stock_value is still hidden", () => {
    expect(BY_ID.get("late_vs_eta")).toMatchObject({ status: "live", module: "MOD-29", unit: "count", sourceRelation: "dossier_visible" });
    expect(BY_ID.get("dwell_days")).toMatchObject({ status: "live", module: "MOD-31", unit: "days", sourceRelation: "milestone_instance" });
    expect(BY_ID.get("fleet_docs_expiring")).toMatchObject({ status: "live", module: "MOD-40", unit: "count", sourceRelation: "vehicle_compliance" });
    expect(BY_ID.get("work_orders_open")).toMatchObject({ status: "live", module: "MOD-41", unit: "count", sourceRelation: "work_order" });
    expect(BY_ID.get("warehouse_occupancy")).toMatchObject({ status: "live", module: "MOD-34", unit: "pct", sourceRelation: "warehouse_location" });
    expect(BY_ID.get("stock_value")).toMatchObject({ status: "hidden", module: "MOD-35", unit: "money" });
  });

  it("values() writes every PR-2 key before any query resolves — a dead client still shows the keys", async () => {
    const dead = { query: () => Promise.reject(new Error("dead")) };
    const ops = await operations.values(dead, guards);
    const fw = await fleet.values(dead, guards);
    expect(ops).toHaveProperty("late_vs_eta", null);
    expect(ops).toHaveProperty("dwell_days", null);
    expect(fw).toHaveProperty("fleet_docs_expiring", null);
    expect(fw).toHaveProperty("work_orders_open", null);
    expect(fw).toHaveProperty("warehouse_occupancy", null);
    expect(fw).not.toHaveProperty("stock_value");
  });
});

describe("zero vs null — counts (late_vs_eta, fleet_docs_expiring, work_orders_open)", () => {
  it("an installed, empty tenant asserts 0 on each count", async () => {
    const empty = clientAnswering(() => ({ n: 0 }));
    const out = await valuesFor(empty, PR2);
    expect(out.late_vs_eta).toBe(0);
    expect(out.fleet_docs_expiring).toBe(0);
    expect(out.work_orders_open).toBe(0);
  });

  it("a real count comes through as a number, per tile, not cross-wired", async () => {
    const c = clientAnswering((sql) => {
      if (isLate(sql)) return { n: "3" };
      if (isDocs(sql)) return { n: "7" };
      if (isWorkOrders(sql)) return { n: "2" };
      return { n: 0 };
    });
    const out = await valuesFor(c, PR2);
    expect(out.late_vs_eta).toBe(3);
    expect(out.fleet_docs_expiring).toBe(7);
    expect(out.work_orders_open).toBe(2);
  });

  it("a missing relation answers null for ITS tile only — unavailable, not zero, not contagious", async () => {
    const c = clientAnswering((sql) => {
      if (isWorkOrders(sql)) return new Error('relation "work_order" does not exist');
      if (isDocs(sql)) return new Error('relation "vehicle_compliance" does not exist');
      return { n: 0 };
    });
    const out = await valuesFor(c, PR2);
    expect(out.work_orders_open).toBeNull();
    expect(out.fleet_docs_expiring).toBeNull();
    expect(out.late_vs_eta).toBe(0);
  });

  it("late_vs_eta measures against the calendar day, undelivered, still-moving files only", async () => {
    let seen = "";
    await operations.values(clientAnswering((sql) => { if (isLate(sql)) seen = sql; return { n: 0 }; }), guards);
    expect(seen).toMatch(/status IN \('OPEN','IN_PROGRESS'\)/);
    expect(seen).toMatch(/eta < CURRENT_DATE/);
    expect(seen).toMatch(/ata IS NULL/);
    expect(seen).not.toMatch(/COALESCE/);
  });

  it("fleet_docs_expiring keeps lapsed documents in the count, as the drill's endpoint does", async () => {
    let seen = "";
    await fleet.values(clientAnswering((sql) => { if (isDocs(sql)) seen = sql; return { n: 0 }; }), guards);
    expect(seen).toMatch(/expires_on <= CURRENT_DATE \+ 30/);
    expect(seen).not.toMatch(/expires_on >= CURRENT_DATE/);
  });
});

describe("zero vs null — dwell_days (an average, through num())", () => {
  it("no delivery measured → SQL NULL survives → the tile is UNAVAILABLE, never '0 days'", async () => {
    const c = clientAnswering((sql) => (isDwell(sql) ? { n: null } : { n: 0 }));
    const out = await valuesFor(c, ["dwell_days"]);
    expect(out.dwell_days).toBeNull();
  });

  it("a measured average renders, including a genuine 0 (same-day delivery)", async () => {
    expect((await valuesFor(clientAnswering((sql) => (isDwell(sql) ? { n: "4" } : { n: 0 })), ["dwell_days"])).dwell_days).toBe(4);
    expect((await valuesFor(clientAnswering((sql) => (isDwell(sql) ? { n: 0 } : { n: 0 })), ["dwell_days"])).dwell_days).toBe(0);
  });

  it("the statement never COALESCEs the average, and is bounded to a rolling 90 days", async () => {
    let seen = "";
    await operations.values(clientAnswering((sql) => { if (isDwell(sql)) seen = sql; return { n: null }; }), guards);
    expect(seen).not.toMatch(/COALESCE/);
    expect(seen).toMatch(/interval '90 days'/);
    expect(seen).toMatch(/is_anchor/);
    expect(seen).toMatch(/is_target_lock/);
  });
});

describe("zero vs null — warehouse_occupancy (a ratio pair, §6.4)", () => {
  it("empty racks with capacity recorded → { 0, capacity } — measurable, and 0 % is the truth", async () => {
    const c = clientAnswering((sql) => (isOccupancy(sql) ? { value: 0, denominator: "700" } : { n: 0 }));
    const out = await valuesFor(c, ["warehouse_occupancy"]);
    expect(out.warehouse_occupancy).toEqual({ value: 0, denominator: 700 });
  });

  it("no capacity recorded → { 0, 0 } — the band paints 0 % with measurable:false, NOT a null drop", async () => {
    // NULLIF in the statement turns the division into SQL NULL; ratio() maps
    // that to value 0 over denominator 0 — installed but unmeasurable.
    const c = clientAnswering((sql) => (isOccupancy(sql) ? { value: null, denominator: null } : { n: 0 }));
    const out = await valuesFor(c, ["warehouse_occupancy"]);
    expect(out.warehouse_occupancy).toEqual({ value: 0, denominator: 0 });
  });

  it("a full house reads as a real percentage; the WMS not installed reads as null", async () => {
    const full = clientAnswering((sql) => (isOccupancy(sql) ? { value: "86", denominator: "700" } : { n: 0 }));
    expect((await valuesFor(full, ["warehouse_occupancy"])).warehouse_occupancy).toEqual({ value: 86, denominator: 700 });
    const off = clientAnswering((sql) => (isOccupancy(sql) ? new Error('relation "warehouse_location" does not exist') : { n: 0 }));
    expect((await valuesFor(off, ["warehouse_occupancy"])).warehouse_occupancy).toBeNull();
  });

  it("the statement divides by NULLIF(capacity, 0) and excludes DISPATCHED stock", async () => {
    let seen = "";
    await fleet.values(clientAnswering((sql) => { if (isOccupancy(sql)) seen = sql; return { value: 0, denominator: 0 }; }), guards);
    expect(seen).toMatch(/NULLIF\(SUM\(l\.capacity_units\), 0\)/);
    expect(seen).toMatch(/state <> 'DISPATCHED'/);
    expect(seen).toMatch(/l\.capacity_units > 0/);
  });
});
