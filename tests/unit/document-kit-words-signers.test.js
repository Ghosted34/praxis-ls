"use strict";

/**
 * The document kit's amount-in-words and signatory blocks.
 *
 * WHY THE WORDS TESTS ARE BYTE-LEVEL. The amount in words goes on the PO,
 * supplier invoice and invoice family — OHADA commercial documents a client and
 * a bank both read. A currency with no subdivision (XAF, `currency.decimals = 0`)
 * must NOT print a "/100" fraction, and French hundreds must follow the
 * cent/cents rule ("deux cents", "deux cent trois", "deux cent mille"). The
 * legacy (`print-po.php` `numberToWords`) was English-only and always appended
 * "AND 00 CENTS", which is wrong for XAF.
 *
 * WHY THE SIGNER TESTS EXIST. `signerBlock` replaced the one static
 * `cfg.signature.name` with per-document actors (issuer/approver/validated_by/
 * received_by). An empty sign-off must still print its ruled line so the paper
 * stays hand-fillable, and the block must honour the beautify signature toggle.
 */

const k = require("../../src/services/documents/templates/kit");

describe("amount in words", () => {
  test("zero-decimal currency omits the /100 fraction", () => {
    expect(k.words(1233900, "en", 0)).toBe(
      "ONE MILLION TWO HUNDRED THIRTY-THREE THOUSAND NINE HUNDRED",
    );
    expect(k.words(1233900, "fr", 0)).toBe(
      "UN MILLION DEUX CENT TRENTE-TROIS MILLE NEUF CENTS",
    );
    // No " AND 00/100" or " ET 00/100" tail.
    expect(k.words(1233900, "en", 0)).not.toMatch(/\/100/);
    expect(k.words(1233900, "fr", 0)).not.toMatch(/\/100/);
  });

  test("two-decimal currency keeps the /100 fraction", () => {
    expect(k.words(1234.56, "en", 2)).toBe("ONE THOUSAND TWO HUNDRED THIRTY-FOUR AND 56/100");
    expect(k.words(1234.5, "fr", 2)).toBe("MILLE DEUX CENT TRENTE-QUATRE ET 50/100");
  });

  test("defaults to two decimals (backward compatible)", () => {
    expect(k.words(100, "en")).toBe("ONE HUNDRED AND 00/100");
  });

  test("French hundreds follow the cent/cents rule", () => {
    expect(k.words(200, "fr", 0)).toBe("DEUX CENTS");
    expect(k.words(233, "fr", 0)).toBe("DEUX CENT TRENTE-TROIS");
    expect(k.words(101, "fr", 0)).toBe("CENT UN");
    expect(k.words(900000, "fr", 0)).toBe("NEUF CENT MILLE");
    expect(k.words(200200, "fr", 0)).toBe("DEUX CENT MILLE DEUX CENTS");
  });
});

describe("money symbol + decimals from cfg.currencies", () => {
  const cfg = { currencies: { XAF: { symbol: "FCFA", decimals: 0 }, USD: { symbol: "$", decimals: 2 } } };

  test("renders the currency symbol when a catalogue is present", () => {
    expect(k.money(1233900, "XAF", cfg)).toContain("FCFA");
    expect(k.money(1234.56, "USD", cfg)).toContain("$");
    expect(k.money(1234.56, "USD", cfg)).not.toContain("USD");
  });

  test("honours the currency's decimals (0 for XAF, 2 for USD)", () => {
    // fr-FR groups with a narrow no-break space (U+202F); assert the shape, not
    // the exact separator byte.
    expect(k.money(1234.5, "XAF", cfg)).toMatch(/1[ \u202f]235 FCFA$/); // 0 decimals → rounded to integer
    expect(k.money(1234.56, "USD", cfg)).toMatch(/1[ \u202f]234,56 \$$/);
    expect(k.money(1234.5, "XAF", cfg)).not.toMatch(/\./); // no ".50" fraction for XAF
  });

  test("falls back to the code when no catalogue is passed", () => {
    expect(k.money(1234.56, "USD")).toContain("USD");
  });
});

describe("signerBlock", () => {
  const cfg = { show: { signature: true }, language: "bilingual" };

  test("renders a labelled slot per signer with name · title", () => {
    const html = k.signerBlock(
      [
        { label: { fr: "Validé par", en: "Validated by" }, name: "Alice Ngo", title: "Directrice" },
        { label: { fr: "Approuvé par", en: "Approved by" }, name: "Paul Biya" },
      ],
      cfg,
    );
    expect(html).toContain("Validé par / Validated by");
    expect(html).toContain("Alice Ngo · Directrice");
    expect(html).toContain("Approuvé par / Approved by");
    expect(html).toContain("Paul Biya");
  });

  test("a signer with no name still prints its ruled line (hand-fillable)", () => {
    const html = k.signerBlock([{ label: { fr: "Reçu par", en: "Received by" }, name: null }], cfg);
    expect(html).toContain("Reçu par / Received by");
    expect(html).toContain('class="ln">');
  });

  test("honours the signature beautify toggle", () => {
    expect(k.signerBlock([{ label: "X", name: "Y" }], { show: { signature: false } })).toBe("");
  });

  test("empty signer list renders nothing", () => {
    expect(k.signerBlock([], cfg)).toBe("");
  });
});
