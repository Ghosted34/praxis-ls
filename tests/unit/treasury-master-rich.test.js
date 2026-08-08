"use strict";
/**
 * Treasury master data revamp (0519) — the pure-rule surface.
 *
 * Two things worth pinning here in isolation from the DB:
 *
 *   1. `nextLeafCode` picks the right next 6-digit child under a class-5
 *      parent, whatever the parent's width. The trial balance depends on
 *      this being predictable — "add another petty cash float and its CoA
 *      leaf shows up as 571102" is a promise the treasurer relies on.
 *
 *   2. `assertCreate` refuses the shapes that shouldn't be posted (petty
 *      cash without a custodian, a body that supplies coa_code, an inactive
 *      category), because these are exactly the shapes the WIDER audit was
 *      about — data that can post but that finance can't reconcile.
 */
const rules = require("../../src/modules/master/treasury_account/treasury_account.rules");

describe("nextLeafCode — auto-mint of the CoA leaf under a class-5 parent", () => {
  test("BANK (parent 521): first child is 521101, then increments by 1", () => {
    expect(rules.nextLeafCode("521", [])).toBe("521101");
    expect(rules.nextLeafCode("521", ["521101"])).toBe("521102");
    expect(rules.nextLeafCode("521", ["521101", "521105", "521102"])).toBe("521106");
  });

  test("CASH (parent 571): first child is 571101, then increments by 1", () => {
    expect(rules.nextLeafCode("571", [])).toBe("571101");
    expect(rules.nextLeafCode("571", ["571101", "571102"])).toBe("571103");
  });

  test("PETTY CASH (parent 5711, 4-digit): first child is 571110, then increments by 1", () => {
    expect(rules.nextLeafCode("5711", [])).toBe("571110");
    expect(rules.nextLeafCode("5711", ["571110"])).toBe("571111");
    expect(rules.nextLeafCode("5711", ["571110", "571111", "571112"])).toBe("571113");
  });

  test("MTN MoMo (parent 5381, 4-digit): first child is 538110", () => {
    expect(rules.nextLeafCode("5381", [])).toBe("538110");
    expect(rules.nextLeafCode("5381", ["538110", "538111"])).toBe("538112");
  });

  test("Orange Money (parent 5382, 4-digit): starts at 538210, separate pool", () => {
    expect(rules.nextLeafCode("5382", [])).toBe("538210");
    expect(rules.nextLeafCode("5382", ["538210", "538211"])).toBe("538212");
  });

  test("ignores unrelated leaves under the same 3-digit prefix", () => {
    // Under 521 there might also be `521100` reserved elsewhere; we still
    // increment past whatever is highest, so no collision with an existing row.
    expect(rules.nextLeafCode("521", ["521101", "521250"])).toBe("521251");
  });

  test("ignores non-6-digit / non-numeric children", () => {
    expect(rules.nextLeafCode("521", ["521", "521A01", "521101"])).toBe("521102");
  });

  test("refuses a parent that has no room for a 6-digit child", () => {
    expect(() => rules.nextLeafCode("521100", [])).toThrow(/6-digit sub-account/);
  });
});

describe("assertCreate — the shape the create service refuses", () => {
  const bankCat  = { code: "BANK",       is_active: true, requires_custodian: false };
  const pettyCat = { code: "PETTY_CASH", is_active: true, requires_custodian: true };

  test("passes for a well-formed bank account (no custodian, no coa_code)", () => {
    expect(rules.assertCreate({ category: bankCat })).toBe(true);
  });

  test("passes for a petty cash account with a custodian", () => {
    expect(rules.assertCreate({
      category: pettyCat,
      custodianUserId: "00000000-0000-4000-8000-000000000001",
    })).toBe(true);
  });

  test("refuses when category is missing", () => {
    expect(() => rules.assertCreate({ category: null })).toThrow(/category_id is required/);
  });

  test("refuses when category is inactive", () => {
    expect(() => rules.assertCreate({ category: { ...bankCat, is_active: false } }))
      .toThrow(/inactive/);
  });

  test("refuses petty cash without a custodian — the whole point of the audit", () => {
    expect(() => rules.assertCreate({ category: pettyCat }))
      .toThrow(/needs a custodian/);
  });

  test("refuses when the body supplies coa_code — that's the allocator's job", () => {
    expect(() => rules.assertCreate({ category: bankCat, coaCode: "521100" }))
      .toThrow(/auto-minted/);
  });
});

describe("assertCoaParent — a treasury CoA parent must be class 5, non-postable", () => {
  test("passes for a plausible class-5 non-postable parent", () => {
    expect(rules.assertCoaParent({ code: "521", class: 5, is_postable: false })).toBe(true);
    expect(rules.assertCoaParent({ code: "5711", class: 5, is_postable: false })).toBe(true);
  });

  test("refuses a class-4 receivable used as a treasury parent", () => {
    expect(() => rules.assertCoaParent({ code: "411", class: 4, is_postable: false }))
      .toThrow(/class 5/);
  });

  test("refuses a postable leaf used as a parent", () => {
    expect(() => rules.assertCoaParent({ code: "521100", class: 5, is_postable: true }))
      .toThrow(/postable/);
  });

  test("refuses a missing row", () => {
    expect(() => rules.assertCoaParent(null)).toThrow(/not found/);
  });
});

describe("legacy shims — kept so the older tests and the older callers still pass", () => {
  test("assertCashAccount still refuses non-class-5 codes", () => {
    expect(rules.assertCashAccount("521")).toBe(true);
    expect(() => rules.assertCashAccount("411")).toThrow();
  });
  test("assertMomo still requires a network for MoMo kinds", () => {
    expect(rules.assertMomo({ kind: "BANK" })).toBe(true);
    expect(() => rules.assertMomo({ kind: "MOMO" })).toThrow(/network/);
    expect(rules.assertMomo({ kind: "MOMO", momoNetwork: "MTN" })).toBe(true);
  });
});
