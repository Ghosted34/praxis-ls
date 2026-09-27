"use strict";
/**
 * The client portal shows what an invoice was for (meeting 5), grouped by
 * family exactly as the printed invoice groups it — and nothing for an
 * invoice that is not this client's, or not yet issued.
 */
const service = require("../../src/modules/portal/portal.service");
const repo = require("../../src/modules/portal/portal.repo");

afterEach(() => jest.restoreAllMocks());

const REGISTRY = [
  { code: "CUSTOMS", fr: "Formalités Douanières", en: "Customs Formalities", sort: 10 },
  { code: "FREIGHT", fr: "Fret", en: "Freight & Carrier Charges", sort: 20 },
];
const line = (label, amount, code, extra = {}) => ({
  label, qty: 1, unit_price: amount, line_ht: amount, is_disbursement: false, client_heading: null,
  tax_rate_percent: 19.25, client_heading_code: code,
  client_heading_fr: REGISTRY.find((r) => r.code === code).fr,
  client_heading_en: REGISTRY.find((r) => r.code === code).en,
  client_heading_sort: REGISTRY.find((r) => r.code === code).sort,
  ...extra,
});

test("six customs lines read as one family line, disbursements apart", async () => {
  jest.spyOn(repo, "clientInvoiceWithLines").mockResolvedValue({
    invoice: { invoice_id: "i1", doc_number: "FCT-1", status: "ISSUED_LOCKED", currency: "XAF", service_ht: 300000, disbursement_total: 200000, vat_total: 57750, total_ttc: 557750 },
    lines: [
      line("Clearance fee", 150000, "CUSTOMS"),
      line("Gate pass", 150000, "CUSTOMS"),
      line("Customs duty", 200000, "CUSTOMS", { is_disbursement: true, tax_rate_percent: null }),
    ],
    registry: REGISTRY,
  });
  const out = await service.clientInvoice({}, { clientId: "c1", invoiceId: "i1", lang: "en" });
  expect(out.lines).toHaveLength(2);
  expect(out.lines.map((l) => l.amount).sort()).toEqual([200000, 300000]);
  expect(out.lines.find((l) => l.is_disbursement).tax).toBeNull();
  expect(out.lines.every((l) => l.label.startsWith("Customs Formalities"))).toBe(true);
});

test("an invoice that is not this client's (or not issued) is a 404", async () => {
  jest.spyOn(repo, "clientInvoiceWithLines").mockResolvedValue(null);
  await expect(service.clientInvoice({}, { clientId: "c1", invoiceId: "other" }))
    .rejects.toMatchObject({ status: 404 });
});

test("the repo scopes the read to the client and to issued invoices, in SQL", async () => {
  const seen = [];
  const client = { query: jest.fn(async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; }) };
  await repo.clientInvoiceWithLines(client, { clientId: "c1", invoiceId: "i1" });
  expect(seen[0].sql).toMatch(/client_id = \$2/);
  expect(seen[0].sql).toMatch(/NOT IN \('DRAFT'/);
  expect(seen[0].params).toEqual(["i1", "c1"]);
  await repo.clientInvoices(client, "c1");
  expect(seen[seen.length - 1].sql).toMatch(/NOT IN \('DRAFT'/);
});
