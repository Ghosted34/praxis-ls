"use strict";
/**
 * ISO-4217 currency catalogue (@praxis/shared data/currencies.js): coverage,
 * minor-unit correctness, and the country cross-reference the Smart Currency
 * Picker relies on (search by country → currency, e.g. Holland → EUR).
 */
const currencies = require("../../packages/shared/data/currencies");
const countries = require("../../packages/shared/data/countries");

describe("currency catalogue", () => {
  it("covers every currency any country trades in (picker never dead-ends)", () => {
    const used = new Set(countries.COUNTRIES.map((c) => c.currency));
    const missing = [...used].filter((code) => !currencies.byCode(code));
    expect(missing).toEqual([]);
  });

  it("every catalogue row has a representative country for its flag", () => {
    const orphans = currencies.CATALOGUE.filter((c) => !c.country_code).map(
      (c) => c.code,
    );
    expect(orphans).toEqual([]);
  });

  it("gets ISO minor units right (0 / 2 / 3 decimals)", () => {
    expect(currencies.decimalsFor("XAF")).toBe(0); // CFA franc — no cents
    expect(currencies.decimalsFor("JPY")).toBe(0);
    expect(currencies.decimalsFor("USD")).toBe(2);
    expect(currencies.decimalsFor("EUR")).toBe(2);
    expect(currencies.decimalsFor("BHD")).toBe(3); // Gulf dinar — three
    expect(currencies.decimalsFor("KWD")).toBe(3);
  });

  it("resolves a currency from a country (Holland → EUR)", () => {
    expect(currencies.forCountry("NL").code).toBe("EUR");
    expect(currencies.forCountry("US").code).toBe("USD");
    expect(currencies.forCountry("CM").code).toBe("XAF");
  });

  it("lists the countries that trade in a currency, priority-ordered", () => {
    const xaf = currencies.countriesFor("XAF").map((c) => c.code);
    expect(xaf).toContain("CM");
    expect(xaf).toEqual(["CM", "CF", "TD", "CG", "GA", "GQ"]); // CEMAC
    expect(currencies.countriesFor("EUR").length).toBeGreaterThan(10);
  });

  it("leads with the trade lanes (CEMAC/OHADA first)", () => {
    expect(currencies.CATALOGUE[0].code).toBe("XAF");
  });

  it("byCode is case-insensitive and unknown codes are undefined", () => {
    expect(currencies.byCode("eur").code).toBe("EUR");
    expect(currencies.byCode("ZZZ")).toBeUndefined();
  });
});
