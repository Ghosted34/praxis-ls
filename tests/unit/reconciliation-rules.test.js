/**
 * Reconciliation rules — the money decisions.
 *
 * These are the tests that matter most in the module, because every function
 * under test decides something about money and has to keep deciding it the same
 * way years later. A reconciliation signed off in 2026 must be reproducible in
 * 2028 in front of an auditor; that is only true if the ladder, the locale
 * handling and the row identity are pinned.
 */
"use strict";

const rules = require("../../src/modules/master/reconciliation/reconciliation.rules");

const FR = { decimalSeparator: ",", thousandsSeparator: " " };
const EN = { decimalSeparator: ".", thousandsSeparator: "," };

describe("header signatures", () => {
  it("ignores case, accents and spacing — a bank that drops accents has not changed layout", () => {
    expect(rules.headerSignature(["Date d'opération", "Libellé", "Débit"]))
      .toBe(rules.headerSignature(["DATE D OPERATION", "libelle", "  debit  "]));
  });

  it("is order-sensitive — Débit|Crédit is not Crédit|Débit", () => {
    expect(rules.headerSignature(["Débit", "Crédit"]))
      .not.toBe(rules.headerSignature(["Crédit", "Débit"]));
  });

  it("ignores trailing empty padding cells", () => {
    expect(rules.headerSignature(["Date", "Montant"]))
      .toBe(rules.headerSignature(["Date", "Montant", "", "  "]));
  });

  it("returns null for an empty header", () => {
    expect(rules.headerSignature([])).toBeNull();
    expect(rules.headerSignature(["", " "])).toBeNull();
  });
});

describe("parseAmount", () => {
  it("reads French locale grouping, including non-breaking spaces", () => {
    expect(rules.parseAmount("1 234 567,89", FR)).toBe(1234567.89);
    expect(rules.parseAmount("1 234 567,89", FR)).toBe(1234567.89);
    expect(rules.parseAmount("1 234,50", FR)).toBe(1234.5);
  });

  it("reads anglophone locale", () => {
    expect(rules.parseAmount("1,234,567.89", EN)).toBe(1234567.89);
  });

  it("understands all four ways a statement writes a negative", () => {
    expect(rules.parseAmount("-1 234,50", FR)).toBe(-1234.5);
    expect(rules.parseAmount("1 234,50-", FR)).toBe(-1234.5);
    expect(rules.parseAmount("(1 234,50)", FR)).toBe(-1234.5);
    expect(rules.parseAmount("+1 234,50", FR)).toBe(1234.5);
  });

  it("distinguishes 'no number here' from zero", () => {
    expect(rules.parseAmount("", FR)).toBeNull();
    expect(rules.parseAmount("-", FR)).toBeNull();
    expect(rules.parseAmount(null, FR)).toBeNull();
    expect(rules.parseAmount("n/a", FR)).toBeNull();
    expect(rules.parseAmount("0,00", FR)).toBe(0);
  });

  it("strips a currency code sitting in the amount cell", () => {
    expect(rules.parseAmount("XAF 20 000", FR)).toBe(20000);
    expect(rules.parseAmount("20 000 FCFA", FR)).toBe(20000);
  });

  it("passes through a value the source already typed as a number", () => {
    expect(rules.parseAmount(250000, FR)).toBe(250000);
    expect(rules.parseAmount(-4.5, FR)).toBe(-4.5);
  });
});

describe("detectNumberConvention", () => {
  it("is decisive when both separators appear — the last one is the decimal", () => {
    expect(rules.detectNumberConvention(["1.234.567,89"]).decimalSeparator).toBe(",");
    expect(rules.detectNumberConvention(["1,234,567.89"]).decimalSeparator).toBe(".");
  });

  it("reads a repeated separator as a thousands grouper", () => {
    expect(rules.detectNumberConvention(["1.234.567"]).decimalSeparator).toBe(",");
  });

  it("declares low confidence rather than guessing silently on integers only", () => {
    const r = rules.detectNumberConvention(["1000", "2000"]);
    expect(r.confidence).toBeLessThan(1);
    expect(r.decimalSeparator).toBe(",");
  });

  it("reports zero confidence when there is nothing to go on", () => {
    expect(rules.detectNumberConvention([]).confidence).toBe(0);
  });
});

describe("parseDate", () => {
  it("honours the declared order — the same string is two different days", () => {
    expect(rules.parseDate("03/04/2026", "DD/MM/YYYY")).toBe("2026-04-03");
    expect(rules.parseDate("03/04/2026", "MM/DD/YYYY")).toBe("2026-03-04");
  });

  it("accepts ISO and textual months regardless of the declared format", () => {
    expect(rules.parseDate("2026-04-03", "DD/MM/YYYY")).toBe("2026-04-03");
    expect(rules.parseDate("12 janv 2026", "MM/DD/YYYY")).toBe("2026-01-12");
    expect(rules.parseDate("12-Dec-2025", "DD/MM/YYYY")).toBe("2025-12-12");
  });

  it("rejects a date that does not exist", () => {
    expect(rules.parseDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(rules.parseDate("29/02/2027", "DD/MM/YYYY")).toBeNull();
    expect(rules.parseDate("29/02/2028", "DD/MM/YYYY")).toBe("2028-02-29");
  });

  it("takes a typed Date straight through", () => {
    expect(rules.parseDate(new Date(Date.UTC(2026, 3, 3)))).toBe("2026-04-03");
  });
});

describe("detectDateFormat", () => {
  it("is decisive when a component cannot be a month", () => {
    const r = rules.detectDateFormat(["03/04/2026", "25/12/2025"]);
    expect(r.format).toBe("DD/MM/YYYY");
    expect(r.ambiguous).toBe(false);
  });

  it("detects month-first the same way", () => {
    const r = rules.detectDateFormat(["04/25/2026"]);
    expect(r.format).toBe("MM/DD/YYYY");
    expect(r.ambiguous).toBe(false);
  });

  /**
   * The most important assertion in this file. A date-order error is the ONE
   * parse fault that survives every downstream check — the statement still
   * foots, because footing is about amounts. So the engine must refuse to
   * settle it quietly and must hand it to a human.
   */
  it("flags ambiguity instead of guessing, when every sample reads both ways", () => {
    const r = rules.detectDateFormat(["03/04/2026", "05/06/2026"]);
    expect(r.ambiguous).toBe(true);
    expect(r.confidence).toBeLessThan(1);
  });

  it("flags a column that contradicts itself", () => {
    const r = rules.detectDateFormat(["25/12/2026", "04/25/2026"]);
    expect(r.ambiguous).toBe(true);
  });
});

describe("the matching ladder", () => {
  const line = {
    amount: 250000,
    booking_date: "2026-04-03",
    description: "VIR RECU DUPONT SARL",
    counterparty: "DUPONT SARL",
    external_ref: "FT26094XYZ12",
  };
  const ledger = (over = {}) => ({
    line_id: "L1", debit: 250000, credit: 0, entry_date: "2026-04-03", description: "Reglement", ...over,
  });

  /**
   * The gate that outranks every similarity score. Money in cannot explain
   * money out, however alike the narratives are.
   */
  it("never matches across directions", () => {
    const opposite = ledger({ debit: 0, credit: 250000, description: "VIR RECU DUPONT SARL" });
    expect(rules.scoreMatch(line, opposite)).toBeNull();
  });

  it("never matches a different amount when the tolerance is zero", () => {
    expect(rules.scoreMatch(line, ledger({ debit: 250001 }))).toBeNull();
  });

  it("puts an exact institution-reference hit at tier 1", () => {
    const hit = rules.scoreMatch(line, ledger({ source_doc_ref: "FT26094XYZ12" }));
    expect(hit.tier).toBe(1);
    expect(hit.confidence).toBeGreaterThanOrEqual(0.99);
  });

  it("recognises a reference embedded in our own narrative at tier 2", () => {
    const hit = rules.scoreMatch(line, ledger({ description: "Reglement recu ref FT26094XYZ12 du client" }));
    expect(hit.tier).toBe(2);
  });

  it("scores same-amount-same-day at tier 3", () => {
    const hit = rules.scoreMatch({ ...line, external_ref: null }, ledger());
    expect(hit.tier).toBe(3);
  });

  it("decays confidence as the dates move apart", () => {
    const near = rules.scoreMatch({ ...line, external_ref: null }, ledger({ entry_date: "2026-04-04" }));
    const far = rules.scoreMatch({ ...line, external_ref: null }, ledger({ entry_date: "2026-04-06" }));
    expect(near.tier).toBe(4);
    expect(far.confidence).toBeLessThan(near.confidence);
  });

  it("requires narrative agreement once the dates are far apart", () => {
    const noName = rules.scoreMatch(
      { ...line, external_ref: null, description: "xxx", counterparty: null },
      ledger({ entry_date: "2026-04-11", description: "zzz" }),
    );
    expect(noName).toBeNull();

    const withName = rules.scoreMatch(
      { ...line, external_ref: null },
      ledger({ entry_date: "2026-04-11", description: "Reglement DUPONT SARL" }),
    );
    expect(withName.tier).toBe(5);
  });

  /**
   * Mobile money's defining difference. With a tolerance of zero (a bank) the
   * fee-sized gap is not a match at all; opened up to the fee, it becomes a
   * tier-6 suggestion for a human — never an automatic one.
   */
  it("only reaches the tolerance tier when a tolerance is actually granted", () => {
    const momo = { ...line, external_ref: null, amount: 42210 };
    const posting = ledger({ debit: 42000, entry_date: "2026-04-03" });
    expect(rules.scoreMatch(momo, posting)).toBeNull();

    const withFee = rules.scoreMatch(momo, posting, { tolerance: 210 });
    expect(withFee.tier).toBe(6);
    expect(withFee.confidence).toBeLessThan(0.8);
  });

  it("ranks best-first and stays stable across runs", () => {
    const candidates = [
      ledger({ line_id: "far", entry_date: "2026-04-06" }),
      ledger({ line_id: "same" }),
      ledger({ line_id: "ref", source_doc_ref: "FT26094XYZ12" }),
    ];
    const first = rules.rankCandidates(line, candidates).map((r) => r.candidate.line_id);
    const second = rules.rankCandidates(line, candidates.slice().reverse()).map((r) => r.candidate.line_id);
    expect(first).toEqual(["ref", "same", "far"]);
    expect(second).toEqual(first);
  });

  it("only auto-confirms tier 1", () => {
    expect(rules.AUTO_CONFIRM_TIER).toBe(1);
  });
});

describe("split matching", () => {
  it("finds the subset of postings that sums to one lodgement", () => {
    const found = rules.findSplitMatch({ amount: 300 }, [
      { line_id: "a", debit: 100, credit: 0 },
      { line_id: "b", debit: 200, credit: 0 },
      { line_id: "c", debit: 70, credit: 0 },
    ]);
    expect(found.candidates.map((c) => c.line_id).sort()).toEqual(["a", "b"]);
  });

  it("returns null rather than an approximation", () => {
    expect(rules.findSplitMatch({ amount: 999 }, [
      { line_id: "a", debit: 100, credit: 0 }, { line_id: "b", debit: 200, credit: 0 },
    ])).toBeNull();
  });

  it("ignores postings pointing the other way", () => {
    expect(rules.findSplitMatch({ amount: 300 }, [
      { line_id: "a", debit: 0, credit: 100 }, { line_id: "b", debit: 0, credit: 200 },
    ])).toBeNull();
  });
});

describe("footing — the arithmetic that catches a mis-parse", () => {
  const lines = [{ amount: 100 }, { amount: -30 }];

  it("passes when the declared balances agree with the movements", () => {
    const r = rules.checkFooting({ openingBalance: 1000, closingBalance: 1070, lines });
    expect(r.foots).toBe(true);
    expect(r.difference).toBe(0);
  });

  it("fails, with the size of the gap, when they do not", () => {
    const r = rules.checkFooting({ openingBalance: 1000, closingBalance: 1080, lines });
    expect(r.foots).toBe(false);
    expect(r.difference).toBe(-10);
  });

  /**
   * `null` is a third answer and not a pass: it records that the check could
   * not run, so `bank_statement.foots` stays NULL rather than claiming a
   * verification nobody performed.
   */
  it("returns null — not true — when there is nothing to check against", () => {
    const r = rules.checkFooting({ lines });
    expect(r.foots).toBeNull();
    expect(r.basis).toBe("UNCHECKABLE");
  });

  it("walks a running balance column and names the row that breaks it", () => {
    const r = rules.checkFooting({
      lines: [
        { row_index: 1, amount: 100, running_balance: 1100 },
        { row_index: 2, amount: -30, running_balance: 1070 },
        { row_index: 3, amount: -20, running_balance: 999 },
      ],
    });
    expect(r.foots).toBe(false);
    expect(r.broke_at_row).toBe(3);
  });

  /**
   * Mobile money again: MTN and Orange show Amount and Fee separately while the
   * balance reflects both. Read fee-blind, a perfectly correct export never
   * foots and the treasurer is told their file is broken.
   */
  it("reconciles a provider whose balance already has the fee taken out", () => {
    const r = rules.checkFooting({
      openingBalance: 150000,
      closingBalance: 107790,
      lines: [{ amount: -42000, fee: 210 }],
    });
    expect(r.foots).toBe(true);
    expect(r.fees_included_in_balance).toBe(true);
  });

  it("says so when the balance does NOT include fees", () => {
    const r = rules.checkFooting({
      openingBalance: 150000, closingBalance: 108000, lines: [{ amount: -42000, fee: 210 }],
    });
    expect(r.foots).toBe(true);
    expect(r.fees_included_in_balance).toBe(false);
  });
});

describe("the reconciliation identity", () => {
  it("closes to zero when the outstanding items explain the gap", () => {
    expect(rules.reconciliationDifference({
      ledgerBalance: 1000000, statementBalance: 1150000,
      depositsInTransit: 200000, outstandingPayments: 50000,
    })).toBe(0);
  });

  it("reports what is left unexplained", () => {
    expect(rules.reconciliationDifference({
      ledgerBalance: 1000000, statementBalance: 1150000, depositsInTransit: 200000,
    })).toBe(-50000);
  });
});

describe("row identity — the overlapping-period guard", () => {
  const base = {
    treasuryAccountId: "T1", bookingDate: "2026-04-03", amount: 250000, description: "VIR RECU DUPONT",
  };

  it("is stable across whitespace, case and punctuation in the narrative", () => {
    expect(rules.rowHash({ ...base, description: "VIR   RECU,  DUPONT!" }))
      .toBe(rules.rowHash({ ...base, description: "vir recu dupont" }));
  });

  it("separates two different transactions", () => {
    expect(rules.rowHash(base)).not.toBe(rules.rowHash({ ...base, amount: 250001 }));
    expect(rules.rowHash(base)).not.toBe(rules.rowHash({ ...base, bookingDate: "2026-04-04" }));
  });

  it("separates the same transaction on two different accounts", () => {
    expect(rules.rowHash(base)).not.toBe(rules.rowHash({ ...base, treasuryAccountId: "T2" }));
  });

  /**
   * When the institution gave its own identifier, that identifier IS the
   * transaction — a re-export with a reworded narrative or a corrected date is
   * still the same payment and must not enter twice.
   */
  it("lets the institution's reference dominate the natural key", () => {
    expect(rules.rowHash({ ...base, externalRef: "FT1" }))
      .toBe(rules.rowHash({ treasuryAccountId: "T1", bookingDate: "2099-01-01", amount: 1, description: "x", externalRef: "ft1" }));
  });
});
