"use strict";

/**
 * The costing sheet, as the owner specified it on 28 Sep 2026 after
 * SBX-CST-2026-0001 printed six seals, two languages and a page and a half.
 *
 *   1. Never two languages on one sheet; English unless French is picked.
 *   2. Up to 17 lines on ONE page; above that 12 on page 1, the rest after it;
 *      a third page from 35 lines, balanced rather than orphaned.
 *   3. Three seals, one per step — never six.
 *   4. One line about pass-throughs, not one per line.
 *   5. A fuller client block, and the header's VALUES in bold.
 *   6. Each shipment fact once (the first render printed Carrier twice, and
 *      the arrival date a second time in ISO).
 *
 * The page COUNT is proven against real Chromium by
 * scripts/dev/measure-costing.js (CI has none). What is pinned here is the
 * split that script checks against, and everything a reader can see in the
 * HTML.
 */

const registry = require("../../src/services/documents/templates/registry");
const kit = require("../../src/services/documents/templates/kit");
const pages = require("../../src/services/documents/templates/costing-pages");
const doc = require("../../src/services/documents/templates/costing-document");
const fixture = require("../fixtures/costing-sheet.fixture");

jest.mock("../../src/config/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
const templateSvc = require("../../src/modules/documents/template/template.service");

const TPL = registry.get("COSTING");
const render = (n, language = "en", opts = {}) =>
  TPL.build(fixture.costing(n, { language, qrSvg: "<svg></svg>", ...opts }), kit.mergeCfg({}, { language }), fixture.ENTITY, null);
// The visible text, tags and the stylesheet stripped.
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the page split", () => {
  test.each([
    [1, [1]], [15, [15]], [17, [17]],
    [18, [12, 6]], [34, [12, 22]],
    [35, [12, 12, 11]], [40, [12, 14, 14]], [60, [12, 26, 22]],
  ])("%i lines → %j", (n, want) => {
    expect(pages.paginate(n)).toEqual(want);
  });

  test("every line lands on exactly one page, in order, for any count", () => {
    for (let n = 0; n <= 120; n += 1) {
      const split = pages.paginate(n);
      expect(split.reduce((a, b) => a + b, 0)).toBe(n);
      if (n > pages.ONE_PAGE_MAX) {
        expect(split[0]).toBe(pages.FIRST_PAGE);
        expect(split[split.length - 1]).toBeLessThanOrEqual(pages.LAST_PAGE_MAX);
        expect(split[split.length - 1]).toBeGreaterThan(1); // never one orphan line over the totals
      }
    }
  });

  test("17 lines render as one page; 18 as two, the table header repeated", () => {
    expect(render(17).match(/class="cst-pg"/g)).toHaveLength(1);
    const two = render(18);
    expect(two.match(/class="cst-pg"/g)).toHaveLength(2);
    expect(two.match(/<thead>/g)).toHaveLength(2);
    expect(text(two)).toContain("Page 2 / 2");
    // The totals and seals are on the LAST page only.
    expect(two.match(/class="cst-sum"/g)).toHaveLength(1);
    expect(two.match(/class="cst-seals"/g)).toHaveLength(1);
    expect(two.lastIndexOf("cst-sum")).toBeGreaterThan(two.lastIndexOf("cst-pg"));
  });

  test("a one-page sheet tightens past 12 lines, and never below readable", () => {
    const k = (n) => Number(/--k:([\d.]+)/.exec(render(n))[1]);
    expect(k(12)).toBe(1);
    expect(k(17)).toBeLessThan(1);
    expect(k(17)).toBeGreaterThanOrEqual(0.85);
    expect(k(18)).toBe(1); // paginated sheets print at full size
  });
});

describe("one language per sheet", () => {
  const FRENCH = ["Désignation", "Sous-total", "TVA", "débours", "Débours", "Transporteur", "Arrêtée", "Statut", "Approuvée", "Dédouanement"];
  const ENGLISH = ["Description", "Subtotal", "VAT", "disbursement", "Disbursement", "Carrier", "Amount in words", "Status", "Approved", "Customs Clearance"];

  test("English: no French word on the page", () => {
    const t = text(render(11, "en"));
    for (const w of FRENCH) expect(t).not.toContain(w);
    for (const w of ["Description", "Subtotal (excl. VAT)", "Total estimate (incl. VAT)", "Approved", "Customs Clearance"]) expect(t).toContain(w);
  });

  test("French: no English word on the page — descriptions included", () => {
    const t = text(render(11, "fr"));
    for (const w of ENGLISH) expect(t).not.toContain(w);
    // The Dictionary's French name, not the English copy the line was saved with.
    expect(t).toContain("Dédouanement");
    expect(t).toContain("Frais de manutention terminal (THC) — FT45HC");
  });

  test("a description somebody typed over the Dictionary name prints as typed", () => {
    const [name] = doc.lineName({ label: "Clearance, 2 boxes", label_i18n: { en: "Customs Clearance", fr: "Dédouanement" } }, "fr");
    expect(name).toBe("Clearance, 2 boxes");
  });

  test("no bilingual slash pairs anywhere", () => {
    expect(text(render(11, "en"))).not.toMatch(/Costing \/ Cotation|Cotation \/ Costing|Total estimé \(TTC\) \//);
  });

  test("a costing defaults to English even when the company's default is French; a pick still wins", () => {
    expect(templateSvc.resolveDocLanguage(null, {}, "fr", "COSTING")).toBe("en");
    expect(templateSvc.resolveDocLanguage(null, { language: "fr" }, "fr", "COSTING")).toBe("en");
    expect(templateSvc.resolveDocLanguage("fr", {}, "en", "COSTING")).toBe("fr");
    // Other documents keep the company's default.
    expect(templateSvc.resolveDocLanguage(null, {}, "fr", "INVOICE")).toBe("fr");
  });
});

describe("seals: three boxes, one per step", () => {
  test("six seals (the same three steps twice) still print three boxes", () => {
    const data = fixture.costing(5, { qrSvg: "<svg></svg>" });
    data.seals = data.seals.concat(data.seals.map((s) => ({ ...s, code: s.code + "X" })));
    const html = TPL.build(data, kit.mergeCfg({}, { language: "en" }), fixture.ENTITY, null);
    expect(html.match(/class="cst-sb"/g)).toHaveLength(3);
  });

  test("the boxes are in step order and name the step", () => {
    const t = text(render(5));
    expect(t.indexOf("Acknowledged")).toBeLessThan(t.indexOf("Reviewed and accepted"));
    expect(t.indexOf("Reviewed and accepted")).toBeLessThan(t.indexOf("Approved for dispatch"));
  });
});

describe("remarks: one line about pass-throughs", () => {
  test("nine débours lines, one remark line", () => {
    const t = text(render(11));
    expect(t.match(/\(PT\) Disbursements re-billed at cost/g)).toHaveLength(1);
    expect(t).not.toMatch(/\(PT\) #D/);
  });

  test("a sheet with no débours has no (PT) remark", () => {
    const data = fixture.costing(4, { qrSvg: "" });
    data.lines = data.lines.map((l) => ({ ...l, is_disbursement: false, tax: 19.25 }));
    const html = TPL.build(data, kit.mergeCfg({}, { language: "en" }), fixture.ENTITY, null);
    expect(text(html)).not.toContain("(PT) Disbursements");
  });
});

describe("the header", () => {
  test("date, file, status and currency: the values are bold, the labels are not", () => {
    const html = render(3);
    for (const v of ["03/09/2026", "SL3213P44RG55ZSM", "Approved", "XAF"]) {
      expect(html).toContain(`<div class="cst-mv">${v}</div>`);
    }
    expect(html).toContain('<div class="cst-mk">Status</div>');
  });

  test("the client block carries code, identifiers, address, PO box, phone, email and Attn", () => {
    const t = text(render(3));
    for (const v of ["CIMENCAM", "Code SLAS-CL-0004", "NIU M0100CL0004", "Zone Industrielle de Bonabéri, Douala, CM", "PO Box 1323", "+237 233 39 11 11", "logistics@cimencam.example", "Attn: Marie Ngo Bassa"]) {
      expect(t).toContain(v);
    }
  });
});

describe("the shipment facts, once each", () => {
  test("carrier, B/L, ETA and incoterm print once, and no date prints in ISO", () => {
    const facts = doc.shipmentFacts(fixture.costing(1), "en");
    const labels = facts.map(([l]) => (typeof l === "string" ? l : l.en));
    for (const l of ["Carrier", "B/L · AWB", "ETA", "Incoterm"]) {
      expect(labels.filter((x) => x === l)).toHaveLength(1);
    }
    expect(labels).not.toContain("Transport reference");
    expect(labels).not.toContain("Arrival");
    for (const [, v] of facts) expect(v).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(facts.find(([l]) => l.en === "ETA")[1]).toBe("21/09/2026");
  });

  test("a facet the file's columns do not cover still prints", () => {
    const labels = doc.shipmentFacts(fixture.costing(1), "en").map(([l]) => (typeof l === "string" ? l : l.en));
    expect(labels).toEqual(expect.arrayContaining(["Commodity", "Weight", "Customs regime", "Declaration"]));
  });
});
