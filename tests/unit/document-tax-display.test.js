"use strict";
/**
 * The VAT column of a quotation / invoice prints each line's OWN rate (meeting
 * 5 follow-up) — none on a disbursement, the tax code's rate otherwise — while
 * the signed canonical payload keeps the value it was signed with, so no signed
 * document turns "amended" because the page got more accurate.
 */
const registry = require("../../src/services/documents/templates/registry");
const kit = require("../../src/services/documents/templates/kit");
const canonical = require("../../src/services/signatures/canonical");

const doc = (lines) => ({
  number: "Q-1", date: "2026-09-27", valid_until: "2026-10-27", currency: "XAF",
  party: { name: "CIMENCAM", lines: [] },
  lines,
  totals: { service_ht: 100000, vat_total: 0, total_ttc: 150000 },
});

test("an exempt line prints 0%, a disbursement prints no rate, and the hash is unchanged", () => {
  const legacy = [
    { label: "Handling", qty: 1, unit: 100000, tax: 19.25, amount: 100000 },
    { label: "Customs duty", qty: 1, unit: 50000, tax: 19.25, amount: 50000 },
  ];
  const withRates = [
    { ...legacy[0], tax_rate: 0 },
    { ...legacy[1], tax_rate: null },
  ];
  expect(canonical.hash("QUOTATION", doc(withRates))).toBe(canonical.hash("QUOTATION", doc(legacy)));

  const tpl = registry.get("QUOTATION");
  const cfg = { ...kit.defaults(), language: "en" };
  const html = tpl.build({ ...doc(withRates), client_headings: [] }, cfg, { legal_name: "ACME" }, null);
  expect(html).toContain("0%");
  expect(html).not.toContain("19.25%");
});
