"use strict";

/**
 * §3.1 — margin simulator: LINK COSTING, per-line economics/KPI, VAT toggle,
 * and the DRAFT → SUBMITTED → APPROVED | REJECTED workflow the legacy screen
 * has and our schema previously could not represent (no status column before
 * 10743).
 */
const {
  computeMargin,
  lineEconomics,
} = require("../../src/modules/commercial/margin_simulation/margin_simulation.rules");
const service = require("../../src/modules/commercial/margin_simulation/margin_simulation.service");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("computeMargin — per-line VAT toggle (§3.1)", () => {
  it("adds VAT only on service lines that carry the toggle", () => {
    const t = computeMargin(
      [
        { qty: 1, unit_cost: 100, unit_price: 200, vat_applicable: true },
        { qty: 1, unit_cost: 100, unit_price: 150, vat_applicable: false },
        // débours: pass-through, never taxed even if flagged
        {
          qty: 1,
          unit_cost: 500,
          unit_price: 500,
          is_disbursement: true,
          vat_applicable: true,
        },
      ],
      { vatRatePercent: 19.25 },
    );
    expect(t.vat_total).toBe(38.5); // 200 × 19.25%
    expect(t.total_ttc).toBe(888.5); // 850 + 38.5
    expect(t.margin_amount).toBe(150); // services only, unchanged by VAT
  });

  it("no rate given → no VAT (nothing hardcoded in the rules)", () => {
    const t = computeMargin([
      { qty: 1, unit_cost: 10, unit_price: 20, vat_applicable: true },
    ]);
    expect(t.vat_total).toBe(0);
    expect(t.total_ttc).toBe(20);
  });
});

describe("lineEconomics — the per-line MARGIN + KPI the pricer reads", () => {
  it("labels a line by its own margin, thresholds configurable", () => {
    expect(lineEconomics({ qty: 1, unit_cost: 70, unit_price: 100 }).kpi).toBe(
      "GOOD",
    ); // 30%
    expect(lineEconomics({ qty: 1, unit_cost: 88, unit_price: 100 }).kpi).toBe(
      "FAIR",
    ); // 12%
    expect(lineEconomics({ qty: 1, unit_cost: 100, unit_price: 100 }).kpi).toBe(
      "POOR",
    ); // 0% — legacy 'POOR (0%)'
    expect(
      lineEconomics(
        { qty: 1, unit_cost: 70, unit_price: 100 },
        { green_min: 40 },
      ).kpi,
    ).toBe("FAIR");
  });
  it("débours are pass-through — no margin, no KPI band", () => {
    const e = lineEconomics({
      qty: 1,
      unit_cost: 100,
      unit_price: 100,
      is_disbursement: true,
    });
    expect(e.kpi).toBe("PASS-THROUGH");
    expect(e.margin_percent).toBeNull();
  });
});

describe("fromCosting — LINK COSTING import", () => {
  function fakeClient({ currency = "USD", rate = 612.34 } = {}) {
    const queries = [];
    return {
      queries,
      async query(sql, params) {
        queries.push({ sql, params });
        if (/FROM costing WHERE costing_id/.test(sql))
          return {
            rows: [
              {
                costing_id: UUID(1),
                doc_number: "CST-9",
                dossier_id: UUID(2),
                currency,
                exchange_rate_to_xaf: rate,
                status: "APPROVED_LOCKED",
              },
            ],
          };
        if (/FROM costing_line/.test(sql))
          return {
            rows: [
              {
                dictionary_item_id: UUID(3),
                label: "Ocean freight",
                qty: 2,
                unit_cost: 1000,
                is_disbursement: false,
                tax_code_id: UUID(4),
              },
              {
                dictionary_item_id: UUID(5),
                label: "Customs duty",
                qty: 1,
                unit_cost: 500,
                is_disbursement: true,
                tax_code_id: null,
              },
            ],
          };
        return { rows: [] };
      },
    };
  }

  it("converts unit costs with the costing's OWN rate — not a hardcoded 615", async () => {
    const out = await service.fromCosting(fakeClient(), { costingId: UUID(1) });
    expect(out.costing.converted_to_xaf).toBe(true);
    expect(out.lines[0].unit_cost).toBe(612340); // 1000 × 612.34
    expect(out.lines[0].unit_price).toBe(0); // pricing is the pricer's job
    expect(out.lines[0].vat_applicable).toBe(true); // tax code → toggle
    expect(out.lines[1].is_disbursement).toBe(true);
  });

  it("XAF costing imports untouched", async () => {
    const out = await service.fromCosting(
      fakeClient({ currency: "XAF", rate: 1 }),
      { costingId: UUID(1) },
    );
    expect(out.costing.converted_to_xaf).toBe(false);
    expect(out.lines[0].unit_cost).toBe(1000);
  });

  it("404s a costing that does not exist", async () => {
    const c = {
      async query() {
        return { rows: [] };
      },
    };
    await expect(
      service.fromCosting(c, { costingId: UUID(9) }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("workflow — DRAFT → SUBMITTED → APPROVED | REJECTED", () => {
  function fakeClient({ status = "DRAFT", submittedBy = null } = {}) {
    const queries = [];
    return {
      queries,
      async query(sql, params) {
        queries.push({ sql, params });
        if (/FROM margin_simulation WHERE/.test(sql))
          return {
            rows: [
              {
                margin_simulation_id: UUID(1),
                status,
                submitted_by: submittedBy,
              },
            ],
          };
        if (/UPDATE margin_simulation SET/.test(sql))
          return {
            rows: [
              {
                margin_simulation_id: UUID(1),
                status: /APPROVED/.test(sql)
                  ? "APPROVED"
                  : /REJECTED/.test(sql)
                    ? "REJECTED"
                    : "SUBMITTED",
                reject_reason: /REJECTED/.test(sql) ? params[2] : null,
              },
            ],
          };
        return { rows: [] };
      },
    };
  }
  const actor = { user_id: UUID(7) };

  it("submit moves a DRAFT to SUBMITTED", async () => {
    const out = await service.submit(fakeClient(), { id: UUID(1), actor });
    expect(out.status).toBe("SUBMITTED");
  });

  it("submit refuses a non-DRAFT", async () => {
    await expect(
      service.submit(fakeClient({ status: "APPROVED" }), {
        id: UUID(1),
        actor,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("approve enforces maker-checker", async () => {
    await expect(
      service.approve(
        fakeClient({ status: "SUBMITTED", submittedBy: UUID(7) }),
        { id: UUID(1), actor },
      ),
    ).rejects.toMatchObject({ status: 422 });
    const out = await service.approve(
      fakeClient({ status: "SUBMITTED", submittedBy: UUID(8) }),
      { id: UUID(1), actor },
    );
    expect(out.status).toBe("APPROVED");
  });

  it("reject needs a reason", async () => {
    await expect(
      service.reject(fakeClient({ status: "SUBMITTED" }), {
        id: UUID(1),
        reason: " ",
        actor,
      }),
    ).rejects.toMatchObject({ status: 422 });
    const out = await service.reject(fakeClient({ status: "SUBMITTED" }), {
      id: UUID(1),
      reason: "Price below floor",
      actor,
    });
    expect(out.status).toBe("REJECTED");
    expect(out.reject_reason).toBe("Price below floor");
  });
});
