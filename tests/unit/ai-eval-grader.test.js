"use strict";
/**
 * The eval grader (audit H1).
 *
 * ── WHY THIS IS THE CI GATE AND THE LIVE RUN IS NOT ─────────────────────────
 *
 * H1 asks for an eval "run in CI as a gate". A gate that asks a live model a
 * question and asserts on the prose cannot be one: it needs a seeded tenant, a
 * funded credential, and a model that answers differently every time. A build
 * that goes red because a model rephrased something teaches people to ignore
 * the build.
 *
 * So the RULES are the gate. `grade.js` is pure, and these run it against
 * recorded answers — the good one and, for each rule, the specific bad one it
 * exists to catch. `scripts/ai/eval.js` runs the same function against a real
 * tenant when someone has the infrastructure to do it.
 *
 * Every test below plants the defect the rule was written for, so a rule that
 * stops working fails here rather than passing silently against an answer that
 * never contained the problem. A grader asserted only against good answers is
 * a grader that would pass with its body deleted.
 */

const {
  gradeAnswer,
  gradeRun,
  statesFigure,
  ambiguousDates,
  leakedFieldNames,
  looksTruncated,
} = require("../../src/services/ai/eval/grade");
const {
  GOLDEN_SET,
  A1_LARGE_RECEIVABLE,
  assertWellFormed,
  findingsCovered,
} = require("../../src/services/ai/eval/golden-set");

/** A case's failures, by rule name. */
const checksOf = (g) => g.failures.map((f) => f.check);

describe("A1 — the audit's named regression", () => {
  it("passes an answer that reports the seeded figure exactly", () => {
    const g = gradeAnswer(
      { answer: `The largest outstanding receivable is 102,500,000 XAF, owed by Cameroon Cocoa Exporters.` },
      { id: "a1", reportsExactly: [A1_LARGE_RECEIVABLE] },
    );
    expect(g.passed).toBe(true);
  });

  it("FAILS an answer that reports [NUM] instead of the figure", () => {
    // This is the defect verbatim: a nine-digit figure blacked out of the
    // caller's own answer by a redaction pass that should not have seen it.
    const g = gradeAnswer(
      { answer: "The largest outstanding receivable is [NUM] XAF." },
      { id: "a1", reportsExactly: [A1_LARGE_RECEIVABLE] },
    );
    expect(g.passed).toBe(false);
    expect(checksOf(g)).toEqual(expect.arrayContaining(["noRedactionMarkers", "reportsExactly"]));
  });

  it("fails on ANY redaction marker, not only [NUM]", () => {
    // The same egress split that let [NUM] through can let these through, and a
    // placeholder in a tenant-facing answer is always a defect.
    for (const marker of ["[EMAIL]", "[PHONE]", "[PASSPORT]", "[IBAN]"]) {
      const g = gradeAnswer({ answer: `Contact them on ${marker}.` }, { id: "m" });
      expect(checksOf(g)).toContain("noRedactionMarkers");
    }
  });

  it("accepts the figure however it is punctuated", () => {
    for (const written of ["102,500,000", "102 500 000", "102500000"]) {
      expect(statesFigure(`Total ${written} XAF`, A1_LARGE_RECEIVABLE)).toBe(true);
    }
  });

  it("is not satisfied by unrelated digits that happen to concatenate", () => {
    // A looser check — strip all separators from the whole answer, then
    // substring-match — would call this a pass and the eval would be worthless.
    expect(statesFigure("Invoice 1025 and reference 00000 are open.", A1_LARGE_RECEIVABLE)).toBe(false);
  });
});

describe("B1 — truncation", () => {
  it("trusts the vendor's own finish_reason over the prose", () => {
    const g = gradeAnswer(
      { answer: "A complete sentence.", finishReason: "length" },
      { id: "t" },
    );
    expect(checksOf(g)).toContain("notTruncated");
  });

  it("catches an answer that stops mid-thought with no metadata", () => {
    expect(looksTruncated("The three overdue files are SBX-0142, SBX-0155 and", null)).toBe(true);
  });

  it("does NOT flag a short, properly finished answer", () => {
    // A false truncation on a terse reply would make the whole eval untrusted.
    expect(looksTruncated("Yes.", "stop")).toBe(false);
    expect(looksTruncated("Three files are open.", null)).toBe(false);
  });
});

describe("C1-C3 — the write contract", () => {
  it("passes a proposed write that carries the actor", () => {
    const g = gradeAnswer(
      {
        answer: "I have prepared the supplier Atlantique Transit for you to confirm.",
        writes: [{ actionKey: "create_supplier", actorUserId: "u-1" }],
      },
      { id: "c1", proposesWrite: ["create_supplier"], mentions: ["Atlantique Transit"] },
    );
    expect(g.passed).toBe(true);
  });

  it("FAILS a write that ran with the actor dropped", () => {
    // C2 exactly: the answer reads as a success and the audit row names nobody.
    const g = gradeAnswer(
      {
        answer: "I have prepared the lead for you to confirm.",
        writes: [{ actionKey: "create_lead", actorUserId: null }],
      },
      { id: "c2", proposesWrite: ["create_lead"] },
    );
    expect(g.passed).toBe(false);
    expect(g.failures.some((f) => /no actor/.test(f.detail))).toBe(true);
  });

  it("fails when the write was never proposed at all", () => {
    const g = gradeAnswer(
      { answer: "I can help you create that supplier." },
      { id: "c1", proposesWrite: ["create_supplier"] },
    );
    expect(checksOf(g)).toContain("proposesWrite");
  });
});

describe("D5/G1 — tool selection", () => {
  it("fails a read question that reached for a write action", () => {
    const g = gradeAnswer(
      { answer: "There are four open files.", toolsUsed: ["create_operation_file"] },
      { id: "d5", usesTools: ["list_operation_files"], neverTools: ["create_operation_file"] },
    );
    expect(checksOf(g)).toEqual(expect.arrayContaining(["usesTools", "neverTools"]));
  });

  it("passes when the expected read ran and no write did", () => {
    const g = gradeAnswer(
      { answer: "There are four open files.", toolsUsed: ["list_operation_files"] },
      { id: "d5", usesTools: ["list_operation_files"], neverTools: ["create_operation_file"] },
    );
    expect(g.passed).toBe(true);
  });
});

describe("B6 — the style contract", () => {
  it("fails a raw identifier in the prose", () => {
    const g = gradeAnswer(
      { answer: "The file is d69be65d-1f2a-4b3c-8d4e-5f6a7b8c9d0e." },
      { id: "s" },
    );
    expect(checksOf(g)).toContain("style");
  });

  it("fails a snake_case field name but ALLOWS an action key", () => {
    // "payment_terms_days" is the banned leak; "create_purchase_order" is a
    // tool the assistant may legitimately name when saying what it will do.
    expect(leakedFieldNames("Their payment_terms_days is 30.")).toEqual(["payment_terms_days"]);
    expect(leakedFieldNames("I will call create_purchase_order next.")).toEqual([]);
  });

  it("fails a filler opener", () => {
    const g = gradeAnswer({ answer: "Certainly! Here is the summary." }, { id: "s" });
    expect(checksOf(g)).toContain("style");
  });

  it("flags an AMBIGUOUS numeric date and leaves an unambiguous one alone", () => {
    // 07/03/2026 could be 7 March or 3 July, and both are real dates — which is
    // why `check-date-format.js` exists for code and why prose needs this.
    expect(ambiguousDates("The deadline is 07/03/2026.")).toEqual(["07/03/2026"]);
    // 25 cannot be a month, so there is nothing to warn about.
    expect(ambiguousDates("The deadline is 25/07/2026.")).toEqual([]);
    // A month written as a word is unambiguous in either convention.
    expect(ambiguousDates("The deadline is 3 July 2026.")).toEqual([]);
  });

  it("fails tabular data written as prose when the case expects a table", () => {
    const g = gradeAnswer(
      { answer: "SBX-1 is 100 XAF, SBX-2 is 200 XAF, SBX-3 is 300 XAF." },
      { id: "s", expectsTable: true },
    );
    expect(checksOf(g)).toContain("style");
  });

  it("passes a real Markdown table", () => {
    const g = gradeAnswer(
      { answer: "Here they are.\n\n| Invoice | Amount |\n| --- | --- |\n| SBX-1 | 100 |" },
      { id: "s", expectsTable: true },
    );
    expect(g.passed).toBe(true);
  });
});

describe("the grader reports EVERY failure, not the first", () => {
  it("names all four problems in one bad answer", () => {
    const g = gradeAnswer(
      {
        answer: "Certainly! The total is [NUM] and the file is d69be65d-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
        finishReason: "length",
      },
      { id: "x", reportsExactly: [A1_LARGE_RECEIVABLE] },
    );
    // Finding one problem per run costs a run per problem — the same argument
    // ci-local.js makes for reporting all its gates.
    expect(new Set(checksOf(g))).toEqual(
      new Set(["reportsExactly", "noRedactionMarkers", "notTruncated", "style"]),
    );
  });
});

describe("gradeRun", () => {
  it("counts passes and failures across a set", () => {
    const cases = [{ id: "a", mentions: ["yes"] }, { id: "b", mentions: ["yes"] }];
    const run = gradeRun(cases, { a: { answer: "yes." }, b: { answer: "no." } });
    expect(run).toMatchObject({ total: 2, passed: 1, failed: 1 });
  });

  it("treats a case with NO recorded answer as a failure, never a skip", () => {
    // A run that crashed on a case must not be able to report itself green.
    const run = gradeRun([{ id: "a", mentions: ["yes"] }], {});
    expect(run.failed).toBe(1);
  });
});

describe("the golden set itself", () => {
  it("is well-formed — unique ids, a question and a cited finding each", () => {
    expect(assertWellFormed()).toEqual([]);
  });

  it("defends the findings the audit's acceptance criteria name", () => {
    // If a case is deleted, this says which guarantee went with it.
    expect(findingsCovered()).toEqual(
      expect.arrayContaining(["A1", "B1", "B6", "C1", "C2", "C3", "D5"]),
    );
  });

  it("keeps the A1 figure at nine digits, or the regression cannot reproduce", () => {
    // The bug was a blanket \d{9,} blackout. A seven-digit receivable would
    // pass whether or not the fix is still in place.
    expect(String(A1_LARGE_RECEIVABLE).length).toBeGreaterThanOrEqual(9);
    expect(A1_LARGE_RECEIVABLE).toBeGreaterThanOrEqual(100_000_000);
  });

  it("asks something in every case", () => {
    expect(GOLDEN_SET.every((c) => typeof c.ask === "string" && c.ask.length > 10)).toBe(true);
  });
});
