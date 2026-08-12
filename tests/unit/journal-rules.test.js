"use strict";
/**
 * KB §23 invariants #1 (balanced) and #2 (one side per line), enforced friendly
 * before the DB triggers. See src/modules/finance/journal_entry/journal_entry.rules.js.
 */
const {
  assertBalanced,
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

describe("journal entry balance rules", () => {
  it("accepts a balanced two-line entry", () => {
    const r = assertBalanced([L("521", 1000, 0), L("4191", 0, 1000)]);
    expect(r).toEqual({ debitMinor: 100000, creditMinor: 100000 });
  });

  it("accepts a balanced multi-line entry with decimals", () => {
    expect(() =>
      assertBalanced([
        L("4111", 10385.25, 0),
        L("7061", 0, 10000.25),
        L("4432", 0, 385.0),
      ]),
    ).not.toThrow();
  });

  it("rejects fewer than two lines", () => {
    expect(codeOf(() => assertBalanced([L("521", 100, 0)]))).toBe(
      "ENTRY_TOO_FEW_LINES",
    );
  });

  it("rejects an unbalanced entry", () => {
    expect(
      codeOf(() => assertBalanced([L("521", 1000, 0), L("4191", 0, 999)])),
    ).toBe("ENTRY_UNBALANCED");
  });

  it("rejects a line with both sides set (#23.2)", () => {
    expect(
      codeOf(() => assertBalanced([L("521", 100, 100), L("4191", 0, 100)])),
    ).toBe("LINE_ONE_SIDE");
  });

  it("rejects a line with neither side > 0 (#23.2)", () => {
    expect(
      codeOf(() => assertBalanced([L("521", 0, 0), L("4191", 0, 100)])),
    ).toBe("LINE_ONE_SIDE");
  });

  it("rejects more than two decimals", () => {
    expect(
      codeOf(() =>
        assertBalanced([L("521", 100.001, 0), L("4191", 0, 100.001)]),
      ),
    ).toBe("INVALID_AMOUNT");
  });

  it("rejects a missing account_code", () => {
    expect(
      codeOf(() => assertBalanced([L("", 100, 0), L("4191", 0, 100)])),
    ).toBe("LINE_NO_ACCOUNT");
  });
});

describe("no compensation (#23.6)", () => {
  const {
    assertNoCompensation,
  } = require("../../src/modules/finance/journal_entry/journal_entry.rules");
  it("allows an entry with distinct debit/credit accounts", () => {
    expect(() =>
      assertNoCompensation([L("521", 1000, 0), L("4191", 0, 1000)]),
    ).not.toThrow();
  });
  it("allows the same account on the same side twice", () => {
    expect(() =>
      assertNoCompensation([
        L("706", 0, 500),
        L("706", 0, 500),
        L("4111", 1000, 0),
      ]),
    ).not.toThrow();
  });
  it("rejects an account debited AND credited in one entry", () => {
    expect(() =>
      assertNoCompensation([
        L("411", 1000, 0),
        L("411", 0, 400),
        L("706", 0, 600),
      ]),
    ).toThrow(/compensation|both debited and credited/i);
  });
});
