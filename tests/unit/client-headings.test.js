"use strict";
/**
 * PR 2 (tenant review "meeting 5") — quotations and invoices print one line per
 * client heading × nature, while storing and signing the detailed lines.
 */
const { groupLines, resolveHeading } = require("../../src/services/documents/templates/client-headings");
const TPL = require("../../src/services/documents/templates/registry");

const CUSTOMS = { client_heading_code: "CUSTOMS_FORMALITIES", client_heading_fr: "Formalités Douanières", client_heading_en: "Customs Formalities", client_heading_sort: 10 };
const PORT = { client_heading_code: "PORT_TERMINAL", client_heading_fr: "Frais Portuaires et de Terminal", client_heading_en: "Port & Terminal Charges", client_heading_sort: 40 };
const REGISTRY = [
  { code: "CUSTOMS_FORMALITIES", fr: "Formalités Douanières", en: "Customs Formalities", sort: 10 },
  { code: "PORT_TERMINAL", fr: "Frais Portuaires et de Terminal", en: "Port & Terminal Charges", sort: 40 },
];
const line = (label, amount, patch) => ({ label, qty: 1, unit: amount, amount, tax: patch.is_disbursement ? null : 19.25, ...patch });

// The meeting's own example: Customs Formalities is six costing lines.
const DETAIL = [
  line("Customs duties", 300000, { is_disbursement: true, ...CUSTOMS }),
  line("Declaration fee", 20000, { is_disbursement: true, ...CUSTOMS }),
  line("Clearance fee", 150000, { is_disbursement: false, ...CUSTOMS }),
  line("Officer transport to customs", 20000, { is_disbursement: false, ...CUSTOMS }),
  line("Gate pass", 5000, { is_disbursement: true, ...CUSTOMS }),
  line("Scanner", 5000, { is_disbursement: true, ...CUSTOMS }),
  line("THC", 300000, { is_disbursement: true, ...PORT }),
];

describe("groupLines — the printed client lines", () => {
  test("six customs lines become two: disbursements and our fee, never mixed", () => {
    const out = groupLines(DETAIL, "en", REGISTRY);
    expect(out.map((l) => [l.label, l.amount, l.tax])).toEqual([
      ["Customs Formalities — Disbursements", 330000, null],
      ["Customs Formalities — Service Fee", 170000, 19.25],
      ["Port & Terminal Charges", 300000, null],
    ]);
  });

  test("the grouped lines add up to exactly the detail", () => {
    const sum = (ls) => ls.reduce((a, l) => a + l.amount, 0);
    expect(sum(groupLines(DETAIL, "en", REGISTRY))).toBe(sum(DETAIL));
  });

  test("French headings and suffixes in a French document; both in a bilingual one", () => {
    expect(groupLines(DETAIL, "fr", REGISTRY)[0].label).toBe("Formalités Douanières — Débours");
    expect(groupLines(DETAIL, "bilingual", REGISTRY)[1].label).toBe("Formalités Douanières / Customs Formalities — Honoraires / Service Fee");
  });

  test("a family made up for this file groups its lines under its own text", () => {
    const out = groupLines([
      line("Leg 1", 1000, { is_disbursement: true, client_heading: "DAP Douala–Bangui" }),
      line("Leg 2", 2000, { is_disbursement: true, client_heading: "dap douala–bangui" }),
    ], "en", REGISTRY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: "DAP Douala–Bangui", amount: 3000 });
  });

  test("an override naming a registry heading — by code or name — IS that heading, bilingual", () => {
    const moved = line("Stevedoring", 1000, { is_disbursement: true, client_heading: "PORT_TERMINAL", ...CUSTOMS });
    expect(resolveHeading(moved, REGISTRY)).toMatchObject({ key: "PORT_TERMINAL", fr: "Frais Portuaires et de Terminal" });
    expect(resolveHeading({ client_heading: "port & terminal charges" }, REGISTRY).key).toBe("PORT_TERMINAL");
  });

  test("a line with no heading prints under Other Charges, last", () => {
    const out = groupLines([line("Misc", 10, { is_disbursement: false }), ...DETAIL], "en", REGISTRY);
    expect(out[out.length - 1]).toMatchObject({ label: "Other Charges", amount: 10 });
  });
});

describe("the printed quotation and invoice are grouped; their data is not", () => {
  const cfg = { language: "en", show: {} };
  const entity = { legal_name: "Tenant SARL", address: "Douala", niu: "M0" };
  const html = (docType) =>
    TPL.TEMPLATES[docType].build({ number: "Q-1", date: "2026-09-27", lines: DETAIL, client_headings: REGISTRY, totals: { service_ht: 170000, disbursement_total: 630000, vat_total: 32725, total_ttc: 832725 }, currency: "XAF" }, cfg, entity, null);

  test.each(["QUOTATION", "FINAL_INVOICE"])("%s prints families, not the costing's lines", (docType) => {
    const out = html(docType);
    expect(out).toContain("Customs Formalities — Disbursements");
    expect(out).toContain("Customs Formalities — Service Fee");
    expect(out).not.toContain("Officer transport to customs");
    expect(out).not.toContain("Gate pass");
  });
});
