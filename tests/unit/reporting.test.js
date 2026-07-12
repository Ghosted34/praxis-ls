"use strict";
const service = require("../../src/modules/vault/report/report.service");

describe("Reporting & Insights (MOD-63)", () => {
  test("catalogue lists the known report keys", () => {
    const cat = service.catalogue();
    const keys = cat.map((r) => r.report_key);
    expect(keys).toEqual(expect.arrayContaining([
      "income_statement", "receivables_ageing", "cash_position", "dossier_margin_portfolio", "procurement_spend",
    ]));
    expect(cat.every((r) => typeof r.describe === "string")).toBe(true);
  });

  test("run dispatches a repo report (cash_position) and shapes it", async () => {
    const client = { query: async () => ({ rows: [
      { account_code: "521", balance: "1000.00" },
      { account_code: "571", balance: "250.50" },
    ] }) };
    const out = await service.run(client, { reportKey: "cash_position", params: {} });
    expect(out.report_key).toBe("cash_position");
    expect(out.data.total_cash).toBe(1250.5);
    expect(out.data.accounts).toHaveLength(2);
  });

  test("run rejects an unknown report key", async () => {
    await expect(service.run({}, { reportKey: "nope" })).rejects.toThrow(/No report/);
  });

  test("procurement_spend aggregates PO + supplier invoices", async () => {
    let call = 0;
    const client = { query: async () => {
      call += 1;
      if (call === 1) return { rows: [{ n: 3, total: "5000" }] };            // POs
      return { rows: [{ n: 2, total: "4200", wht: "200" }] };                 // supplier invoices
    } };
    const out = await service.run(client, { reportKey: "procurement_spend", params: {} });
    expect(out.data.purchase_orders.total_ttc).toBe(5000);
    expect(out.data.supplier_invoices.wht_withheld).toBe(200);
  });
});
