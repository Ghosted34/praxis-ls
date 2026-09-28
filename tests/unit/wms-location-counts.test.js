"use strict";
/**
 * Warehouse location 360 — the counts are the slot's own, counted on the server.
 *
 * The bug this pins: the location screen fetched the tenant's first 50 stock
 * lines, equipment and cycle counts (the list default) and filtered them by
 * slot in the browser. Past 50 of anything, every slot under-counted — a slot
 * whose stock sat on "page two" read as empty, and "Capacity used" was worked
 * out from a partial sum. Now:
 *
 *   - GET /locations/:id carries `stats`, counted in SQL over EVERY row at the
 *     slot, with the on-hand SUM the capacity figure needs;
 *   - GET /inventory takes `?location_id=` (one slot's stock) with a real total
 *     and a quantity sort for "On hand";
 *   - the equipment and cycle-count lists, which already filtered by location,
 *     now report their totals, so a paged drill-in can say "of N".
 */
const express = require("express");
const request = require("supertest");

jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { user_id: "11111111-1111-1111-1111-111111111111" };
    next();
  },
}));
jest.mock("../../src/middleware/rbac", () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireCapability: () => (_req, _res, next) => next(),
  readPermissions: async (_req, specs) => specs.map(() => true),
}));

const locationRepo = require("../../src/modules/wms/warehouse_location/warehouse_location.repo");
const locationService = require("../../src/modules/wms/warehouse_location/warehouse_location.service");
const inventoryRepo = require("../../src/modules/wms/inventory/inventory.repo");
const inventoryRoutes = require("../../src/modules/wms/inventory/inventory.routes");
const equipmentRepo = require("../../src/modules/wms/equipment/equipment.repo");
const cycleCountService = require("../../src/modules/wms/cycle_count/cycle_count.service");
const { errorHandler } = require("../../src/middleware/error-handler");

const LOC = "22222222-2222-2222-2222-222222222222";

/** A client that records every query and answers from `reply(sql, params)`. */
function recorder(reply = () => ({ rows: [] })) {
  const seen = [];
  return {
    seen,
    client: {
      query: async (sql, params) => {
        seen.push({ sql: sql.replace(/\s+/g, " "), params });
        return reply(sql, params);
      },
    },
  };
}

describe("location stats — counted in SQL over every row at the slot", () => {
  test("items, on-hand sum, equipment and cycle counts, each filtered to this slot", async () => {
    const values = { items: 1234, on_hand: "56789.5000", equipment: 3, cycle_counts: 9 };
    const { seen, client } = recorder((sql) => {
      const key = /AS (\w+) FROM/.exec(sql)[1];
      return { rows: [{ [key]: values[key] }] };
    });
    const stats = await locationRepo.stats(client, LOC);
    expect(stats).toEqual({ items: 1234, on_hand: 56789.5, equipment: 3, cycle_counts: 9 });
    expect(seen).toHaveLength(4);
    for (const q of seen) {
      expect(q.sql).toMatch(/WHERE location_id = \$1/);
      expect(q.params).toEqual([LOC]);
      // No LIMIT: a count over a page is the bug this replaces.
      expect(q.sql).not.toMatch(/LIMIT/);
    }
    expect(seen[1].sql).toMatch(/SUM\(qty_on_hand\)/);
  });

  test("a table the tenant was provisioned without counts as zero; anything else is thrown", async () => {
    const missing = recorder((sql) => {
      if (/cycle_count/.test(sql)) throw Object.assign(new Error("no table"), { code: "42P01" });
      return { rows: [{ items: 1, on_hand: 2, equipment: 3 }] };
    });
    expect((await locationRepo.stats(missing.client, LOC)).cycle_counts).toBe(0);

    const broken = recorder(() => {
      throw Object.assign(new Error("boom"), { code: "57014" });
    });
    await expect(locationRepo.stats(broken.client, LOC)).rejects.toThrow("boom");
  });

  test("GET /locations/:id carries the stats beside the occupancy", async () => {
    jest.spyOn(locationRepo, "findById").mockResolvedValue({ location_id: LOC, zone: "A", aisle: "01" });
    jest.spyOn(locationRepo, "occupancy").mockResolvedValue({ total: 0, breakdown: {} });
    jest.spyOn(locationRepo, "stats").mockResolvedValue({ items: 60, on_hand: 900, equipment: 2, cycle_counts: 1 });
    const row = await locationService.get({}, LOC);
    expect(row.stats).toEqual({ items: 60, on_hand: 900, equipment: 2, cycle_counts: 1 });
    jest.restoreAllMocks();
  });
});

describe("GET /inventory?location_id= — one slot's stock, with the true total", () => {
  function app(reply) {
    const rec = recorder(reply);
    const a = express();
    a.use((req, _res, next) => {
      req.tenantDb = (fn) => fn(rec.client);
      next();
    });
    a.use(inventoryRoutes.router);
    a.use(errorHandler);
    return { app: a, seen: rec.seen };
  }
  const rows = (n, total) =>
    Array.from({ length: n }, (_, i) => ({ inventory_item_id: `it${i}`, qty_on_hand: String(100 - i), _total: String(total) }));

  test("filters to the slot, pages, and reports the total the tile counts", async () => {
    const { app: a, seen } = app(() => ({ rows: rows(20, 1234) }));
    const res = await request(a).get(`/?location_id=${LOC}&limit=20&offset=40`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.data[0]).not.toHaveProperty("_total");
    expect(res.body.meta).toMatchObject({ total: 1234, limit: 20, offset: 40 });
    expect(seen[0].sql).toMatch(/WHERE location_id = \$3/);
    expect(seen[0].params).toEqual([20, 40, LOC]);
  });

  test("sorts by quantity for On hand, with a stable tie-break", async () => {
    const { app: a, seen } = app(() => ({ rows: rows(2, 2) }));
    await request(a).get(`/?location_id=${LOC}&sort=-qty_on_hand`);
    expect(seen[0].sql).toMatch(/ORDER BY qty_on_hand DESC, inventory_item_id/);
  });

  test("a sort outside the allow-list is refused, never interpolated", async () => {
    const { app: a, seen } = app(() => ({ rows: [] }));
    const res = await request(a).get(`/?location_id=${LOC}&sort=-description;DROP`);
    expect(res.status).toBe(422);
    expect(seen).toHaveLength(0);
  });

  test("without a slot the shared list is unchanged — and still refuses an unknown filter", async () => {
    const { app: a, seen } = app(() => ({ rows: rows(1, 1) }));
    const ok = await request(a).get("/");
    expect(ok.status).toBe(200);
    expect(seen[0].sql).not.toMatch(/location_id/);
    const bad = await request(a).get("/?zone=A");
    expect(bad.status).toBe(422);
  });

  test("the quantity sort is on the base list's allow-list too", () => {
    expect(inventoryRepo.cfg.sortable).toContain("qty_on_hand");
  });
});

describe("equipment and cycle-count lists report their totals", () => {
  test("equipment: the slot filter it already had, now with the match count", async () => {
    const { seen, client } = recorder(() => ({
      rows: [{ wms_equipment_id: "eq1", label: "FL-01", _total: "7" }],
    }));
    const out = await equipmentRepo.list(client, { location_id: LOC, limit: 20 });
    expect(out._total).toBe(7);
    expect(out[0]).not.toHaveProperty("_total");
    expect(seen[0].sql).toMatch(/we\.location_id = \$3/);
  });

  test("cycle counts: the total survives the service's summary mapping", async () => {
    const { client } = recorder(() => ({
      rows: [{ cycle_count_id: "cc1", discrepancy: [], _total: "12" }],
    }));
    const out = await cycleCountService.list(client, { location_id: LOC });
    expect(out._total).toBe(12);
    expect(out[0]).toHaveProperty("discrepancy_summary");
  });
});
