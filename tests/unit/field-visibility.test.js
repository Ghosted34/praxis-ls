"use strict";
/**
 * Step 3 — field-level confidentiality is ENFORCED on responses (PRD §5.6/§7.3),
 * not just stored. The masker nulls mapped properties for the caller's masked
 * field_keys; the HTTP helper resolves those keys from field_visibility.
 */
jest.mock("../../src/shared/cache/identity-cache", () => ({
  getMaskedFieldKeys: jest.fn(),
}));
const identity = require("../../src/shared/cache/identity-cache");
const { maskData, maskForUser } = require("../../src/shared/rbac/field-mask");

describe("maskData (pure)", () => {
  it("nulls salary fields when employee.salary is masked", () => {
    const emp = { full_name: "A", base_salary: 500000, bank_block: "IBAN..", job_title: "Ops" };
    const r = maskData(emp, ["employee.salary"]);
    expect(r.base_salary).toBeNull();
    expect(r.bank_block).toBeNull();
    expect(r.full_name).toBe("A");     // non-sensitive preserved
    expect(r.job_title).toBe("Ops");
  });

  it("masks margin inside a nested dossier-360 money block, leaves cost visible", () => {
    const view = { dossier: { ref: "OF-1" }, costs: { actual_cost: 700000 }, economics: { billed_ttc: 1000000, actual_cost: 700000, gross_margin: 300000, margin_percent: 30 } };
    const r = maskData(view, ["dossier.margin"]);
    expect(r.economics.gross_margin).toBeNull();
    expect(r.economics.margin_percent).toBeNull();
    expect(r.economics.billed_ttc).toBe(1000000);  // revenue still visible
    expect(r.costs.actual_cost).toBe(700000);        // Sales/Ops see cost-incurred, not margin
  });

  it("masks every row of a list", () => {
    const rows = [{ full_name: "A", base_salary: 1 }, { full_name: "B", base_salary: 2 }];
    const r = maskData(rows, ["employee.salary"]);
    expect(r.map((x) => x.base_salary)).toEqual([null, null]);
  });

  it("no masked keys → data returned unchanged", () => {
    const emp = { base_salary: 500000 };
    expect(maskData(emp, [])).toEqual(emp);
  });
});

describe("maskForUser (HTTP boundary)", () => {
  afterEach(() => jest.clearAllMocks());

  it("resolves the caller's masked keys and applies them", async () => {
    identity.getMaskedFieldKeys.mockResolvedValue(["employee.salary"]);
    const r = await maskForUser({}, { user_id: "u1" }, { full_name: "A", base_salary: 900000 });
    expect(identity.getMaskedFieldKeys).toHaveBeenCalledWith({}, "u1");
    expect(r.base_salary).toBeNull();
    expect(r.full_name).toBe("A");
  });

  it("CEO is unrestricted (no masking, no lookup)", async () => {
    const r = await maskForUser({}, { user_id: "ceo", is_ceo: true }, { base_salary: 900000 });
    expect(r.base_salary).toBe(900000);
    expect(identity.getMaskedFieldKeys).not.toHaveBeenCalled();
  });
});
