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
    expect(rules.nextLeafCode("521", ["521101", "521105", "521102"])).toBe(
      "521106",
    );
  });

  test("CASH (parent 571): first child is 571101, then increments by 1", () => {
    expect(rules.nextLeafCode("571", [])).toBe("571101");
    expect(rules.nextLeafCode("571", ["571101", "571102"])).toBe("571103");
  });

  test("PETTY CASH (parent 5711, 4-digit): first child is 571110, then increments by 1", () => {
    expect(rules.nextLeafCode("5711", [])).toBe("571110");
    expect(rules.nextLeafCode("5711", ["571110"])).toBe("571111");
    expect(rules.nextLeafCode("5711", ["571110", "571111", "571112"])).toBe(
      "571113",
    );
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
    expect(rules.nextLeafCode("521", ["521", "521A01", "521101"])).toBe(
      "521102",
    );
  });

  test("refuses a parent that has no room for a 6-digit child", () => {
    expect(() => rules.nextLeafCode("521100", [])).toThrow(
      /6-digit sub-account/,
    );
  });
});

describe("assertCreate — the shape the create service refuses", () => {
  const bankCat = { code: "BANK", is_active: true, requires_custodian: false };
  const pettyCat = {
    code: "PETTY_CASH",
    is_active: true,
    requires_custodian: true,
  };

  test("passes for a well-formed bank account (no custodian, no coa_code)", () => {
    expect(rules.assertCreate({ category: bankCat })).toBe(true);
  });

  test("passes for a petty cash account with a custodian", () => {
    expect(
      rules.assertCreate({
        category: pettyCat,
        custodianUserId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toBe(true);
  });

  test("refuses when category is missing", () => {
    expect(() => rules.assertCreate({ category: null })).toThrow(
      /category_id is required/,
    );
  });

  test("refuses when category is inactive", () => {
    expect(() =>
      rules.assertCreate({ category: { ...bankCat, is_active: false } }),
    ).toThrow(/inactive/);
  });

  test("refuses petty cash without a custodian — the whole point of the audit", () => {
    expect(() => rules.assertCreate({ category: pettyCat })).toThrow(
      /needs a custodian/,
    );
  });

  test("refuses when the body supplies coa_code — that's the allocator's job", () => {
    expect(() =>
      rules.assertCreate({ category: bankCat, coaCode: "521100" }),
    ).toThrow(/auto-minted/);
  });
});

describe("assertCoaParent — a treasury CoA parent must be class 5, non-postable", () => {
  test("passes for a plausible class-5 non-postable parent", () => {
    expect(
      rules.assertCoaParent({ code: "521", class: 5, is_postable: false }),
    ).toBe(true);
    expect(
      rules.assertCoaParent({ code: "5711", class: 5, is_postable: false }),
    ).toBe(true);
  });

  test("refuses a class-4 receivable used as a treasury parent", () => {
    expect(() =>
      rules.assertCoaParent({ code: "411", class: 4, is_postable: false }),
    ).toThrow(/class 5/);
  });

  test("refuses a postable leaf used as a parent", () => {
    expect(() =>
      rules.assertCoaParent({ code: "521100", class: 5, is_postable: true }),
    ).toThrow(/postable/);
  });

  test("refuses a missing row", () => {
    expect(() => rules.assertCoaParent(null)).toThrow(/not found/);
  });
});

describe("assertCoaParent — audit repair verification (#30, #31)", () => {
  test("accepts 571, 581, 5381, 5382, 5711 when non-postable", () => {
    for (const code of ["571", "581", "5381", "5382", "5711"]) {
      expect(rules.assertCoaParent({ code, class: 5, is_postable: false })).toBe(true);
    }
  });

  test("rejects if postable flag is still true", () => {
    for (const code of ["571", "581", "5381", "5382", "5711"]) {
      expect(() => rules.assertCoaParent({ code, class: 5, is_postable: true })).toThrow(/postable/);
    }
  });
});

describe("category safety — freezing capability & coa_parent once accounts exist (#33, #35)", () => {
  const catService = require("../../src/modules/master/treasury_category/treasury_category.service");
  const catRepo = require("../../src/modules/master/treasury_category/treasury_category.repo");

  test("refuses CoA parent change if category is in use", async () => {
    jest.spyOn(catRepo, "get").mockResolvedValue({
      treasury_category_id: "cat-1",
      code: "CUSTOM",
      coa_parent_code: "521",
      is_system: false,
      requires_custodian: false,
    });
    jest.spyOn(catRepo, "countUsage").mockResolvedValue(3);

    await expect(
      catService.update({}, { id: "cat-1", patch: { coa_parent_code: "571" } })
    ).rejects.toThrow(/Cannot change CoA parent/);

    catRepo.get.mockRestore();
    catRepo.countUsage.mockRestore();
  });

  test("refuses capability flag changes if category is in use", async () => {
    jest.spyOn(catRepo, "get").mockResolvedValue({
      treasury_category_id: "cat-1",
      code: "CUSTOM",
      coa_parent_code: "521",
      is_system: false,
      requires_custodian: false,
      is_bank_identity: true,
      is_momo_identity: false,
    });
    jest.spyOn(catRepo, "countUsage").mockResolvedValue(2);

    await expect(
      catService.update({}, { id: "cat-1", patch: { requires_custodian: true } })
    ).rejects.toThrow(/Cannot change capability flags/);

    catRepo.get.mockRestore();
    catRepo.countUsage.mockRestore();
  });
});

describe("assertVerificationPrerequisites — Audit #7", () => {
  test("passes for complete bank identity", () => {
    expect(
      rules.assertVerificationPrerequisites({
        category_is_bank_identity: true,
        bank_name: "Ecobank",
        account_number: "1234567890",
        iban: "CM2110005000012345678901234",
      }),
    ).toBe(true);
  });

  test("refuses bank account without account number or bank name", () => {
    expect(() =>
      rules.assertVerificationPrerequisites({
        category_is_bank_identity: true,
        bank_name: null,
        account_number: "1234567890",
      }),
    ).toThrow(/missing bank_name/);
  });

  test("passes for complete MoMo identity", () => {
    expect(
      rules.assertVerificationPrerequisites({
        category_is_momo_identity: true,
        momo_number: "+237670000000",
        momo_network: "MTN",
      }),
    ).toBe(true);
  });

  test("refuses MoMo account without network", () => {
    expect(() =>
      rules.assertVerificationPrerequisites({
        category_is_momo_identity: true,
        momo_number: "+237670000000",
        momo_network: null,
      }),
    ).toThrow(/missing momo_network/);
  });

  test("passes for complete petty cash", () => {
    expect(
      rules.assertVerificationPrerequisites({
        category_requires_custodian: true,
        custodian_user_id: "00000000-0000-4000-8000-000000000001",
        float_limit: 500000,
      }),
    ).toBe(true);
  });

  test("refuses petty cash without float limit or custodian", () => {
    expect(() =>
      rules.assertVerificationPrerequisites({
        category_requires_custodian: true,
        custodian_user_id: null,
        float_limit: null,
      }),
    ).toThrow(/missing custodian_user_id, float_limit/);
  });
});

describe("opening balance correction — Audit #13", () => {
  test("allows correction without reason when account has no posted journals", () => {
    expect(
      rules.assertOpeningBalanceCorrection({ hasJournals: false, reason: null }),
    ).toBe(true);
  });

  test("requires reason when correcting account with posted journals", () => {
    expect(() =>
      rules.assertOpeningBalanceCorrection({ hasJournals: true, reason: null }),
    ).toThrow(/requires an explanation/);
    expect(
      rules.assertOpeningBalanceCorrection({
        hasJournals: true,
        reason: "Auditor approved adjustment",
      }),
    ).toBe(true);
  });
});

describe("primary account deactivation safety — Audit #12", () => {
  const accService = require("../../src/modules/master/treasury_account/treasury_account.service");
  const accRepo = require("../../src/modules/master/treasury_account/treasury_account.repo");

  test("blocks deactivation of primary account without replacement or explicit confirmation", async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    jest.spyOn(accRepo, "get").mockResolvedValue({
      treasury_account_id: "acc-1",
      is_primary: true,
      category_id: "cat-1",
    });

    await expect(
      accService.setActive(mockClient, { id: "acc-1", active: false })
    ).rejects.toThrow(/Cannot deactivate primary account/);

    accRepo.get.mockRestore();
  });
});

/*
 * PR-10 / A1 — the primary flag is ONE per ENTITY.
 *
 * `clearPrimaryInCategory` scoped the swap to (entity_id, category_id), so an
 * entity with a BANK, a CASH and a MOMO account could hold three "primaries"
 * at once — and the corporate-entity letterhead, which needs ONE account to
 * print in its payment block, could not say which one an invoice should be
 * paid into. These pin the SQL the swap now runs: scoped to the ENTITY, with
 * no category_id anywhere in the statement, on both the dedicated endpoint
 * and the generic PATCH that could otherwise reintroduce the defect.
 */
describe("primary is per-ENTITY, not per-category — PR-10 / A1", () => {
  const accService = require("../../src/modules/master/treasury_account/treasury_account.service");
  const accRepo = require("../../src/modules/master/treasury_account/treasury_account.repo");
  const { logger } = require("../../src/config/logger");

  /** A client that records every SQL statement it is handed. */
  function recordingClient() {
    const sql = [];
    return {
      sql,
      query: jest.fn(async (text, _params) => {
        sql.push(String(text));
        if (/COUNT\(\*\)/.test(String(text))) return { rows: [{ n: 0 }] };
        return { rows: [], rowCount: 0 };
      }),
    };
  }

  afterEach(() => jest.restoreAllMocks());

  test("POST /:id/primary clears every other primary FOR THE ENTITY — no category in the statement", async () => {
    jest.spyOn(accRepo, "get").mockResolvedValue({
      treasury_account_id: "acc-2", entity_id: "ent-1", category_id: "cat-bank", is_primary: false,
    });
    jest.spyOn(accRepo, "update").mockResolvedValue({ treasury_account_id: "acc-2", is_primary: true });
    jest.spyOn(accRepo, "getWithCategory").mockResolvedValue({ treasury_account_id: "acc-2" });
    const client = recordingClient();

    await accService.setPrimary(client, { id: "acc-2", actor: {} });

    const clear = client.sql.find((s) => s.includes("SET is_primary = false"));
    expect(clear).toBeTruthy();
    expect(clear).toMatch(/WHERE entity_id = \$1 AND treasury_account_id <> \$2 AND is_primary = true/);
    // The category scope is GONE — that is the defect being fixed.
    expect(clear).not.toContain("category_id");
    // One transaction around the whole swap.
    expect(client.sql).toContain("BEGIN");
    expect(client.sql).toContain("COMMIT");
  });

  test("a PATCH cannot move the primary flag at all — UPDATE_FIELDS excludes it", async () => {
    // The flag changes only through the dedicated atomic endpoints; the
    // generic write path filtering it out is what keeps the entity-wide
    // clearing honest. If someone re-adds is_primary to UPDATE_FIELDS, this
    // fails and the transaction wrapper must come back with it.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../src/modules/master/treasury_account/treasury_account.service.js"),
      "utf8",
    );
    const updateFields = src.match(/const UPDATE_FIELDS = \[([\s\S]*?)\];/)[1];
    expect(updateFields).not.toMatch(/\bis_primary\b/);
  });

  test("deactivating the primary with forceClearPrimary clears it, commits, then WARNS — never fails", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    jest.spyOn(accRepo, "get").mockResolvedValue({
      treasury_account_id: "acc-4", entity_id: "ent-1", category_id: "cat-bank",
      is_primary: true, is_verified: false, coa_code: null, label: "Bank",
    });
    jest.spyOn(accRepo, "update").mockResolvedValue({ treasury_account_id: "acc-4", is_primary: false, is_active: false });
    jest.spyOn(accRepo, "getWithCategory").mockResolvedValue({ treasury_account_id: "acc-4" });
    const client = recordingClient();

    // Must not throw — "no primary" is a legal state, surfaced as a warning
    // after the commit so the deactivation itself cannot be half-applied.
    await expect(
      accService.setActive(client, { id: "acc-4", active: false, forceClearPrimary: true }),
    ).resolves.toBeTruthy();
    expect(client.sql).toContain("COMMIT");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: "ent-1" }),
      expect.stringContaining("no primary account"),
    );
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
