"use strict";
/**
 * Tenant review "meeting 5" (21 Sep 2026) — the pure halves of the dictionary
 * changes. The database halves (standard rate, re-lettered codes, apply to
 * carriers) are in tests/integration/dictionary-standard-rate.test.js.
 */
const { titleCase } = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");
const { standardRateJoin, STANDARD_RATE_COLUMNS } = require("../../src/modules/master/expense_rate/standard-rate.sql");

describe("titleCase — every word capitalised, each language's small words left small", () => {
  test.each([
    ["shipping line charges", "en", "Shipping Line Charges"],
    ["frais de dossier", "fr", "Frais de Dossier"],
    // A small word typed with a capital is lowered…
    ["Frais De Dossier", "fr", "Frais de Dossier"],
    ["frais d'agence et de documentation", "fr", "Frais d'Agence et de Documentation"],
    ["commission on disbursements", "en", "Commission on Disbursements"],
    // …but one opening the label or a phrase after a dash / bracket is not.
    ["à la charge du client", "fr", "À la Charge du Client"],
    ["transport — pour compte client", "fr", "Transport — Pour Compte Client"],
    ["l'entrepôt", "fr", "L'Entrepôt"],
    ["the end of the line", "en", "The End of the Line"],
    // Only the first letter moves: acronyms survive, unlike initcap(); an
    // all-caps small word is an acronym or a letter, never lowered.
    ["THC per box", "en", "THC per Box"],
    ["IT equipment & hardware", "en", "IT Equipment & Hardware"],
    ["air waybill (awb) fee", "en", "Air Waybill (Awb) Fee"],
    ["type A container", "en", "Type A Container"],
    ["frais DE ligne", "fr", "Frais DE Ligne"],
    // Hyphen and slash separate words inside a phrase.
    ["last-mile / port exit", "en", "Last-Mile / Port Exit"],
    ["porte-à-porte", "fr", "Porte-à-Porte"],
    ["écrou", "fr", "Écrou"],
  ])("%s (%s) → %s", (input, lang, out) => expect(titleCase(input, lang)).toBe(out));

  test("already title case is a no-op, and a missing label stays missing", () => {
    expect(titleCase("Documentation Fee", "en")).toBe("Documentation Fee");
    expect(titleCase("Frais de Dossier", "fr")).toBe("Frais de Dossier");
    expect(titleCase(null)).toBeNull();
    expect(titleCase(undefined)).toBeUndefined();
  });
});

describe("the standard rate SQL — one definition for every reader", () => {
  test("joins the no-carrier, no-container-type rate in force today", () => {
    const sql = standardRateJoin("di");
    expect(sql).toMatch(/er\.dictionary_item_id = di\.dictionary_item_id/);
    expect(sql).toMatch(/rate_provider_id IS NULL/);
    expect(sql).toMatch(/container_type_ref_id IS NULL/);
    expect(sql).toMatch(/effective_from <= CURRENT_DATE/);
    expect(STANDARD_RATE_COLUMNS).toMatch(/sr\.rate AS default_price\b/);
  });

  test("refuses an alias that is not a bare identifier", () => {
    expect(() => standardRateJoin("di; DROP TABLE x")).toThrow(/bad alias/);
  });
});
