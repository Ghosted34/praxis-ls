"use strict";
/**
 * Meeting 5 — a costing has ONE currency and ONE rate to XAF, and every price
 * that lands on it (Suggest, a hand-picked line) is converted into it.
 */
jest.mock("../../src/modules/master/currency/currency.service", () => ({
  rateFor: jest.fn(async (_client, { base }) => {
    if (base === "USD") return { rate: 600, as_of_date: "2026-09-27" };
    const e = new Error("no rate"); e.code = "NO_FX_RATE"; throw e;
  }),
}));
const currency = require("../../src/modules/master/currency/currency.service");
const { toSheetCurrency } = require("../../src/modules/costing/costing/costing.suggest");

const priced = (unit, ccy) => ({ unit_cost: unit, currency: ccy, price_source: "EXPENSE_RATE" });
const eur = { currency: "EUR", rate: 655.957, date: "2026-09-27" };

describe("toSheetCurrency", () => {
  beforeEach(() => currency.rateFor.mockClear());

  test("no sheet currency → no conversion (the old contract)", async () => {
    expect(await toSheetCurrency(null, priced(72700, "XAF"), null, new Map())).toEqual(priced(72700, "XAF"));
  });

  test("an XAF rate on an EUR sheet is divided by the sheet's own rate", async () => {
    const r = await toSheetCurrency(null, priced(72700, "XAF"), eur, new Map());
    expect(r).toMatchObject({ unit_cost: 110.83, currency: "EUR", source_unit_cost: 72700, source_currency: "XAF", unit_cost_xaf: 72700 });
    expect(currency.rateFor).not.toHaveBeenCalled();
  });

  test("a third currency goes via XAF at the Currencies rate, then the sheet's", async () => {
    const r = await toSheetCurrency(null, priced(100, "USD"), eur, new Map());
    expect(r).toMatchObject({ unit_cost: 91.47, currency: "EUR", source_unit_cost: 100, source_currency: "USD", unit_cost_xaf: 60000 });
  });

  test("the Currencies quote is fetched once per currency per build", async () => {
    const cache = new Map();
    await toSheetCurrency(null, priced(1, "USD"), eur, cache);
    await toSheetCurrency(null, priced(2, "USD"), eur, cache);
    expect(currency.rateFor).toHaveBeenCalledTimes(1);
  });

  test("no quote on file → unpriced NO_FX with the original figure, never a guess", async () => {
    const r = await toSheetCurrency(null, priced(100, "GBP"), eur, new Map());
    expect(r).toMatchObject({ unit_cost: null, price_source: "NO_FX", source_unit_cost: 100, source_currency: "GBP" });
  });

  test("a rate already in the sheet's currency is kept, with its XAF value", async () => {
    const r = await toSheetCurrency(null, priced(50, "EUR"), eur, new Map());
    expect(r).toMatchObject({ unit_cost: 50, currency: "EUR", source_currency: null, unit_cost_xaf: 32797.85 });
  });

  test("an unpriced line passes through untouched", async () => {
    const none = { unit_cost: null, currency: null, price_source: "NONE" };
    expect(await toSheetCurrency(null, none, eur, new Map())).toBe(none);
  });
});
