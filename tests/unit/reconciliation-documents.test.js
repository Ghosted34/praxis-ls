/**
 * The two signed control documents, and the scanned-statement reader.
 *
 * All three exist because a reconciliation is not finished when the screen goes
 * green — it is finished when there is a document an auditor can hold, and a
 * record of where its figures came from.
 */
"use strict";

const zlib = require("zlib");
const templates = require("../../src/services/pdf.templates");
const ocr = require("../../src/services/statements/pdf-ocr");
const statements = require("../../src/services/statements");
const { assertDocType } = require("../../src/modules/vault/document_vault/document_vault.types");

describe("doc-type registry", () => {
  it("knows both control documents, so neither is captured under a typo", () => {
    expect(assertDocType("BANK_RECONCILIATION")).toBe("BANK_RECONCILIATION");
    expect(assertDocType("CASH_COUNT_SHEET")).toBe("CASH_COUNT_SHEET");
  });
});

describe("état de rapprochement", () => {
  const base = {
    doc_number: "RAP-2026-0001",
    entity: "JBS Praxis",
    account: "Afriland Main (521101)",
    period: "2026-04-01 → 2026-04-30",
    currency: "XAF",
    balances: {
      ledger_balance: 1000000, deposits_in_transit: 200000, outstanding_payments: 50000,
      unrecorded_credits: 0, unrecorded_debits: 0,
      statement_balance: 1150000, unexplained_difference: 0,
    },
    outstanding: {
      deposits_in_transit: [{ date: "2026-04-28", label: "Dépôt chèque 445120", amount: 200000 }],
      outstanding_payments: [{ date: "2026-04-29", label: "Chèque 445121", amount: 50000 }],
    },
  };

  it("walks from the ledger balance to the statement balance", () => {
    const html = templates.buildReconciliationHtml({ ...base, status: "APPROVED_LOCKED" });
    expect(html).toMatch(/Balance per our ledger/);
    expect(html).toMatch(/Balance per the statement/);
    expect(html).toMatch(/Unexplained difference/);
  });

  it("itemises the outstanding items under the subtotal they roll into", () => {
    const html = templates.buildReconciliationHtml({ ...base, status: "APPROVED_LOCKED" });
    expect(html).toMatch(/Dépôt chèque 445120/);
    expect(html).toMatch(/Chèque 445121/);
  });

  /**
   * The distinction the whole document depends on: a working paper that looks
   * like a signed one is a problem in an audit file.
   */
  it("bands an unapproved reconciliation as DRAFT and withholds the signature block", () => {
    const html = templates.buildReconciliationHtml({ ...base, status: "DRAFT" });
    expect(html).toMatch(/BROUILLON \/ DRAFT/);
    expect(html).not.toMatch(/Approuvé par/);
  });

  it("signs an approved one and drops the DRAFT band", () => {
    const html = templates.buildReconciliationHtml({
      ...base, status: "APPROVED_LOCKED", prepared_by: "A. Treasurer", approved_by: "B. CEO",
    });
    expect(html).not.toMatch(/BROUILLON/);
    expect(html).toMatch(/A\. Treasurer/);
    expect(html).toMatch(/B\. CEO/);
  });

  it("marks a non-zero difference rather than letting it read as ordinary", () => {
    const html = templates.buildReconciliationHtml({
      ...base, status: "DRAFT", balances: { ...base.balances, unexplained_difference: 1500 },
    });
    expect(html).toMatch(/tot bad/);
  });

  it("escapes text that came from a bank narrative", () => {
    const html = templates.buildReconciliationHtml({
      ...base, status: "DRAFT",
      outstanding: { deposits_in_transit: [{ date: "2026-04-28", label: "<script>alert(1)</script>", amount: 1 }] },
    });
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });
});

describe("cash count sheet", () => {
  const sheet = {
    doc_number: "PVC-2026-0001", entity: "JBS Praxis", account: "Petty cash — Douala",
    counted_on: "2026-05-02", currency: "XAF",
    denominations: [{ note: 10000, qty: 14 }, { note: 5000, qty: 3 }, { note: 500, qty: 0 }],
    counted_total: 155000, ledger_balance: 155000, difference: 0,
    custodian: "C. Custodian", witness: "D. Witness", attested_at: "2026-05-02",
  };

  /** A total is an assertion; a breakdown is what makes a recount possible. */
  it("prints the denomination breakdown, not just the total", () => {
    const html = templates.buildCashCountHtml(sheet);
    expect(html).toMatch(/× 14/);
    expect(html).toMatch(/× 3/);
  });

  it("omits denominations that were not present", () => {
    expect(templates.buildCashCountHtml(sheet)).not.toMatch(/× 0/);
  });

  it("names both the custodian and the witness", () => {
    const html = templates.buildCashCountHtml(sheet);
    expect(html).toMatch(/C\. Custodian/);
    expect(html).toMatch(/D\. Witness/);
  });

  it("prints the variance explanation only when there is a variance", () => {
    expect(templates.buildCashCountHtml(sheet)).not.toMatch(/Variance explanation/);
    const short = templates.buildCashCountHtml({
      ...sheet, counted_total: 150000, difference: -5000, variance_reason: "advance to the driver",
    });
    expect(short).toMatch(/Variance explanation/);
    expect(short).toMatch(/advance to the driver/);
  });
});

/** Build a PDF-shaped buffer carrying one embedded image stream. */
function pdfWithImage(dict, payload) {
  return Buffer.concat([
    Buffer.from("%PDF-1.7\n1 0 obj\n"),
    Buffer.from(`<< /Type /XObject /Subtype /Image ${dict} >>\nstream\n`),
    payload,
    Buffer.from("\nendstream\nendobj\n%%EOF"),
  ]);
}

describe("scanned statements", () => {
  it("lifts a JPEG page image straight out of the container — no rasteriser needed", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const { images, undecodable } = ocr.extractImages(pdfWithImage("/Filter /DCTDecode", jpeg));
    expect(images).toHaveLength(1);
    expect(images[0].mimeType).toBe("image/jpeg");
    expect(undecodable).toEqual([]);
  });

  it("ignores content streams — only image XObjects are page pictures", () => {
    const content = Buffer.concat([
      Buffer.from("%PDF-1.7\n<< /Filter /FlateDecode /Length 10 >>\nstream\n"),
      zlib.deflateSync(Buffer.from("BT (x) Tj ET")),
      Buffer.from("\nendstream\n%%EOF"),
    ]);
    expect(ocr.extractImages(content).images).toHaveLength(0);
  });

  /**
   * A bitonal fax encoding genuinely cannot be opened without a decoder. Saying
   * which one, and what to do instead, is worth more than a generic failure.
   */
  it("names a fax-encoded scan it cannot open, with the way out", async () => {
    const buf = pdfWithImage("/Filter /CCITTFaxDecode", Buffer.from([0, 1, 2, 3]));
    await expect(ocr.parse(buf)).rejects.toMatchObject({
      code: "SCAN_ENCODING_UNSUPPORTED",
      status: 422,
    });
    await expect(ocr.parse(buf)).rejects.toThrow(/CCITT/);
  });

  it("reads page images through the vision service and returns canonical rows", async () => {
    const vision = {
      extract: jest.fn().mockResolvedValue({
        provider: "gemini",
        fields: {
          opening_balance: 1000000,
          closing_balance: 1245000,
          currency: "XAF",
          rows: [
            { booking_date: "2026-04-03", description: "VIR RECU DUPONT SARL", amount: 250000, fee: 0, running_balance: 1250000, external_ref: "FT26094XYZ12" },
            { booking_date: "2026-04-05", description: "FRAIS TENUE DE COMPTE", amount: -5000, fee: 0, running_balance: 1245000, external_ref: null },
          ],
        },
      }),
    };
    const out = await ocr.parse(pdfWithImage("/Filter /DCTDecode", Buffer.from([0xff, 0xd8, 1])), { vision });

    expect(vision.extract).toHaveBeenCalledTimes(1);
    expect(out.meta.canonical).toBe(true);
    expect(out.meta.ocr).toMatchObject({ used: true, provider: "gemini", pages: 1, pages_read: 1 });
    expect(out.rows.map((r) => r.amount)).toEqual([250000, -5000]);
    expect(out.rows[0].external_ref).toBe("FT26094XYZ12");
  });

  /**
   * The reason an imperfect reader is safe to offer: the same arithmetic that
   * checks every other source checks this one, and a bad read stops footing.
   */
  it("produces rows the footing check can verify, and fails one that was misread", () => {
    const rules = require("../../src/modules/master/reconciliation/reconciliation.rules");
    const good = [{ amount: 250000 }, { amount: -5000 }];
    expect(rules.checkFooting({ openingBalance: 1000000, closingBalance: 1245000, lines: good }).foots).toBe(true);

    const misread = [{ amount: 250000 }, { amount: -500 }];   // a lost zero
    expect(rules.checkFooting({ openingBalance: 1000000, closingBalance: 1245000, lines: misread }).foots).toBe(false);
  });

  it("says so plainly when a page opened but nothing could be read from it", async () => {
    const vision = { extract: jest.fn().mockResolvedValue({ provider: "gemini", fields: { rows: [] } }) };
    await expect(ocr.parse(pdfWithImage("/Filter /DCTDecode", Buffer.from([0xff, 0xd8, 1])), { vision }))
      .rejects.toMatchObject({ code: "SCAN_UNREADABLE" });
  });

  it("rescues a locale-formatted figure without re-implementing the number rules", () => {
    expect(ocr.toNumber(1234.5)).toBe(1234.5);
    expect(ocr.toNumber("1234,50")).toBe(1234.5);
    expect(ocr.toNumber("1,234.50")).toBe(1234.5);
    expect(ocr.toNumber("")).toBeNull();
    expect(ocr.toNumber(null)).toBeNull();
  });

  it("lets a caller ask whether a PDF is readable without spending a vision call", async () => {
    const scan = pdfWithImage("/Filter /DCTDecode", Buffer.from([0xff, 0xd8, 1]));
    await expect(statements.parse(scan, { filename: "s.pdf", allowOcr: false }))
      .rejects.toMatchObject({ code: "SCANNED_PDF" });
  });
});
