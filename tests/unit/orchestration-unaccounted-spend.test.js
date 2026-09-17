"use strict";

/**
 * §8.1 — the five orchestration handlers, and owner decision B (17/09/2026).
 *
 * Each of these posts a `cost_entry` on a dossier with NO costing line and no
 * cash request. Option B's premise, pinned here: they KEEP posting — the
 * ledger must record what happened — and the rows land in the reconciliation
 * sheet's Unaccounted spend tray (`costing_line_id` NULL, 13801/13830), where
 * each one is mapped to a budget line or the costing is amended to carry it.
 *
 * If this file ever starts failing because a handler REFUSES an item the
 * costing does not carry, that is option A being smuggled back in — the
 * decision was recorded in the guide's correction table, and reversing it is
 * the owner's call, not a refactor.
 *
 * The fourth note from the brief, verified structurally here: only four of
 * the five filenames match *cost* — the fifth is the driver-labour one.
 */

jest.mock("../../src/modules/costing/cost_tracking/cost_tracking.repo", () => ({
  insertCostEntry: jest.fn(async (c, data) => ({ cost_entry_id: "ce-" + data.category, ...data })),
}));
jest.mock("../../src/modules/costing/cost_tracking/cost_tracking.service", () => ({
  recordCost: jest.fn(async () => ({ cost_entry: { cost_entry_id: "ce-fuel" } })),
  recordCosts: jest.fn(async () => []),
  recordCostInner: jest.fn(async () => ({ cost_entry: { cost_entry_id: "ce-fuel" }, entry: {} })),
}));
jest.mock("../../src/shared/config/settings", () => ({
  getSetting: jest.fn(),
}));

const costRepo = require("../../src/modules/costing/cost_tracking/cost_tracking.repo");
const costTracking = require("../../src/modules/costing/cost_tracking/cost_tracking.service");
const { getSetting } = require("../../src/shared/config/settings");

const supplierInvoice = require("../../src/orchestration/handlers/supplier-invoice-posted-cost-entry");
const fuelLog = require("../../src/orchestration/handlers/fuel-log-created-dossier-cost");
const outbound = require("../../src/orchestration/handlers/outbound-dispatched-handling-cost");
const workOrder = require("../../src/orchestration/handlers/work-order-done-dossier-cost");
const fleetLabour = require("../../src/orchestration/handlers/fleet-dispatch-returned-driver-labour");

const DOSSIER = "d-00000001";
const noCostingLine = (data) => {
  // No key at all is the assertion: insertCostEntry writes `data` as the
  // column list, so a missing key is the column's DEFAULT — NULL — which is
  // what puts the row in the tray.
  expect(data).not.toHaveProperty("costing_line_id");
};

// mockClear, not mockReset: reset would strip the implementations the mock
// factory installed, and the handlers then read `undefined.cost_entry_id`.
beforeEach(() => {
  costRepo.insertCostEntry.mockClear();
  costTracking.recordCost.mockClear();
  getSetting.mockClear();
});

test("all five handlers exist and are wired to their events", () => {
  expect(supplierInvoice.eventKey).toBe("supplier_invoice.posted");
  expect(fuelLog.eventKey).toBe("fuel_log.created");
  expect(outbound.eventKey).toBe("outbound.status_changed");
  expect(workOrder.eventKey).toBe("work_order.status_changed");
  expect(fleetLabour.eventKey).toBe("fleet_dispatch.status_changed");
  // Four of the five filenames match *cost*; the fifth is the labour one.
  const files = [
    "supplier-invoice-posted-cost-entry.js",
    "fuel-log-created-dossier-cost.js",
    "outbound-dispatched-handling-cost.js",
    "work-order-done-dossier-cost.js",
    "fleet-dispatch-returned-driver-labour.js",
  ];
  expect(files.filter((f) => f.includes("cost"))).toHaveLength(4);
});

test("supplier invoice posted: posts with no costing line, linked to the GL entry", async () => {
  const client = {
    async query(sql) {
      if (/FROM supplier_invoice/.test(sql))
        return { rows: [{ dossier_id: DOSSIER, entry_id: "e-inv", amount_ht: 198000, amount_ttc: 236115 }] };
      if (/FROM cost_entry WHERE entry_id/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const out = await supplierInvoice.run(client, { entity_ref: "supplier_invoice:si-1" });
  expect(out).toMatchObject({ created: true });
  expect(costRepo.insertCostEntry).toHaveBeenCalledWith(
    client,
    expect.objectContaining({ dossier_id: DOSSIER, category: "procurement", entry_id: "e-inv", amount: 198000 }),
  );
  noCostingLine(costRepo.insertCostEntry.mock.calls[0][1]);
});

test("fuel log created: posts with no costing line, idempotent on the journal ref", async () => {
  const client = {
    async query(sql) {
      if (/FROM dossier WHERE dossier_id/.test(sql)) return { rows: [{ entity_id: "ent-1" }] };
      if (/FROM journal_entry WHERE source_doc_ref/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  getSetting.mockResolvedValue("601.00");
  const out = await fuelLog.run(client, { entity_ref: "fuel_log:fl-1", payload: { dossier_id: DOSSIER, cost: 12000 } });
  expect(out).toMatchObject({ created: true });
  expect(costTracking.recordCost).toHaveBeenCalledWith(
    client,
    expect.objectContaining({ dossierId: DOSSIER, category: "fuel", amount: 12000 }),
  );
  expect(costTracking.recordCost.mock.calls[0][1]).not.toHaveProperty("costingLineId");
});

test("outbound dispatched: handling cost posts with no costing line", async () => {
  const client = {
    async query(sql) {
      if (/FROM outbound_order/.test(sql)) return { rows: [{ status: "DISPATCHED", dossier_id: DOSSIER }] };
      if (/FROM outbound_line/.test(sql)) return { rows: [{ units: 40 }] };
      if (/FROM cost_entry WHERE source_ref/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  getSetting.mockResolvedValue({ flat: 1000, per_unit: 25 });
  const out = await outbound.run(client, { entity_ref: "outbound:ob-1" });
  expect(out).toMatchObject({ created: true, amount: 2000 });
  expect(costRepo.insertCostEntry).toHaveBeenCalledWith(
    client,
    expect.objectContaining({ dossier_id: DOSSIER, category: "handling", source_ref: "outbound_order:ob-1" }),
  );
  noCostingLine(costRepo.insertCostEntry.mock.calls[0][1]);
});

test("work order done: maintenance cost posts with no costing line", async () => {
  const client = {
    async query(sql) {
      if (/FROM work_order/.test(sql))
        return { rows: [{ status: "DONE", dossier_id: DOSSIER, cost: 45000, entry_id: "e-wo" }] };
      if (/FROM cost_entry WHERE source_ref/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const out = await workOrder.run(client, { entity_ref: "work_order:wo-1" });
  expect(out).toMatchObject({ created: true, amount: 45000 });
  expect(costRepo.insertCostEntry).toHaveBeenCalledWith(
    client,
    expect.objectContaining({ dossier_id: DOSSIER, category: "maintenance", entry_id: "e-wo" }),
  );
  noCostingLine(costRepo.insertCostEntry.mock.calls[0][1]);
});

test("fleet dispatch returned: driver labour posts with no costing line", async () => {
  const client = {
    async query(sql) {
      if (/FROM fleet_dispatch fd/.test(sql))
        return {
          rows: [
            {
              status: "RETURNED",
              dossier_id: DOSSIER,
              check_out_at: "2026-09-10T08:00:00Z",
              check_in_at: "2026-09-11T08:00:00Z",
              base_salary: 44000,
            },
          ],
        };
      if (/FROM cost_entry WHERE source_ref/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  getSetting.mockResolvedValue(22);
  const out = await fleetLabour.run(client, { entity_ref: "fleet_dispatch:fd-1" });
  expect(out).toMatchObject({ created: true, amount: 2000, days: 1 });
  expect(costRepo.insertCostEntry).toHaveBeenCalledWith(
    client,
    expect.objectContaining({ dossier_id: DOSSIER, category: "driver_labour", entry_id: null }),
  );
  noCostingLine(costRepo.insertCostEntry.mock.calls[0][1]);
});
