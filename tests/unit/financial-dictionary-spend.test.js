"use strict";

/**
 * MOD-05 PR2 — the pure half of spend, cost evolution, proof obligations and
 * bulk import. No database, no spreadsheet: every judgement these features make
 * lives in financial_dictionary.rules.js, which is what makes it testable here
 * and what keeps the repo/import layers to I/O.
 *
 * The cases that earn their place are the ones where the OBVIOUS implementation
 * is wrong: a sparse month axis that hides a pause in spending, a trend that
 * reports 0% for "no movement" and "one data point" alike, an import that
 * accepts a half-filled OHADA mapping, and a proof obligation raised on
 * CONDITIONALLY_REQUIRED — which cannot be decided from the catalogue row.
 */

const r = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");

describe("spend — period maths", () => {
  test("defaults to the trailing 12 months including the current one", () => {
    const p = r.normalisePeriod({ today: "2026-08-09" });
    expect(p.to).toBe("2026-08-09");
    expect(p.from).toBe("2025-09-01");
    expect(r.monthKeys(p.from, p.to)).toHaveLength(12);
  });

  test("an explicit window is honoured verbatim, and `to` is INCLUSIVE", () => {
    const p = r.normalisePeriod({ from: "2026-01-01", to: "2026-03-31" });
    expect(p).toMatchObject({ from: "2026-01-01", to: "2026-03-31", swapped: false });
    // March is present: a picker that says "January to March" means all of March.
    expect(r.monthKeys(p.from, p.to)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  test("a reversed window collapses to a single day rather than scanning backwards", () => {
    const p = r.normalisePeriod({ from: "2026-06-01", to: "2026-01-01" });
    expect(p).toMatchObject({ from: "2026-01-01", to: "2026-01-01", swapped: true });
  });

  test("garbage dates fall back to the default window instead of throwing", () => {
    const p = r.normalisePeriod({ from: "not-a-date", to: "2026-08-09" });
    expect(p.from).toBe("2025-09-01");
    expect(r.normalisePeriod({ from: "2026-13-45", to: "2026-02-30" }).to).toBeTruthy();
  });

  test("monthKeys spans a year boundary and is capped", () => {
    expect(r.monthKeys("2025-11-15", "2026-02-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(r.monthKeys("2000-01-01", "2050-01-01")).toHaveLength(120);
  });
});

describe("spend — series assembly", () => {
  const months = ["2026-01", "2026-02", "2026-03"];

  test("the month axis is DENSE — a month with no spend is a zero row, not a gap", () => {
    // The whole point: February had no activity. A sparse series would draw a
    // straight line from January to March and report a trend that never happened.
    const { months: rows } = r.spendSeries(months, {
      actual: [{ month: "2026-01", amount: "1000", count: 2 }, { month: "2026-03", amount: "500", count: 1 }],
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((x) => x.actual)).toEqual([1000, 0, 500]);
    expect(rows[1]).toMatchObject({ month: "2026-02", actual: 0, actual_count: 0 });
  });

  test("the three lenses merge onto one axis and total independently", () => {
    const { totals } = r.spendSeries(months, {
      estimated: [{ month: "2026-01", amount: 1200, count: 1 }],
      committed: [{ month: "2026-02", amount: 1100, count: 2 }],
      actual: [{ month: "2026-03", amount: 900, count: 3 }],
    });
    expect(totals).toMatchObject({ estimated: 1200, committed: 1100, actual: 900 });
    expect(totals.estimated_count + totals.committed_count + totals.actual_count).toBe(6);
  });

  test("the headline is ACTUAL, and the variances are signed against it", () => {
    const { totals } = r.spendSeries(months, {
      estimated: [{ month: "2026-01", amount: 1000, count: 1 }],
      committed: [{ month: "2026-01", amount: 800, count: 1 }],
      actual: [{ month: "2026-01", amount: 600, count: 1 }],
    });
    expect(totals.headline).toBe(600);
    // Promised but not yet posted — the number that says "chase these documents".
    expect(totals.variance_committed_actual).toBe(200);
    expect(totals.variance_estimated_actual).toBe(400);
  });

  test("Postgres NUMERIC arrives as a string and must not concatenate", () => {
    const { totals } = r.spendSeries(["2026-01", "2026-02"], {
      actual: [{ month: "2026-01", amount: "1000.50", count: "2" }, { month: "2026-02", amount: "2000.25", count: "1" }],
    });
    expect(totals.actual).toBeCloseTo(3000.75, 2);
    expect(totals.actual_count).toBe(3);
  });

  test("a month outside the axis is dropped rather than corrupting the totals", () => {
    const { totals, months: rows } = r.spendSeries(["2026-02"], { actual: [{ month: "2026-01", amount: 999, count: 1 }] });
    expect(rows).toHaveLength(1);
    expect(totals.actual).toBe(0);
  });
});

describe("cost evolution — rate timeline & trend", () => {
  const rates = [
    { expense_rate_id: "c", rate: "150000", effective_from: "2026-06-01", effective_to: null },
    { expense_rate_id: "a", rate: "100000", effective_from: "2026-01-01", effective_to: "2026-02-28" },
    { expense_rate_id: "b", rate: "120000", effective_from: "2026-03-01", effective_to: "2026-05-31" },
  ];

  test("orders oldest-first regardless of the order the rows arrive in", () => {
    expect(r.rateTimeline(rates, "2026-07-01").map((x) => x.expense_rate_id)).toEqual(["a", "b", "c"]);
  });

  test("`in_force` is answered AS OF a date, not as of now", () => {
    const inForceOn = (day) => r.rateTimeline(rates, day).find((x) => x.in_force);
    expect(inForceOn("2026-07-01").expense_rate_id).toBe("c");
    // A back-dated question gets the rate that was really in force then — which
    // is the entire reason effective dating exists.
    expect(inForceOn("2026-04-15").expense_rate_id).toBe("b");
    expect(inForceOn("2026-01-15").expense_rate_id).toBe("a");
  });

  test("a superseded row is marked, and an open-ended one is not", () => {
    const t = r.rateTimeline(rates, "2026-07-01");
    expect(t.map((x) => x.superseded)).toEqual([true, true, false]);
  });

  test("rows with no effective_from are dropped, not sorted to the front", () => {
    expect(r.rateTimeline([...rates, { rate: 1, effective_from: null }], "2026-07-01")).toHaveLength(3);
  });

  test("trend measures first → last, and distinguishes 'flat' from 'no data'", () => {
    const up = r.rateTrend(r.rateTimeline(rates, "2026-07-01"));
    expect(up).toMatchObject({ first: 100000, last: 150000, delta: 50000, delta_pct: 50, direction: "up", points: 3 });

    // Flat and empty are different answers; a chart that renders 0% for both lies.
    expect(r.rateTrend([{ rate: 5 }, { rate: 5 }])).toMatchObject({ delta: 0, delta_pct: 0, direction: "flat", points: 2 });
    expect(r.rateTrend([])).toMatchObject({ first: null, last: null, delta: null, delta_pct: null, points: 0 });
    // One point has a value but no movement to report.
    expect(r.rateTrend([{ rate: 42 }])).toMatchObject({ first: 42, last: 42, delta: 0, points: 1 });
  });

  test("a rise from zero has no percentage — it is undefined, not infinite", () => {
    expect(r.rateTrend([{ rate: 0 }, { rate: 500 }])).toMatchObject({ delta: 500, delta_pct: null, direction: "up" });
  });

  test("dayBefore closes a window with no overlapping day, across a month boundary", () => {
    expect(r.dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(r.dayBefore("2024-03-01")).toBe("2024-02-29"); // leap year
    expect(r.dayBefore("2026-01-01")).toBe("2025-12-31");
  });
});

describe("proof obligations", () => {
  test("ALWAYS_REQUIRED and requires_justification are independent triggers", () => {
    expect(r.proofObligation({ receipt_requirement: "ALWAYS_REQUIRED" }).reasons).toEqual(["ALWAYS_REQUIRED"]);
    expect(r.proofObligation({ requires_justification: true }).reasons).toEqual(["REQUIRES_JUSTIFICATION"]);
    expect(r.proofObligation({ receipt_requirement: "ALWAYS_REQUIRED", requires_justification: true }).reasons).toHaveLength(2);
  });

  test("CONDITIONALLY_REQUIRED is NOT an obligation — a flag raised on a maybe is noise", () => {
    expect(r.proofObligation({ receipt_requirement: "CONDITIONALLY_REQUIRED" }).required).toBe(false);
    expect(r.proofObligation({ receipt_requirement: "NOT_REQUIRED" }).required).toBe(false);
    expect(r.proofObligation({}).required).toBe(false);
  });

  test("the severity is WARN — advisory, never a hard block", () => {
    expect(r.proofObligation({ receipt_requirement: "ALWAYS_REQUIRED" }).severity).toBe("WARN");
    expect(r.proofObligation({}).severity).toBe(null);
  });

  test("missingProof fires only when an obliged item has no proof attached", () => {
    const obliged = { receipt_requirement: "ALWAYS_REQUIRED" };
    expect(r.missingProof(obliged, { proof_vault_id: null })).toBe(true);
    expect(r.missingProof(obliged, {})).toBe(true);
    expect(r.missingProof(obliged, { proof_vault_id: "doc-1" })).toBe(false);
    expect(r.missingProof({ receipt_requirement: "NOT_REQUIRED" }, {})).toBe(false);
  });

  test("the message names the line, the reason and the expected source", () => {
    const msg = r.proofMessage(
      { code: "#D263", label_en: "Port charges", receipt_requirement: "ALWAYS_REQUIRED", proof_source: "PORT_TERMINAL" },
      { docLabel: "cash request CR-1", amount: 85000 },
    );
    expect(msg).toContain("#D263");
    expect(msg).toContain("always requires a receipt");
    expect(msg).toContain("cash request CR-1");
    expect(msg).toContain("85000");
    expect(msg).toContain("PORT_TERMINAL");
  });
});

describe("import — cell parsing", () => {
  test("booleans accept the forms a French/English sheet actually contains", () => {
    for (const v of ["Y", "yes", "TRUE", "1", "oui", "x"]) expect(r.parseBool(v)).toBe(true);
    for (const v of ["N", "no", "false", "0", "non"]) expect(r.parseBool(v)).toBe(false);
    expect(r.parseBool("")).toBeUndefined();
    expect(r.parseBool(null)).toBeUndefined();
    // Unparseable is NOT "false" — it is a rejection, so the user sees the typo.
    expect(r.parseBool("maybe")).toBe(null);
  });

  test("numbers survive both thousand-separator conventions", () => {
    expect(r.parseNumber("1 250,50")).toBeCloseTo(1250.5);
    expect(r.parseNumber("1,250.50")).toBeCloseTo(1250.5);
    expect(r.parseNumber("85000")).toBe(85000);
    expect(r.parseNumber(85000)).toBe(85000);
    expect(r.parseNumber("")).toBeUndefined();
    expect(r.parseNumber("abc")).toBe(null);
  });
});

describe("import — row validation", () => {
  const ctx = {
    accounts: new Set(["6271", "4011", "7061", "4111", "4731"]),
    taxCodes: new Map([["TVA19", "tax-1"]]),
    serviceTypes: new Map([["SEA_IMPORT", "svc-1"], ["AIR_IMPORT", "svc-2"]]),
  };
  const good = () => ({
    label_fr: "Frais portuaires", label_en: "Port charges", category: "debours", direction: "DEBOURS",
    purchase_debit: "6271", purchase_credit: "4011",
  });

  test("a minimal complete row passes and normalises", () => {
    const res = r.validateImportRow(good(), ctx);
    expect(res.valid).toBe(true);
    expect(res.data.posting_rules).toEqual([
      { applies_context: "purchase", debit_account: "6271", credit_account: "4011", tax_code_id: null },
    ]);
    // A DEBOURS row always carries the flag — the same rule the HTTP path applies.
    expect(res.data.is_debours).toBe(true);
  });

  test("THE rule: a row with no complete OHADA mapping is rejected", () => {
    const res = r.validateImportRow({ ...good(), purchase_debit: "", purchase_credit: "" }, ctx);
    expect(res.valid).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/at least one context/i);
    expect(res.data).toBe(null);
  });

  test("a HALF-filled context is an error, not a silent drop", () => {
    // A purchase debit with no credit is a typo. Dropping it quietly would
    // create the item with no purchase rule and fail at the first invoice.
    const res = r.validateImportRow({ ...good(), purchase_credit: "" }, ctx);
    expect(res.valid).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/both a debit and a credit/i);
  });

  test("accounts must be postable, and tax codes must exist", () => {
    expect(r.validateImportRow({ ...good(), purchase_debit: "9999" }, ctx).reasons.join(" ")).toMatch(/not a postable account/);
    expect(r.validateImportRow({ ...good(), purchase_tax_code: "TVA99" }, ctx).reasons.join(" ")).toMatch(/tax code "TVA99" does not exist/);
    const ok = r.validateImportRow({ ...good(), purchase_tax_code: "TVA19" }, ctx);
    expect(ok.valid).toBe(true);
    expect(ok.data.posting_rules[0].tax_code_id).toBe("tax-1");
  });

  test("enums are checked against the catalogue, with the offending value quoted", () => {
    expect(r.validateImportRow({ ...good(), direction: "EXPENCE" }, ctx).reasons.join(" ")).toMatch(/Direction "EXPENCE"/);
    expect(r.validateImportRow({ ...good(), category: "widget" }, ctx).reasons.join(" ")).toMatch(/Category "widget"/);
    expect(r.validateImportRow({ ...good(), receipt_requirement: "SOMETIMES" }, ctx).reasons.join(" ")).toMatch(/Receipt requirement/);
  });

  test("required identity fields are named individually so the fix is obvious", () => {
    const res = r.validateImportRow({ purchase_debit: "6271", purchase_credit: "4011" }, ctx);
    expect(res.reasons).toEqual(expect.arrayContaining([
      "Name (FR) is required", "Category is required", "Direction is required",
    ]));
  });

  test("service keys resolve to ids, and a SERVICE_SCOPED row must name one", () => {
    const scoped = r.validateImportRow({ ...good(), applicability_mode: "SERVICE_SCOPED", service_type_keys: "SEA_IMPORT, AIR_IMPORT", tier: "ADVANCED" }, ctx);
    expect(scoped.valid).toBe(true);
    expect(scoped.data.service_tiers).toEqual([
      { service_type_id: "svc-1", service_key: "SEA_IMPORT", tier: "ADVANCED" },
      { service_type_id: "svc-2", service_key: "AIR_IMPORT", tier: "ADVANCED" },
    ]);
    expect(r.validateImportRow({ ...good(), applicability_mode: "SERVICE_SCOPED" }, ctx).reasons.join(" "))
      .toMatch(/must name at least one service key/);
    expect(r.validateImportRow({ ...good(), service_type_keys: "NOPE" }, ctx).reasons.join(" "))
      .toMatch(/Service type "NOPE" does not exist/);
  });

  test("numbers and booleans reject rather than coerce", () => {
    expect(r.validateImportRow({ ...good(), default_price: "abc" }, ctx).reasons.join(" ")).toMatch(/is not a number/);
    expect(r.validateImportRow({ ...good(), default_price: "-5" }, ctx).reasons.join(" ")).toMatch(/cannot be negative/);
    expect(r.validateImportRow({ ...good(), is_billable: "perhaps" }, ctx).reasons.join(" ")).toMatch(/must be Y or N/);
    expect(r.validateImportRow({ ...good(), currency: "XAFF" }, ctx).reasons.join(" ")).toMatch(/3-letter code/);
  });

  test("every reason for a bad row is reported at once, not one per round trip", () => {
    const res = r.validateImportRow({ label_fr: "x", category: "nope", direction: "nope" }, ctx);
    expect(res.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("import — partitioning a sheet", () => {
  const ctx = { accounts: new Set(["6271", "4011"]), taxCodes: new Map(), serviceTypes: new Map() };
  const row = (over) => ({ label_fr: "A", category: "service", direction: "EXPENSE", purchase_debit: "6271", purchase_credit: "4011", ...over });

  test("valid and rejected rows both keep their real spreadsheet row number", () => {
    const { valid, rejected } = r.partitionImport([
      { __row: 2, ...row({ label_fr: "Good" }) },
      { __row: 3, ...row({ label_fr: "Bad", purchase_credit: "" }) },
    ], ctx);
    expect(valid).toHaveLength(1);
    expect(valid[0].row).toBe(2);
    expect(rejected[0].row).toBe(3);
    // The original cells travel with the rejection so the error file can show them.
    expect(rejected[0].raw.label_fr).toBe("Bad");
  });

  test("PARTIAL: good rows survive a sheet that also contains bad ones", () => {
    const rows = [row({ label_fr: "One" }), row({ label_fr: "Two", direction: "NOPE" }), row({ label_fr: "Three" })];
    const { valid, rejected } = r.partitionImport(rows, ctx);
    expect(valid.map((v) => v.data.label_fr)).toEqual(["One", "Three"]);
    expect(rejected).toHaveLength(1);
  });

  test("a duplicate name inside the file is rejected rather than minting two codes", () => {
    const { valid, rejected } = r.partitionImport([row({ label_fr: "Same" }), row({ label_fr: "same" })], ctx);
    expect(valid).toHaveLength(1);
    expect(rejected[0].reasons.join(" ")).toMatch(/Duplicate of row 2/);
  });

  test("row numbers default to 1-based-plus-header when the parser did not set them", () => {
    const { valid } = r.partitionImport([row({}), row({ label_fr: "B" })], ctx);
    expect(valid.map((v) => v.row)).toEqual([2, 3]);
  });
});

describe("import — the column contract", () => {
  test("every OHADA context has a debit and a credit column", () => {
    const keys = new Set(r.IMPORT_COLUMNS.map((c) => c.key));
    for (const ctxName of r.CONTEXTS) {
      expect(keys.has(`${ctxName}_debit`)).toBe(true);
      expect(keys.has(`${ctxName}_credit`)).toBe(true);
    }
  });

  test("`code` is never a column — it is minted server-side from the direction", () => {
    expect(r.IMPORT_COLUMNS.some((c) => c.key === "code")).toBe(false);
  });

  test("the enum columns the template turns into dropdowns match the validator", () => {
    const byKey = Object.fromEntries(r.IMPORT_COLUMNS.map((c) => [c.key, c]));
    expect(byKey.direction.enum).toEqual(r.DIRECTIONS);
    expect(byKey.category.enum).toEqual(r.CATEGORIES);
    expect(byKey.applicability_mode.enum).toEqual(r.APPLICABILITIES);
    expect(byKey.receipt_requirement.enum).toEqual(r.RECEIPTS);
  });
});
