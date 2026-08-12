"use strict";

/**
 * Pure ledger invariants (KB §23) — the app-layer pre-checks in
 * finance/journal_entry/journal_entry.rules. DB triggers (0220/0221/0464) are the
 * final authority; these lock the friendly-error behaviour and the money math.
 */

const {
  assertBalanced,
  assertNoCompensation,
  toMinor,
} = require("../../src/modules/finance/journal_entry/journal_entry.rules");

const L = (account_code, debit, credit) => ({ account_code, debit, credit });

/**
 * The CODE, not the message.
 *
 * These assertions used to match on message text (`/not balanced/i`), and that
 * broke the moment the rules moved to `packages/shared` and their wording was
 * rewritten for an OPERATOR rather than a log — because the client now renders
 * them next to the offending line.
 *
 * The code is the stable thing: it is what the 422 body carries, what the AI
 * tool surface branches on, and what does not change when someone improves a
 * sentence. Asserting the sentence made a wording improvement look like a
 * ledger regression, which is the wrong signal to give.
 */
const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e.code;
  }
};

describe("assertBalanced (§23.1/§23.2)", () => {
  it("accepts a balanced two-line entry", () => {
    expect(() =>
      assertBalanced([L("521", 1000, 0), L("4191", 0, 1000)]),
    ).not.toThrow();
  });

  it("rejects an unbalanced entry", () => {
    expect(
      codeOf(() => assertBalanced([L("521", 1000, 0), L("4191", 0, 999)])),
    ).toBe("ENTRY_UNBALANCED");
  });

  it("rejects a line with both sides > 0 (§23.2)", () => {
    expect(
      codeOf(() => assertBalanced([L("521", 100, 100), L("4191", 0, 100)])),
    ).toBe("LINE_ONE_SIDE");
  });

  it("rejects a line with neither side > 0", () => {
    expect(
      codeOf(() => assertBalanced([L("521", 0, 0), L("4191", 0, 0)])),
    ).toBe("LINE_ONE_SIDE");
  });

  it("requires at least two lines", () => {
    expect(codeOf(() => assertBalanced([L("521", 1000, 0)]))).toBe(
      "ENTRY_TOO_FEW_LINES",
    );
  });

  it("rejects a missing account_code", () => {
    expect(
      codeOf(() =>
        assertBalanced([{ debit: 1000, credit: 0 }, L("4191", 0, 1000)]),
      ),
    ).toBe("LINE_NO_ACCOUNT");
  });

  it("rejects more than 2 decimals (money precision)", () => {
    expect(
      codeOf(() => assertBalanced([L("521", 10.001, 0), L("4191", 0, 10.001)])),
    ).toBe("INVALID_AMOUNT");
  });

  it("sums in minor units without float drift", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in float; must still balance to 0.30.
    expect(() =>
      assertBalanced([L("521", 0.1, 0), L("571", 0.2, 0), L("4191", 0, 0.3)]),
    ).not.toThrow();
  });
});

describe("assertNoCompensation (§23.6)", () => {
  it("accepts distinct debit/credit accounts", () => {
    expect(() =>
      assertNoCompensation([L("521", 1000, 0), L("4191", 0, 1000)]),
    ).not.toThrow();
  });

  it("rejects the same account on both sides of one entry", () => {
    expect(
      codeOf(() =>
        assertNoCompensation([
          L("521", 1000, 0),
          L("521", 0, 400),
          L("4191", 0, 600),
        ]),
      ),
    ).toBe("COMPENSATION");
  });
});

describe("toMinor", () => {
  it("rejects negatives and non-numbers", () => {
    expect(codeOf(() => toMinor(-1, "x"))).toBe("INVALID_AMOUNT");
    expect(() => toMinor("5", "x")).toThrow(/non-negative/i);
  });
  it("converts to centimes", () => {
    expect(toMinor(19.25, "x")).toBe(1925);
  });
});
