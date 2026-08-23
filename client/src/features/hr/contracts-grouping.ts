import type { Contract } from "@/lib/hr-api";

/**
 * One row per person, not one row per contract.
 *
 * A renewal is a NEW contract row against the SAME employee — that is the
 * point of it (the old contract is what the parties signed and cannot be
 * overwritten). But this table led with the employee's name and gave you
 * nothing else to tell two rows apart: same name, same kind, only the dates
 * moved. Renewing therefore looked like it had duplicated the person.
 *
 * So successive terms of one engagement collapse into their current term, and
 * the superseded ones sit behind a disclosure on that row. Nothing is hidden
 * from the record — an ended contract is one click away and still opens, still
 * prints, still uploads a signed copy.
 *
 * GROUPED BY EMPLOYEE **AND KIND**, not by employee alone: a person can hold an
 * employment contract and, say, a consultancy at the same time, and those are
 * two different agreements that must not fold into each other. Successive
 * EMPLOYMENT contracts are terms of one engagement, and those do.
 *
 * The head is the latest term by `effective_on` — which is the renewal you
 * just raised, not the ended contract you raised it from. A contract with no
 * employee on it groups alone, under its own id; it has no engagement to be a
 * term of.
 */
export type ContractGroup = {
  key: string;
  head: Contract;
  history: Contract[];
};

export function groupContracts(rows: Contract[] | null): ContractGroup[] {
  const by = new Map<string, Contract[]>();
  for (const c of rows || []) {
    const key = c.employee_id
      ? `${c.employee_id}::${c.kind || ""}`
      : `solo::${c.hr_contract_id}`;
    const list = by.get(key);
    if (list) list.push(c);
    else by.set(key, [c]);
  }
  return Array.from(by, ([key, list]) => {
    const sorted = [...list].sort((a, b) => {
      // Undated last: a term with no start cannot be the current one.
      if (!a.effective_on || !b.effective_on)
        return (b.effective_on ? 1 : 0) - (a.effective_on ? 1 : 0);
      if (a.effective_on !== b.effective_on)
        return a.effective_on < b.effective_on ? 1 : -1;
      return a.hr_contract_id < b.hr_contract_id ? 1 : -1;
    });
    return { key, head: sorted[0], history: sorted.slice(1) };
  });
}
