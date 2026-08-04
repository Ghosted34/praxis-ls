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
import { buildFleetDrill, buildOverdueDrill, buildRevenueDrill, buildSlaDrill } from "./drilldowns";

const NAMES = { c1: "Bolloré Transport", c2: "Sonara" };

const invoice = (client: string, ttc: number, status = "POSTED_LOCKED") => ({
  type: "FINAL",
  status,
  client_id: client,
  total_ttc: ttc,
});

describe("buildRevenueDrill", () => {
  const rows = [invoice("c1", 11_200_000), invoice("c2", 6_400_000), invoice("c1", 2_400_000)];

  it("counts only LOCKED final invoices", () => {
    const d = buildRevenueDrill([...rows, invoice("c2", 999, "DRAFT")], NAMES, "XAF", null, 4);
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
    expect(buildRevenueDrill(rows, NAMES, "XAF", 20_000_000, 3).note).toBeUndefined();
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
    { dossier_id: "d1", ref: "OPS-1", pol: "Antwerp", pod: "Douala", eta: "2026-07-01", ata: "2026-07-06" },
    { dossier_id: "d2", ref: "OPS-2", pol: "Kribi", pod: "Douala", eta: "2026-07-01", ata: "2026-06-30" },
    { dossier_id: "d3", ref: "OPS-3", pol: "Douala", pod: "Garoua", eta: "2026-07-01", ata: null },
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
    expect(buildSlaDrill(dossiers).meta.find((m) => m.label === "On time")?.value).toBe("50%");
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
      { invoice_id: "i1", doc_number: "INV-0311", client_id: "c2", outstanding: 6_400_000, days_overdue: 34 },
      { invoice_id: "i2", doc_number: "INV-0287", client_id: "c1", outstanding: 4_800_000, days_overdue: 12 },
    ],
  };

  it("escalates the tone past thirty days", () => {
    const d = buildOverdueDrill(payload, NAMES, "XAF");
    expect(d.rows[0].cells[3]).toEqual({ text: "34 days", tone: "bad" });
    expect(d.rows[1].cells[3]).toEqual({ text: "12 days", tone: "warn" });
  });

  it("resolves client ids to names", () => {
    expect(buildOverdueDrill(payload, NAMES, "XAF").rows[0].cells[1]).toBe("Sonara");
  });

  it("survives a null payload — the module may be off for this tenant", () => {
    const d = buildOverdueDrill(null, NAMES, "XAF");
    expect(d.rows).toHaveLength(0);
    expect(d.empty.title).toBe("Nothing past due");
  });
});

describe("buildFleetDrill", () => {
  const vehicles = [
    { vehicle_id: "v1", registration: "LT-4471", category: "Truck", status: "ACTIVE" },
    { vehicle_id: "v2", registration: "LT-4429", category: "Truck", status: "WORKSHOP" },
  ];

  it("reports utilisation over the register", () => {
    const d = buildFleetDrill(vehicles);
    expect(d.badge.text).toBe("1 of 2 active");
    expect(d.meta.find((m) => m.label === "Utilisation")?.value).toBe("50%");
  });

  it("says em-dash rather than dividing by zero on an empty register", () => {
    expect(buildFleetDrill([]).meta.find((m) => m.label === "Utilisation")?.value).toBe("—");
  });
});
