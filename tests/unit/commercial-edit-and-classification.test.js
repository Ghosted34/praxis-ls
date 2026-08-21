"use strict";

/**
 * §2.1–§2.6 — the six defects behind the commercial screens.
 *
 * 1  a saved simulation could not be edited at all (no update endpoint)
 * 2  cost nature was a copied boolean, not the catalogue's classification
 * 3  an invoice line collapsed qty to 1 and billed extended cost as unit price
 * 4  the extra-charge engine held its own VAT literal
 * 5  a zero-margin simulation could be submitted with nothing asked
 * 6  a saved extra-charge simulation came back without its computed result
 */

const {
  classifyLine,
  computeMargin,
} = require("../../src/modules/commercial/margin_simulation/margin_simulation.rules");
const marginService = require("../../src/modules/commercial/margin_simulation/margin_simulation.service");
const {
  simulateCharges,
} = require("../../src/modules/commercial/extra_charge_simulation/extra_charge_simulation.rules");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
jest.mock("../../src/shared/config/settings", () => ({
  getRule: jest.fn(async (_c, _s, _k, _f, fallback) => fallback),
  getSetting: jest.fn(async () => null),
  putSetting: jest.fn(async () => {}),
}));

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

// ── §2.1 cost nature ────────────────────────────────────────────────────────

describe("classifyLine — the catalogue decides what a line IS (§2.1)", () => {
  it("a DISBURSEMENT item is pass-through even when the line says otherwise", () => {
    const n = classifyLine(
      { is_disbursement: false, vat_applicable: true },
      { direction: "DISBURSEMENT" },
    );
    expect(n.is_disbursement).toBe(true);
    expect(n.vat_applicable).toBe(false);
    expect(n.source).toBe("catalogue");
  });

  it("a REVENUE item is a service even when the line was flagged débours", () => {
    // The mis-flag that made every SBX-2026-0001 line PASS-THROUGH.
    const n = classifyLine(
      { is_disbursement: true, vat_applicable: true },
      { direction: "REVENUE" },
    );
    expect(n.is_disbursement).toBe(false);
    expect(n.vat_applicable).toBe(true);
  });

  it("falls back to category and to the item's own flag", () => {
    expect(classifyLine({}, { direction: "EXPENSE", category: "disbursement" }).is_disbursement).toBe(true);
    expect(classifyLine({}, { direction: "EXPENSE", is_disbursement: true }).is_disbursement).toBe(true);
    expect(classifyLine({}, { direction: "EXPENSE" }).is_disbursement).toBe(false);
  });

  it("no catalogue row → the stored flag, MARKED as unclassified", () => {
    const n = classifyLine({ is_disbursement: true }, null);
    expect(n.is_disbursement).toBe(true);
    expect(n.source).toBe("line");
  });

  it("a disbursement is NEVER VAT-applicable — the DB refuses that pair", () => {
    // chk_disbursement_no_tax (0230:92) and assert_line_valid() (0640:156).
    for (const dict of [
      { direction: "DISBURSEMENT" },
      { direction: "EXPENSE", category: "disbursement" },
      { direction: "EXPENSE", is_disbursement: true },
    ]) {
      expect(classifyLine({ vat_applicable: true }, dict).vat_applicable).toBe(false);
    }
    expect(classifyLine({ is_disbursement: true, vat_applicable: true }, null).vat_applicable).toBe(false);
  });
});

describe("fromCosting — classification travels with the import (§2.1)", () => {
  const costingRow = {
    costing_id: UUID(1), doc_number: "CST-1", dossier_id: UUID(2),
    currency: "XAF", exchange_rate_to_xaf: 1, status: "APPROVED_LOCKED",
  };
  const client = (lineRows) => ({
    async query(sql) {
      if (/FROM costing WHERE costing_id/.test(sql)) return { rows: [costingRow] };
      if (/FROM costing_line/.test(sql)) return { rows: lineRows };
      return { rows: [] };
    },
  });

  it("the catalogue overrides a stale costing_line flag", async () => {
    const out = await marginService.fromCosting(
      client([
        // stored flag says service; the catalogue says pass-through
        { dictionary_item_id: UUID(3), label: "Customs duty", qty: 1, unit_cost: 500, is_disbursement: false, tax_code_id: UUID(9), dict_direction: "DISBURSEMENT" },
        // stored flag says débours; the catalogue says it is revenue
        { dictionary_item_id: UUID(4), label: "Handling", qty: 1, unit_cost: 100, is_disbursement: true, tax_code_id: UUID(9), dict_direction: "REVENUE" },
      ]),
      { costingId: UUID(1) },
    );
    expect(out.lines[0]).toMatchObject({ is_disbursement: true, vat_applicable: false, nature_source: "catalogue" });
    expect(out.lines[1]).toMatchObject({ is_disbursement: false, vat_applicable: true, nature_source: "catalogue" });
    expect(out.unclassified).toEqual([]);
  });

  it("a line whose catalogue item is gone keeps its flag and is reported", async () => {
    // The item was recycled (0641): the LEFT JOIN returns no direction. This
    // must NOT read as 'no direction, therefore not a disbursement'.
    const out = await marginService.fromCosting(
      client([
        { dictionary_item_id: UUID(3), label: "Ghost duty", qty: 1, unit_cost: 500, is_disbursement: true, tax_code_id: null, dict_direction: null },
      ]),
      { costingId: UUID(1) },
    );
    expect(out.lines[0].is_disbursement).toBe(true);
    expect(out.lines[0].nature_source).toBe("line");
    expect(out.unclassified).toEqual(["Ghost duty"]);
  });
});

// ── §2.4a draft editing ─────────────────────────────────────────────────────

describe("update — a DRAFT can be edited at all (§2.4a)", () => {
  function fakeClient({ status = "DRAFT" } = {}) {
    const q = [];
    return {
      queries: q,
      async query(sql, params) {
        q.push({ sql, params });
        if (/FROM margin_simulation WHERE/.test(sql)) {
          return { rows: [{ margin_simulation_id: UUID(1), status, currency: "XAF", total_price: 0, margin_percent: 0 }] };
        }
        if (/FROM dictionary_item WHERE dictionary_item_id = ANY/.test(sql)) return { rows: [] };
        if (/FROM margin_simulation_line WHERE/.test(sql)) return { rows: [] };
        if (/UPDATE margin_simulation SET/.test(sql)) return { rows: [{ margin_simulation_id: UUID(1), status: "DRAFT" }] };
        return { rows: [] };
      },
    };
  }
  const lines = [{ qty: 2, unit_cost: 100, unit_price: 150 }];

  it("replaces the line set and re-caches the header totals", async () => {
    const c = fakeClient();
    await marginService.update(c, { id: UUID(1), lines, actor: { user_id: UUID(7) } });
    const sql = c.queries.map((x) => x.sql).join("\n");
    expect(sql).toMatch(/DELETE FROM margin_simulation_line/);
    // The registry reads these columns; a line edit that left them stale would
    // make the list disagree with the document.
    const upd = c.queries.find((x) => /UPDATE margin_simulation SET/.test(x.sql));
    expect(upd.sql).toMatch(/total_price/);
    expect(upd.params).toContain(300); // 2 × 150
  });

  it("editing a REJECTED simulation returns it to DRAFT and clears the verdict", async () => {
    const c = fakeClient({ status: "REJECTED" });
    await marginService.update(c, { id: UUID(1), lines, actor: {} });
    const upd = c.queries.find((x) => /UPDATE margin_simulation SET/.test(x.sql));
    expect(upd.sql).toMatch(/status/);
    expect(upd.params).toContain("DRAFT");
    // Otherwise submit (DRAFT-only) stays unreachable — the same dead end.
    expect(upd.sql).toMatch(/reject_reason/);
  });

  it("refuses to edit anything past REJECTED", async () => {
    for (const status of ["SUBMITTED", "APPROVED"]) {
      await expect(
        marginService.update(fakeClient({ status }), { id: UUID(1), lines, actor: {} }),
      ).rejects.toMatchObject({ status: 422, code: "LOCKED" });
    }
  });

  it("re-pricing clears a justification written for the old numbers", async () => {
    const c = fakeClient();
    await marginService.update(c, { id: UUID(1), lines, actor: {} });
    const upd = c.queries.find((x) => /UPDATE margin_simulation SET/.test(x.sql));
    expect(upd.sql).toMatch(/low_margin_justification/);
    expect(upd.params).toContain(null);
  });
});

// ── §2.5 the submit gate ────────────────────────────────────────────────────

describe("submit — a thin deal has to say why (§2.5)", () => {
  // The real SBX-2026-0001: 95,700,000 of cost, nothing priced.
  const SBX = [
    { qty: 40, unit_cost: 2000000, unit_price: 0, is_disbursement: false },
    { qty: 1, unit_cost: 8500000, unit_price: 0, is_disbursement: false },
    { qty: 40, unit_cost: 180000, unit_price: 0, is_disbursement: false },
  ];
  function fakeClient({ lines, justification = null } = {}) {
    return {
      async query(sql) {
        if (/FROM margin_simulation_line WHERE/.test(sql)) return { rows: lines };
        if (/FROM margin_simulation WHERE/.test(sql)) {
          return { rows: [{ margin_simulation_id: UUID(1), status: "DRAFT", currency: "XAF", low_margin_justification: justification }] };
        }
        if (/UPDATE margin_simulation SET/.test(sql)) return { rows: [{ status: "SUBMITTED" }] };
        return { rows: [] };
      },
    };
  }

  it("blocks the SBX-2026-0001 shape and names the numbers", async () => {
    const err = await marginService
      .submit(fakeClient({ lines: SBX }), { id: UUID(1), actor: {} })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "LOW_MARGIN_JUSTIFICATION_REQUIRED", status: 422 });
    expect(err.details.margin_amount).toBe(-95700000);
    expect(err.message).toContain("95700000");
  });

  it("lets it through once a reason is given, and stores the reason", async () => {
    const out = await marginService.submit(
      fakeClient({ lines: SBX }),
      { id: UUID(1), justification: "Strategic loss-leader, approved verbally by the MD", actor: {} },
    );
    expect(out.status).toBe("SUBMITTED");
  });

  it("a token reason is not a reason", async () => {
    await expect(
      marginService.submit(fakeClient({ lines: SBX }), { id: UUID(1), justification: "ok", actor: {} }),
    ).rejects.toMatchObject({ code: "LOW_MARGIN_JUSTIFICATION_REQUIRED" });
  });

  it("a healthy margin needs nothing", async () => {
    const out = await marginService.submit(
      fakeClient({ lines: [{ qty: 1, unit_cost: 100, unit_price: 200, is_disbursement: false }] }),
      { id: UUID(1), actor: {} },
    );
    expect(out.status).toBe("SUBMITTED");
  });

  it("exactly break-even still needs a reason", async () => {
    await expect(
      marginService.submit(
        fakeClient({ lines: [{ qty: 1, unit_cost: 100, unit_price: 100, is_disbursement: false }] }),
        { id: UUID(1), actor: {} },
      ),
    ).rejects.toMatchObject({ code: "LOW_MARGIN_JUSTIFICATION_REQUIRED" });
  });

  it("an empty simulation cannot be submitted", async () => {
    await expect(
      marginService.submit(fakeClient({ lines: [] }), { id: UUID(1), actor: {} }),
    ).rejects.toMatchObject({ code: "NO_LINES" });
  });

  it("a pure pass-through file is not a thin deal — it has no service base", async () => {
    // All débours: margin is 0 because there is nothing to earn on, which is
    // correct, not suspicious. It still asks, and that is deliberate: someone
    // should say "this is a pure disbursement re-bill" out loud.
    const t = computeMargin(
      [{ qty: 1, unit_cost: 500, unit_price: 500, is_disbursement: true }],
      { vatRatePercent: 19.25 },
    );
    expect(t.margin_amount).toBe(0);
  });
});

// ── §2.3 the tenant VAT rate ────────────────────────────────────────────────

describe("simulateCharges — VAT comes from the tenant, not a literal (§2.3)", () => {
  const base = { containers: "2x40HC", ata: "2026-08-01", gateOut: "2026-08-20", freeDays: 11, currency: "XAF" };

  it("uses the rate it is given", () => {
    const out = simulateCharges({ ...base, vatRate: 0.05 });
    expect(out.vat_rate).toBe(0.05);
    expect(out.vat).toBe(Math.round(out.total_ht * 0.05 * 100) / 100);
    expect(out.total_ttc).toBe(Math.round((out.total_ht + out.vat) * 100) / 100);
  });

  it("a zero-rated tenant gets zero VAT, not 19.25%", () => {
    expect(simulateCharges({ ...base, vatRate: 0 }).vat).toBe(0);
  });

  it("falls back to the legacy rate only when nothing is supplied", () => {
    expect(simulateCharges(base).vat_rate).toBe(0.1925);
  });

  it("the rate actually moves the total", () => {
    const hi = simulateCharges({ ...base, vatRate: 0.1925 });
    const lo = simulateCharges({ ...base, vatRate: 0.05 });
    expect(hi.total_ht).toBe(lo.total_ht);
    expect(hi.vat).toBeGreaterThan(lo.vat);
  });
});

// ── §2.2 the invoice line ───────────────────────────────────────────────────

describe("invoice line schema — qty × unit_price, not a lump (§2.2)", () => {
  const { finalInvoice } = require("@praxis/shared");
  const ok = { dictionary_item_id: UUID(3) };

  it("accepts the real shape", () => {
    expect(finalInvoice.line.safeParse({ ...ok, qty: 40, unit_price: 2000000 }).success).toBe(true);
  });

  it("still accepts the deprecated lump so existing callers keep working", () => {
    expect(finalInvoice.line.safeParse({ ...ok, amount: 500 }).success).toBe(true);
  });

  it("refuses a line that states no price at all", () => {
    expect(finalInvoice.line.safeParse(ok).success).toBe(false);
  });

  it("refuses a taxed disbursement — the DB would refuse it anyway", () => {
    const r = finalInvoice.line.safeParse({ ...ok, amount: 500, is_disbursement: true, tax_code_id: UUID(4) });
    expect(r.success).toBe(false);
  });

  it("a disbursement without tax is fine", () => {
    expect(finalInvoice.line.safeParse({ ...ok, amount: 500, is_disbursement: true }).success).toBe(true);
  });
});
