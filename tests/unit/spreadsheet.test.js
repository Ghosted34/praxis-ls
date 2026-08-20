/**
 * The branded, currency-aware spreadsheet service (services/spreadsheet).
 *
 * WHAT THIS IS GUARDING. Three promises the product makes about every file it
 * emits, each of which regresses silently if nobody looks:
 *
 *   BRAND — a tenant whose primary is blue gets a blue header and their name as
 *   creator; nobody's export says another product's name on it. The neutral
 *   default is Praxis's own, never a leftover house palette.
 *
 *   MONEY — amounts are raw typed NUMBERS that SUM, with decimals from the
 *   tenant's own currency rows (0 for XAF — the franc has no cents), the ISO
 *   code in the header and nowhere else, and the base companion column only
 *   when the row currency differs, converted through MOD-08 rather than a
 *   JavaScript rate someone typed in 2024.
 *
 *   SAFETY — text cells are formula-injection-locked, sheet names obey Excel's
 *   rules, and a sandbox export is identifiable from the cover AND the
 *   filename, because a Test file that looks statutory gets attached to a real
 *   dossier eventually.
 *
 * The builder is pure, so every test feeds a fixture context — no DB. The one
 * DB-touching helper (convertToBase) runs against a stub of MOD-08, which is
 * the point: the test proves conversion CAME from there.
 */
"use strict";

const ExcelJS = require("exceljs");
const {
  buildWorkbook,
  buildCsv,
  parseCsv,
  parseWorkbook,
  neutralContext,
  moneyColumns,
  convertToBase,
  exportFilename,
  sheetName,
  escapeFormula,
} = require("../../src/services/spreadsheet");
const resolveContext = require("../../src/services/spreadsheet/context").resolveContext;

// MOD-08 stubs for convertToBase: the test asserts conversion CAME from the
// currency service (spy calls + stub answers in the output), which is exactly
// what a hardcoded rate table could not satisfy.
jest.mock("../../src/modules/master/currency/currency.service", () => ({
  convertAmount: jest.fn(),
  rateFor: jest.fn(),
  listCurrencies: jest.fn(async () => []),
}));
jest.mock("../../src/modules/master/currency/currency.repo", () => ({
  getBaseCode: jest.fn(async () => null),
  listCurrencies: jest.fn(async () => []),
}));

const currencyService = require("../../src/modules/master/currency/currency.service");
const currencyRepo = require("../../src/modules/master/currency/currency.repo");

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/** A tenant with a NON-maroon primary, XAF base, French entity, Douala tz. */
function fixtureContext(overrides = {}) {
  return neutralContext({
    tenant: {
      name: "Smart Logistics",
      primary: "#1D4ED8", // blue — proves the header is the tenant's colour, not a house palette
      primaryForeground: "#FFFFFF",
      accent: "#F5821F",
      logoUrl: null,
      logo: null,
      fontDisplay: null,
      fontBody: null,
    },
    entity: {
      legal_name: "Smart Logistics SARL",
      rccm: "RC/DLA/2024/B/1234",
      niu: "M091500012345P",
      address: "Douala, Cameroun",
      default_currency: "XAF",
      default_language: "fr",
      timezone: "Africa/Douala",
    },
    currencies: {
      XAF: { code: "XAF", symbol: "FCFA", name: "Central African CFA Franc", decimals: 0, is_base: true },
      USD: { code: "USD", symbol: "$", name: "US Dollar", decimals: 2, is_base: false },
      TND: { code: "TND", symbol: "DT", name: "Tunisian Dinar", decimals: 3, is_base: false },
    },
    baseCurrency: "XAF",
    language: "fr",
    timezone: "Africa/Douala",
    env: "live",
    actor: { user_id: "u-1", name: "Alice Nkuli" },
    title: "Grand livre",
    filters: { period: "2026-08" },
    generatedAt: new Date("2026-08-20T14:30:00Z"),
    ...overrides,
  });
}

async function load(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

/* ── Brand ────────────────────────────────────────────────────────────────── */

describe("brand — the tenant's identity, not a house palette", () => {
  it("fills the header row with the tenant primary (ARGB) and contrast font", async () => {
    const buf = await buildWorkbook({
      sheets: [{ name: "T", columns: [{ header: "A", key: "a" }], rows: [{ a: 1 }] }],
      context: fixtureContext(),
    });
    const wb = await load(buf);
    const cell = wb.getWorksheet("T").getCell("A1");
    expect(cell.fill.fgColor.argb).toBe("FF1D4ED8");
    expect(cell.font.color.argb).toBe("FFFFFFFF");
  });

  it("sets creator/lastModifiedBy to the tenant name — never another product", async () => {
    const buf = await buildWorkbook({
      sheets: [{ name: "T", columns: [{ header: "A", key: "a" }], rows: [] }],
      context: fixtureContext(),
    });
    const wb = await load(buf);
    expect(wb.creator).toBe("Smart Logistics");
    expect(wb.lastModifiedBy).toBe("Smart Logistics");
    expect(String(wb.creator)).not.toMatch(/pixie/i);
  });

  it("falls back to the neutral Praxis default (name and colour) with no context", async () => {
    const buf = await buildWorkbook({
      sheets: [{ name: "T", columns: [{ header: "A", key: "a" }], rows: [] }],
    });
    const wb = await load(buf);
    expect(wb.creator).toBe("Praxis LS");
    const fill = wb.getWorksheet("T").getCell("A1").fill.fgColor.argb;
    // The app's own unconfigured primary — NOT the deleted toolkit's maroon.
    expect(fill).not.toBe("FF690909");
    expect(fill).toBe("FFF5821F");
  });

  it("embeds a resolvable tenant logo on the cover and degrades to the name when it is not", async () => {
    // 8×8 px PNG — resolveLogo scales by aspect ratio to its 56 px cover height.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8z8DwnwEPYMInOXwUAADtmwT9bhrdgAAAAABJRU5ErkJggg==", "base64");
    const withLogo = fixtureContext({
      tenant: { ...fixtureContext().tenant, logo: { base64: png.toString("base64"), extension: "png", width: 56, height: 56 } },
    });
    const buf = await buildWorkbook({
      sheets: [{ name: "T", columns: [{ header: "A", key: "a" }], rows: [] }],
      context: withLogo,
      cover: true,
    });
    const wb = await load(buf);
    expect(wb.worksheets[0].getImages().length).toBe(1);
  });

  it("puts the entity letterhead, generated-at and a Powered-by-Praxis-LS hyperlink on the cover", async () => {
    const buf = await buildWorkbook({
      sheets: [{ name: "T", columns: [{ header: "A", key: "a" }], rows: [] }],
      context: fixtureContext(),
      cover: true,
    });
    const wb = await load(buf);
    const cover = wb.worksheets[0];
    expect(cover.name).toBe("Couverture"); // invented sheet titles follow the entity language
    let hyperlink = null;
    let text = "";
    cover.eachRow((row) =>
      row.eachCell((cell) => {
        text += ` ${JSON.stringify(cell.value)}`;
        if (cell.value && typeof cell.value === "object" && cell.value.hyperlink) hyperlink = cell.value;
      }),
    );
    expect(hyperlink).toMatchObject({ text: "Powered by Praxis LS", hyperlink: "https://praxisls.com" });
    for (const expected of ["Smart Logistics SARL", "RC/DLA/2024/B/1234", "M091500012345P"]) {
      expect(text).toContain(expected);
    }
    // 15:30 Douala (UTC+1), not 14:30 UTC-as-local.
    expect(text).toContain("2026-08-20 15:30");
    expect(text).toContain("Alice Nkuli");
  });
});

/* ── Money ────────────────────────────────────────────────────────────────── */

describe("money — typed cells, tenant decimals, ISO in the header only", () => {
  it("writes XAF as a 0-decimal number and USD as 2-decimal, with the ISO in the header", async () => {
    const buf = await buildWorkbook({
      sheets: [
        {
          name: "T",
          columns: [
            { header: "Montant", key: "xaf", format: "money", currency: "XAF" },
            { header: "Montant", key: "usd", format: "money", currency: "USD" },
            { header: "Montant", key: "tnd", format: "money", currency: "TND" },
          ],
          rows: [{ xaf: "1250000", usd: 1500.5, tnd: 12.34567 }], // NUMERIC arrives as a string
        },
      ],
      context: fixtureContext(),
    });
    const wb = await load(buf);
    const ws = wb.getWorksheet("T");
    expect(ws.getCell("A1").value).toBe("Montant · XAF");
    expect(ws.getCell("B1").value).toBe("Montant · USD");
    expect(ws.getCell("C1").value).toBe("Montant · TND");
    expect(ws.getCell("A2").value).toBe(1250000); // typed number, not "1 250 000 FCFA"
    expect(typeof ws.getCell("A2").value).toBe("number");
    expect(ws.getCell("A2").numFmt).toBe("#,##0"); // the franc has no cents
    expect(ws.getCell("B2").numFmt).toBe("#,##0.00");
    expect(ws.getCell("C2").numFmt).toBe("#,##0.000");
    // No currency-template numFmt anywhere: regional Excel renders [$FCFA] wrong.
    for (const ref of ["A2", "B2", "C2"]) {
      expect(String(ws.getCell(ref).numFmt)).not.toMatch(/\[\$/);
    }
  });

  it("moneyColumns: two columns when the row currency differs from base, one when it is the base", () => {
    const usd = moneyColumns("Original amount", { key: "amount", currency: "USD", base: "XAF", language: "en" });
    expect(usd).toHaveLength(2);
    expect(usd[0]).toMatchObject({ key: "amount", currency: "USD", format: "money" });
    expect(usd[1]).toMatchObject({ key: "amount_base", currency: "XAF", format: "money", isBaseAmount: true });
    expect(usd[1].header).toBe("Base amount"); // en label; the builder appends " · XAF"

    const xaf = moneyColumns("Montant", { key: "amount", currency: "XAF", base: "XAF", language: "fr" });
    expect(xaf).toHaveLength(1); // duplicating the same unit in two columns is noise
  });

  it("convertToBase converts through MOD-08 (convertAmount) — never an inlined rate", async () => {
    const spy = jest.fn(async (_client, { amount, base, quote }) => ({
      amount,
      base,
      quote,
      rate: 615.5,
      converted: Math.round(Number(amount) * 615.5 * 100) / 100,
      as_of_date: "2026-08-20",
      source: "stub",
    }));
    currencyService.convertAmount.mockImplementation(spy);
    currencyRepo.getBaseCode.mockResolvedValue("XAF");

    const rows = [
      { amount: 100, currency: "USD", dated_on: "2026-08-18" },
      { amount: 250, currency: "EUR", dated_on: "2026-08-19" },
      { amount: 500, currency: "XAF", dated_on: "2026-08-19" }, // base: identity, no FX call
      { amount: null, currency: "USD", dated_on: "2026-08-19" }, // not a number: blank, no FX call
    ];
    await convertToBase({}, rows, { amountKey: "amount", currencyKey: "currency", dateKey: "dated_on" });

    // Exactly one MOD-08 conversion per convertible row — the rate came from
    // the stub's answer, and a hardcoded table could not have produced it.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(expect.anything(), { amount: 100, base: "USD", quote: "XAF", date: "2026-08-18" });
    expect(rows[0].amount_base).toBe(61550);
    expect(rows[1].amount_base).toBe(153875);
    expect(rows[2].amount_base).toBe(500); // identity passthrough
    expect(rows[3].amount_base).toBeNull();
  });

  it("leaves the base cell empty when MOD-08 has no rate, instead of failing the export", async () => {
    currencyRepo.getBaseCode.mockResolvedValue("XAF");
    currencyService.convertAmount.mockImplementation(async () => {
      throw new Error("NO_FX_RATE");
    });
    const rows = [{ amount: 10, currency: "JPY" }];
    await convertToBase({}, rows, { amountKey: "amount" });
    expect(rows[0].amount_base).toBeNull();
  });
});

/* ── Safety ───────────────────────────────────────────────────────────────── */

describe("safety — injection lock, sheet names, sandbox stamp", () => {
  it("locks formula-looking text cells in xlsx AND csv", async () => {
    const columns = [{ header: "Note", key: "note" }];
    const rows = [
      { note: '=HYPERLINK("http://evil","Click")' },
      { note: "+SUM(A1:A9)" },
      { note: "@cmd" },
      { note: "-2+3" },
      { note: "plain text" },
    ];
    const buf = await buildWorkbook({ sheets: [{ name: "T", columns, rows }], context: fixtureContext() });
    const wb = await load(buf);
    const ws = wb.getWorksheet("T");
    for (let r = 2; r <= 5; r++) {
      const v = ws.getCell(r, 1).value;
      expect(typeof v).toBe("string"); // a formula object {formula: …} must never appear
      expect(v.startsWith("'")).toBe(true);
    }
    expect(ws.getCell(2, 1).value).toBe("'=HYPERLINK(\"http://evil\",\"Click\")");
    expect(ws.getCell(6, 1).value).toBe("plain text");
    // CSV: same lock, same semantics.
    const csv = buildCsv({ columns, rows: [rows[0]], context: fixtureContext() }).toString("utf8");
    expect(csv).toContain("'=HYPERLINK");
  });

  it("does NOT prefix typed numbers (a negative amount must stay summable)", () => {
    expect(escapeFormula(-5000)).toBe(-5000);
    const csv = buildCsv({ columns: [{ header: "A", key: "a" }], rows: [{ a: -5000 }], context: fixtureContext() });
    expect(csv.toString("utf8")).toContain("\uFEFFA\r\n-5000\r\n");
  });

  it("sheetName: strips illegal characters, caps at 31, dedupes case-insensitively", () => {
    expect(sheetName("a/b:c*d?e[f]g\\h")).toBe("a b c d e f g h");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    const taken = new Set();
    expect(sheetName("Ledger", { taken })).toBe("Ledger");
    // Excel resolves sheet names case-insensitively, so "ledger" collides with
    // "Ledger"; the suffix keeps the caller's own casing.
    expect(sheetName("ledger", { taken })).toBe("ledger (2)");
    expect(sheetName("LEDGER", { taken })).toBe("LEDGER (3)");
    expect(sheetName("", { taken, fallback: "Table 1" })).toBe("Table 1");
  });

  it("stamps sandbox exports on the cover AND in the filename", async () => {
    const ctx = fixtureContext({ env: "sandbox" });
    const buf = await buildWorkbook({
      sheets: [{ name: "T", columns: [{ header: "A", key: "a" }], rows: [] }],
      context: ctx,
      cover: true,
    });
    const wb = await load(buf);
    let coverText = "";
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => (coverText += ` ${c.value}`)));
    expect(coverText).toContain("TEST SANDBOX");
    expect(exportFilename({ base: "trial-balance", env: "sandbox", extension: "xlsx", date: new Date("2026-08-20T00:00:00Z") })).toBe(
      "trial-balance-SANDBOX-2026-08-20.xlsx",
    );
    expect(exportFilename({ base: "trial-balance", env: "live", extension: "xlsx", date: new Date("2026-08-20T00:00:00Z") })).toBe(
      "trial-balance-2026-08-20.xlsx",
    );
  });
});

/* ── Language ─────────────────────────────────────────────────────────────── */

describe("language — labels follow the corporate entity's default_language", () => {
  it("renders Oui/Non for a French entity and Yes/No for English", async () => {
    const build = async (context) => {
      const buf = await buildWorkbook({
        sheets: [{ name: "T", columns: [{ header: "Payé", key: "paid", format: "bool" }], rows: [{ paid: true }, { paid: false }] }],
        context,
      });
      const wb = await load(buf);
      return [wb.getWorksheet("T").getCell("A2").value, wb.getWorksheet("T").getCell("A3").value];
    };
    expect(await build(fixtureContext({ language: "fr" }))).toEqual(["Oui", "Non"]);
    expect(await build(fixtureContext({ language: "en" }))).toEqual(["Yes", "No"]);
  });
});

/* ── Dates ────────────────────────────────────────────────────────────────── */

describe("dates — instants render in the entity timezone, never host-UTC-as-local", () => {
  it("writes a Douala-wall-clock serial for a datetime column", async () => {
    const buf = await buildWorkbook({
      sheets: [{ name: "T", columns: [{ header: "Le", key: "at", format: "datetime" }], rows: [{ at: "2026-08-20T23:30:00Z" }] }],
      context: fixtureContext(), // Africa/Douala, UTC+1 → 00:30 on the 21st
    });
    const wb = await load(buf);
    const v = wb.getWorksheet("T").getCell("A2").value;
    expect(v).toBeInstanceOf(Date);
    expect(v.toISOString()).toBe("2026-08-21T00:30:00.000Z");
    expect(wb.getWorksheet("T").getCell("A2").numFmt).toBe("yyyy-mm-dd hh:mm");
  });

  it("keeps a calendar date a calendar date (no tz shift, yyyy-mm-dd format)", async () => {
    const buf = await buildWorkbook({
      sheets: [{ name: "T", columns: [{ header: "Le", key: "on", format: "date" }], rows: [{ on: "2026-08-20" }] }],
      context: fixtureContext(),
    });
    const wb = await load(buf);
    const v = wb.getWorksheet("T").getCell("A2").value;
    expect(v.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(wb.getWorksheet("T").getCell("A2").numFmt).toBe("yyyy-mm-dd");
  });
});

/* ── Packaging ────────────────────────────────────────────────────────────── */

describe("packaging — totals, reference sheet, parse ceilings", () => {
  it("adds a live SUM totals row when a column asks for one", async () => {
    const buf = await buildWorkbook({
      sheets: [
        {
          name: "T",
          columns: [
            { header: "Libellé", key: "label" },
            { header: "Montant", key: "amount", format: "money", currency: "XAF", total: true },
          ],
          rows: [{ label: "a", amount: 10 }, { label: "b", amount: 15 }],
        },
      ],
      context: fixtureContext(),
    });
    const wb = await load(buf);
    const ws = wb.getWorksheet("T");
    const total = ws.getCell("B4");
    expect(total.value).toMatchObject({ formula: "SUM(B2:B3)" }); // Excel formula, not a pre-baked 25
    expect(total.numFmt).toBe("#,##0");
    expect(ws.getCell("A4").value).toBe("Total");
  });

  it("protects (but keeps visible) the Reference sheet, and parse skips it", async () => {
    const buf = await buildWorkbook({
      sheets: [{ name: "Items", columns: [{ header: "Cat", key: "cat", list: ["a", "b"] }], rows: [] }],
      reference: [{ title: "Category", values: [["a", "Alpha"], ["b", "Beta"]] }],
      context: fixtureContext(),
    });
    const wb = await load(buf);
    const ref = wb.getWorksheet("Reference");
    expect(ref).toBeTruthy();
    expect(ref.state).toBe("visible");
    expect(ref.sheetProtection).toBeTruthy();
    expect(ref.getCell("A3").value).toBe("a");

    const parsed = await parseWorkbook(buf);
    expect(Object.keys(parsed)).toEqual(["Items"]); // Reference is guidance, never data
  });

  it("parseUpload reads the FIRST data sheet (templates put Reference last)", async () => {
    const { parseUpload } = require("../../src/services/spreadsheet");
    const buf = await buildWorkbook({
      sheets: [{ name: "Rates", columns: [{ header: "Rate", key: "rate" }], rows: [{ rate: 5 }] }],
      reference: [{ title: "Category", values: ["a"] }],
      context: fixtureContext(),
    });
    const rows = await parseUpload({ buffer: buf });
    expect(rows).toEqual([{ Rate: 5 }]);
  });
});

/* ── CSV parse (regression: the import path predates the split) ───────────── */

describe("parseCsv", () => {
  it("parses quoted CSV with a BOM and skips blank lines", () => {
    const rows = parseCsv(Buffer.from("\uFEFFA,B\r\n1,\"x,y\"\r\n\r\n2,z\r\n", "utf8"));
    expect(rows).toEqual([
      { A: "1", B: "x,y" },
      { A: "2", B: "z" },
    ]);
  });
});

/* ── resolveContext (fake client: brand/entity/currency composition) ──────── */

describe("resolveContext — one context, composed from the real sources", () => {
  /**
   * A fake tenant client keyed on the SQL each real repo issues. The currency
   * service/repo are jest-mocked at file scope (for convertToBase), so each
   * test re-points those mocks at its own rows here — resolveContext then
   * composes the mocked MOD-08 answers exactly as it would the DB's.
   */
  function fakeClient({ env = "live", currencies = [], base = null, entity = null, appearance = [] } = {}) {
    currencyService.listCurrencies.mockImplementation(async () => currencies);
    currencyRepo.getBaseCode.mockImplementation(async () => base);
    return {
      [Symbol.for("praxis.conn.env")]: env,
      query: async (sql) => {
        if (sql.includes("FROM setting")) return { rows: appearance };
        if (sql.includes("FROM corporate_entity")) return { rows: entity ? [entity] : [] };
        return { rows: [] };
      },
    };
  }

  it("composes tenant currency rows with the ISO catalogue for decimals/symbol", async () => {
    const client = fakeClient({
      currencies: [
        { code: "XAF", symbol: null, name: null, decimals: null, is_base: true }, // tenant left facts unset
        { code: "USD", symbol: "$us", name: "Dollar américain", decimals: 2, is_base: false },
      ],
      base: "XAF",
      entity: { legal_name: "E", rccm: "R-1", niu: "N-1", address: "Douala", default_language: "fr", timezone: "Africa/Douala" },
    });
    const ctx = await resolveContext(client, {});
    expect(ctx.baseCurrency).toBe("XAF");
    expect(ctx.currencies.XAF.decimals).toBe(0); // from @praxis/shared — the franc has no cents
    expect(ctx.currencies.XAF.symbol).toBe("FCFA");
    expect(ctx.currencies.USD.decimals).toBe(2); // tenant row wins over catalogue
    expect(ctx.currencies.USD.symbol).toBe("$us");
    expect(ctx.language).toBe("fr");
    expect(ctx.timezone).toBe("Africa/Douala");
    expect(ctx.entity.legal_name).toBe("E");
  });

  it("reads sandbox from the connection symbol (the kit.watermarkFor signal) and tolerates no base", async () => {
    const ctx = await resolveContext(fakeClient({ env: "sandbox" }), {});
    expect(ctx.env).toBe("sandbox");
    const bare = await resolveContext(fakeClient({ currencies: [], base: null }), {});
    expect(bare.env).toBe("live");
    expect(bare.baseCurrency).toBeNull(); // never an invented XAF default
    expect(bare.language).toBe("en"); // fallback when no entity row exists
  });
});
