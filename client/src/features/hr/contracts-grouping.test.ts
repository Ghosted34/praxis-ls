/**
 * One row per person on the Contracts screen.
 *
 * The bug this pins: renewing a contract creates a NEW contract row against the
 * SAME employee — correct, since the old contract is what the parties signed
 * and must survive — but the table led with the employee's name and gave you
 * nothing else to tell the two rows apart. Renewing looked like it had
 * duplicated the person. `groupContracts` collapses successive terms of one
 * engagement into their current term.
 */
import { describe, it, expect } from "vitest";
import { groupContracts } from "./contracts-grouping";
import type * as api from "@/lib/hr-api";

const c = (over: Partial<api.Contract> & { hr_contract_id: string }) =>
  ({
    employee_id: "e-1",
    employee_name: "JBS Praxis",
    kind: "EMPLOYMENT",
    status: "SIGNED",
    ...over,
  }) as api.Contract;

describe("groupContracts", () => {
  it("folds a renewal and the contract it superseded into one row", () => {
    const groups = groupContracts([
      c({
        hr_contract_id: "old",
        effective_on: "2026-08-16",
        end_on: "2036-08-16",
        status: "ENDED",
      }),
      c({
        hr_contract_id: "new",
        effective_on: "2026-08-23",
        end_on: "2046-08-18",
        status: "DRAFT",
      }),
    ]);
    expect(groups).toHaveLength(1);
    // The head is the term you just raised, not the one you raised it from.
    expect(groups[0].head.hr_contract_id).toBe("new");
    expect(groups[0].history.map((h) => h.hr_contract_id)).toEqual(["old"]);
  });

  it("keeps two different KINDS apart — they are separate agreements", () => {
    // An employment contract and a consultancy held at the same time are not
    // successive terms of one engagement and must not fold together.
    const groups = groupContracts([
      c({ hr_contract_id: "emp", effective_on: "2026-01-01" }),
      c({
        hr_contract_id: "con",
        effective_on: "2026-02-01",
        kind: "CONSULTANCY",
      }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("keeps two different people apart", () => {
    const groups = groupContracts([
      c({ hr_contract_id: "a", effective_on: "2026-01-01" }),
      c({
        hr_contract_id: "b",
        effective_on: "2026-01-01",
        employee_id: "e-2",
      }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("gives a contract with no employee a row of its own", () => {
    // It has no engagement to be a term of, so it cannot join one — and two of
    // them must not collapse into each other on a shared null key.
    const groups = groupContracts([
      c({ hr_contract_id: "x", employee_id: null, employee_name: null }),
      c({ hr_contract_id: "y", employee_id: null, employee_name: null }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("sorts an undated term below a dated one rather than letting it lead", () => {
    const groups = groupContracts([
      c({ hr_contract_id: "undated", effective_on: null }),
      c({ hr_contract_id: "dated", effective_on: "2026-01-01" }),
    ]);
    expect(groups[0].head.hr_contract_id).toBe("dated");
  });

  it("orders three terms newest first, so history reads backwards in time", () => {
    const groups = groupContracts([
      c({ hr_contract_id: "first", effective_on: "2024-01-01" }),
      c({ hr_contract_id: "third", effective_on: "2026-01-01" }),
      c({ hr_contract_id: "second", effective_on: "2025-01-01" }),
    ]);
    expect(groups[0].head.hr_contract_id).toBe("third");
    expect(groups[0].history.map((h) => h.hr_contract_id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("survives a null rows payload", () => {
    expect(groupContracts(null)).toEqual([]);
  });
});
