/**
 * KPI drill-down builders.
 *
 * The headline case is RECONCILIATION: a figure on a card and the rows behind it
 * must be computed on the same basis, or an operator finds two numbers for one
 * question. That is why the receivables card was rewired to `/receivables/overdue`
 * in the first place, and it is the trap the revenue drill walks into on any
 * tenant with more than one API page of invoices.
 */
import { describe, expect, it } from "vitest";
import {
  buildFleetDrill,
  buildOverdueDrill,
  buildRevenueDrill,
  buildSlaDrill,
} from "./drilldowns";

const NAMES = { c1: "Bolloré Transport", c2: "Sonara" };

const invoice = (client: string, ttc: number, status = "POSTED_LOCKED") => ({
  type: "FINAL",
  status,
  client_id: client,
  total_ttc: ttc,
});

describe("buildRevenueDrill", () => {
  const rows = [
    invoice("c1", 11_200_000),
    invoice("c2", 6_400_000),
    invoice("c1", 2_400_000),
  ];

  it("counts only LOCKED final invoices", () => {
    const d = buildRevenueDrill(
      [...rows, invoice("c2", 999, "DRAFT")],
      NAMES,
      "XAF",
      null,
      4,
    );
    expect(d.badge.text).toBe("3 locked invoices");
  });

  it("ranks clients by value, biggest first", () => {
    const d = buildRevenueDrill(rows, NAMES, "XAF", null, 3);
    expect(d.rows[0].cells[0]).toBe("Bolloré Transport");
    expect(d.rows[1].cells[0]).toBe("Sonara");
  });

  it("uses the authoritative all-invoice total for the headline figure", () => {
    // The card's number is a SQL SUM over every locked invoice; the rows are one
    // API page. Showing the page's sum as "Revenue" would contradict the card.
    const d = buildRevenueDrill(rows, NAMES, "XAF", 84_600_000, 3);
    expect(d.meta.find((m) => m.label === "Revenue")?.value).toContain("84");
  });

  it("states the basis when the ranking is over a sample", () => {
    const d = buildRevenueDrill(rows, NAMES, "XAF", 84_600_000, 900);
    expect(d.note).toMatch(/Ranked over the 3 most recent invoices of 900/);
  });

  it("carries no note when the page IS the whole set", () => {
    expect(
      buildRevenueDrill(rows, NAMES, "XAF", 20_000_000, 3).note,
    ).toBeUndefined();
  });

  it("falls back to the scanned sum when the KPI is unavailable", () => {
    const d = buildRevenueDrill(rows, NAMES, "XAF", null, 3);
    expect(d.meta.find((m) => m.label === "Revenue")?.value).toContain("20");
  });

  it("offers an empty state, not an empty table, with no invoices", () => {
    const d = buildRevenueDrill([], NAMES, "XAF", 0, 0);
    expect(d.rows).toHaveLength(0);
    expect(d.empty.title).toBe("No revenue posted yet");
  });
});

describe("buildSlaDrill", () => {
  const dossiers = [
    {
      dossier_id: "d1",
      ref: "OPS-1",
      pol: "Antwerp",
      pod: "Douala",
      eta: "2026-07-01",
      ata: "2026-07-06",
    },
    {
      dossier_id: "d2",
      ref: "OPS-2",
      pol: "Kribi",
      pod: "Douala",
      eta: "2026-07-01",
      ata: "2026-06-30",
    },
    {
      dossier_id: "d3",
      ref: "OPS-3",
      pol: "Douala",
      pod: "Garoua",
      eta: "2026-07-01",
      ata: null,
    },
  ];

  it("measures only dossiers with BOTH an ETA and an ATA", () => {
    const d = buildSlaDrill(dossiers);
    expect(d.badge.text).toBe("2 arrivals measured");
    expect(d.meta.find((m) => m.label === "Measured")?.value).toBe("2");
  });

  it("puts the worst slip first — what a controller opens this to see", () => {
    const d = buildSlaDrill(dossiers);
    expect(d.rows[0].cells[0]).toBe("OPS-1");
    expect(d.rows[0].cells[3]).toEqual({ text: "5 days late", tone: "bad" });
  });

  it("reports an on-time percentage over the measured set", () => {
    expect(
      buildSlaDrill(dossiers).meta.find((m) => m.label === "On time")?.value,
    ).toBe("50%");
  });

  it("reports em-dash, not 0%, when nothing is measurable yet", () => {
    const d = buildSlaDrill([{ ref: "OPS-9", eta: "2026-07-01" }]);
    expect(d.meta.find((m) => m.label === "On time")?.value).toBe("—");
  });
});

describe("buildOverdueDrill", () => {
  const payload = {
    total: 18_200_000,
    count: 2,
    clients: 2,
    invoices: [
      {
        invoice_id: "i1",
        doc_number: "INV-0311",
        client_id: "c2",
        outstanding: 6_400_000,
        days_overdue: 34,
      },
      {
        invoice_id: "i2",
        doc_number: "INV-0287",
        client_id: "c1",
        outstanding: 4_800_000,
        days_overdue: 12,
      },
    ],
  };

  it("escalates the tone past thirty days", () => {
    const d = buildOverdueDrill(payload, NAMES, "XAF");
    expect(d.rows[0].cells[3]).toEqual({ text: "34 days", tone: "bad" });
    expect(d.rows[1].cells[3]).toEqual({ text: "12 days", tone: "warn" });
  });

  it("resolves client ids to names", () => {
    expect(buildOverdueDrill(payload, NAMES, "XAF").rows[0].cells[1]).toBe(
      "Sonara",
    );
  });

  it("survives a null payload — the module may be off for this tenant", () => {
    const d = buildOverdueDrill(null, NAMES, "XAF");
    expect(d.rows).toHaveLength(0);
    expect(d.empty.title).toBe("Nothing past due");
  });
});

describe("buildFleetDrill", () => {
  const vehicles = [
    {
      vehicle_id: "v1",
      registration: "LT-4471",
      category: "Truck",
      status: "ACTIVE",
    },
    {
      vehicle_id: "v2",
      registration: "LT-4429",
      category: "Truck",
      status: "WORKSHOP",
    },
  ];

  it("reports utilisation over the register", () => {
    const d = buildFleetDrill(vehicles);
    expect(d.badge.text).toBe("1 of 2 active");
    expect(d.meta.find((m) => m.label === "Utilisation")?.value).toBe("50%");
  });

  it("says em-dash rather than dividing by zero on an empty register", () => {
    expect(
      buildFleetDrill([]).meta.find((m) => m.label === "Utilisation")?.value,
    ).toBe("—");
  });
});

/* ── PR-2: Operations, Fleet & Warehouse ─────────────────────────────────── */

import {
  buildDwellDrill,
  buildFleetDocsDrill,
  buildLateVsEtaDrill,
  buildWarehouseOccupancyDrill,
  buildWorkOrdersDrill,
  kpiRoute,
  KPI_ROUTE,
} from "./drilldowns";

const NOW = new Date(2026, 8, 15, 10, 0, 0); // 15 Sep 2026, local

describe("kpiRoute — one lookup across every domain", () => {
  it("answers ids from all four PRs, null for anything else", () => {
    expect(kpiRoute("revenue")).toBe("/finance/invoices");          // PR-1
    expect(kpiRoute("late_vs_eta")).toBe("/operations/files");      // PR-2
    expect(kpiRoute("warehouse_occupancy")).toBe("/wms");           // PR-2
    expect(kpiRoute("dso")).toBe("/finance/receivables");           // PR-3
    expect(kpiRoute("pos_in_flight")).toBe("/procurement/purchase-orders");
    expect(kpiRoute("headcount")).toBe("/hr/employees");            // PR-4
    expect(kpiRoute("made_up_id")).toBeNull();
    // `stock_value` is still hidden — a route for it would promise a drill
    // for a tile that cannot render.
    expect(kpiRoute("stock_value")).toBeNull();
    expect(Object.keys(KPI_ROUTE)).not.toContain("stock_value");
  });
});

describe("buildLateVsEtaDrill", () => {
  const files = [
    { dossier_id: "a", ref: "SL-A", status: "OPEN", eta: "2026-09-01", ata: null, pol: "CNSHA", pod: "CMDLA" },
    { dossier_id: "b", ref: "SL-B", status: "IN_PROGRESS", eta: "2026-09-13", ata: null },
    { dossier_id: "c", ref: "SL-C", status: "IN_PROGRESS", eta: "2026-09-15", ata: null }, // due today: not late
    { dossier_id: "d", ref: "SL-D", status: "OPEN", eta: "2026-09-01", ata: "2026-09-02" }, // arrived
    { dossier_id: "e", ref: "SL-E", status: "COMPLETED", eta: "2026-08-01", ata: null }, // closed
    { dossier_id: "f", ref: "SL-F", status: "OPEN", eta: null, ata: null }, // no ETA
  ];

  it("applies the tile's predicate: open, past a calendar-day ETA, no ATA", () => {
    const d = buildLateVsEtaDrill(files, NOW);
    expect(d.rows.map((r) => r.cells[0])).toEqual(["SL-A", "SL-B"]);
    expect(d.badge.text).toBe("2 late");
  });

  it("ranks the most overdue first and tones a week-plus as bad", () => {
    const d = buildLateVsEtaDrill(files, NOW);
    expect(d.rows[0].cells[3]).toEqual({ text: "14 days", tone: "bad" });
    expect(d.rows[1].cells[3]).toEqual({ text: "2 days", tone: "warn" });
    expect(d.meta.find((m) => m.label === "Worst")?.value).toBe("14 days");
  });

  it("an empty scan is an honest zero, not a failure", () => {
    const d = buildLateVsEtaDrill([], NOW);
    expect(d.rows).toEqual([]);
    expect(d.badge).toEqual({ tone: "ok", text: "0 late" });
    expect(d.cta.to).toBe("/operations/files");
  });
});

describe("buildDwellDrill", () => {
  it("headline is the tile's own average — the modal never recomputes it", () => {
    const d = buildDwellDrill(
      { by_tier: [{ owner_tier: "CARRIER", slips: 3, total_hours: 40 }], by_stage: [{ code: "DISCHARGE", label: "Cargo discharged", owner_tier: "TERMINAL", slips: 2, avg_hours: 12 }] },
      6,
    );
    expect(d.badge.text).toBe("6 days average");
    expect(d.meta[0]).toEqual({ label: "Average dwell", value: "6 days" });
    expect(d.rows[0].cells).toEqual(["Cargo discharged", "Terminal", "2", "12"]);
  });

  it("with no measured delivery it says so rather than '0 days'", () => {
    const d = buildDwellDrill(null, null);
    expect(d.badge.text).toBe("No delivery measured");
    expect(d.meta[0].value).toBe("—");
    expect(d.rows).toEqual([]);
  });
});

describe("buildFleetDocsDrill", () => {
  const docs = [
    { compliance_id: "1", vehicle_id: "v1", registration: "LT-101", kind: "insurance", expires_on: "2026-09-25", days_left: 10 },
    { compliance_id: "2", vehicle_id: "v2", registration: "LT-202", kind: "visite_technique", expires_on: "2026-09-10", days_left: -5 },
    { compliance_id: "3", vehicle_id: "v1", registration: "LT-101", kind: "visite_technique", expires_on: "2026-09-15", days_left: 0 },
  ];

  it("lapsed first, then soonest; lapsed reads as bad", () => {
    const d = buildFleetDocsDrill(docs);
    expect(d.rows.map((r) => r.cells[0])).toEqual(["LT-202", "LT-101", "LT-101"]);
    expect(d.rows[0].cells[3]).toEqual({ text: "Lapsed 5 days ago", tone: "bad" });
    expect(d.rows[1].cells[3]).toEqual({ text: "Expires today", tone: "warn" });
    expect(d.rows[2].cells[1]).toBe("Insurance");
  });

  it("counts vehicles, not documents, in the meta", () => {
    const d = buildFleetDocsDrill(docs);
    expect(d.meta.find((m) => m.label === "Vehicles")?.value).toBe("2");
    expect(d.meta.find((m) => m.label === "Already lapsed")?.value).toBe("1");
    expect(d.badge.tone).toBe("bad");
  });
});

describe("buildWorkOrdersDrill", () => {
  const orders = [
    { work_order_id: "w1", registration: "LT-101", kind: "CORRECTIVE", status: "OPEN", opened_on: "2026-09-01" },
    { work_order_id: "w2", registration: "LT-202", kind: "PREVENTIVE", status: "IN_PROGRESS", opened_on: "2026-09-14" },
    { work_order_id: "w3", registration: "LT-303", kind: "CORRECTIVE", status: "DONE", opened_on: "2026-08-01" },
    { work_order_id: "w4", vehicle_id: null, kind: "PREVENTIVE", status: "CANCELLED", opened_on: "2026-08-01" },
  ];

  it("keeps OPEN and IN_PROGRESS only, oldest first", () => {
    const d = buildWorkOrdersDrill(orders, NOW);
    expect(d.rows.map((r) => r.cells[0])).toEqual(["LT-101", "LT-202"]);
    expect(d.rows[0].cells[3]).toBe("14 days");
    expect(d.badge.text).toBe("2 open");
    expect(d.meta.find((m) => m.label === "Corrective")?.value).toBe("1");
  });
});

describe("buildWarehouseOccupancyDrill", () => {
  const locations = [
    { location_id: "l1", zone: "A", aisle: "01", rack: "R1", bin: "B1", capacity_units: 100 },
    { location_id: "l2", zone: "A", aisle: "01", rack: "R1", bin: "B2", capacity_units: 100 },
    { location_id: "l3", zone: "YARD", yard: "Y1", capacity_units: 500 },
    { location_id: "l4", zone: "B", capacity_units: null }, // no capacity: not on the basis
  ];
  const items = [
    { inventory_item_id: "i1", location_id: "l1", qty_on_hand: 120, state: "AVAILABLE" },
    { inventory_item_id: "i2", location_id: "l3", qty_on_hand: 4000, state: "DISPATCHED" }, // gone
    { inventory_item_id: "i3", location_id: "l4", qty_on_hand: 9, state: "AVAILABLE" }, // uncapacitied
  ];

  it("joins stock onto capacitied locations, fullest first, and excludes DISPATCHED", () => {
    const d = buildWarehouseOccupancyDrill(locations, items, { value: 17, denominator: 700 });
    expect(d.rows.map((r) => r.cells[0])).toEqual(["A-01-R1-B1", "A-01-R1-B2", "YARD-Y1"]);
    expect(d.rows[0].cells[3]).toEqual({ text: "120%", tone: "warn" });
    expect(d.rows[2].cells[3]).toEqual({ text: "0%", tone: "mute" });
    expect(d.meta.find((m) => m.label === "Locations with capacity")?.value).toBe("3");
  });

  it("the headline is the tile's pair — 0 % over 700 units is measurable and says so", () => {
    const d = buildWarehouseOccupancyDrill(locations, [], { value: 0, denominator: 700 });
    expect(d.badge.text).toBe("0% of recorded capacity");
    expect(d.meta[0].value).toBe("0%");
    expect(d.meta[1].value).toContain("700");
  });

  it("no capacity recorded is a different statement from empty (§6.4)", () => {
    const d = buildWarehouseOccupancyDrill([{ location_id: "l4", zone: "B", capacity_units: null }], items, { value: 0, denominator: 0 });
    expect(d.badge).toEqual({ tone: "mute", text: "No capacity recorded" });
    expect(d.meta[0].value).toBe("—");
    expect(d.rows).toEqual([]);
    expect(d.note).toMatch(/Give locations a capacity/);
  });
});
