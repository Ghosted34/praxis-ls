/**
 * THE MATRICULE — `employee.staff_no`, allocated per corporate entity.
 *
 * The contract assigns one ("Le matricule SLAS-137 lui est attribué"), so it has
 * to exist before the contract can be written and it has to be stable
 * afterwards. It is allocated, never typed: a number a human chooses is a number
 * two humans eventually choose.
 *
 * The properties worth pinning are all about what happens under contention and
 * around imported data, which is exactly what a fake client can express and a
 * live database cannot express cheaply.
 */
"use strict";

const repo = require("../../src/modules/master/employees/employees.repo");

/**
 * A client backed by a real counter, so the ON CONFLICT DO UPDATE semantics are
 * modelled rather than stubbed: `next_no` holds the next FREE number and the
 * statement returns it AFTER incrementing.
 */
function fakeClient({ entityCode = "SLAS", taken = [] } = {}) {
  const seq = new Map();
  const queries = [];
  return {
    queries,
    seq,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM corporate_entity/i.test(sql)) {
        return { rows: entityCode ? [{ code: entityCode }] : [] };
      }
      if (/INSERT INTO employee_number_sequence/i.test(sql)) {
        const [key, prefix] = params;
        const next = (seq.get(key) ?? 1) + 1;
        seq.set(key, next);
        return { rows: [{ prefix, next_no: next }] };
      }
      if (/FROM employee WHERE staff_no/i.test(sql)) {
        return { rows: taken.includes(params[0]) ? [{ n: 1 }] : [] };
      }
      return { rows: [] };
    },
  };
}

describe("allocating a matricule", () => {
  test("the first hire in an entity is 001, prefixed from the entity code", async () => {
    const c = fakeClient();
    expect(await repo.allocateStaffNo(c, { entity_id: "ent-1" })).toBe("SLAS-001");
  });

  test("successive hires increment, and never repeat", async () => {
    const c = fakeClient();
    const got = [];
    for (let i = 0; i < 5; i += 1) {
      got.push(await repo.allocateStaffNo(c, { entity_id: "ent-1" }));
    }
    expect(got).toEqual(["SLAS-001", "SLAS-002", "SLAS-003", "SLAS-004", "SLAS-005"]);
    expect(new Set(got).size).toBe(5);
  });

  test("each entity counts separately — two companies both start at 001", async () => {
    const c = fakeClient();
    const a = await repo.allocateStaffNo(c, { entity_id: "ent-1" });
    const b = await repo.allocateStaffNo(c, { entity_id: "ent-2" });
    expect([a, b]).toEqual(["SLAS-001", "SLAS-001"]);
    // Distinct counters, keyed by entity.
    expect([...c.seq.keys()].sort()).toEqual(["ent-1", "ent-2"]);
  });

  test("an employee attached to no entity gets its own bucket, not a NULL key", async () => {
    // NULL is not a value you can conflict on, so "no entity" has to be ONE
    // named bucket or the sequence silently stops being a sequence.
    const c = fakeClient();
    expect(await repo.allocateStaffNo(c, {})).toBe("EMP-001");
    expect([...c.seq.keys()]).toEqual(["*"]);
  });

  test("an entity with no code still produces a usable series", async () => {
    const c = fakeClient({ entityCode: null });
    expect(await repo.allocateStaffNo(c, { entity_id: "ent-1" })).toBe("EMP-001");
  });

  test("allocation is ONE statement, so two clerks cannot be handed one number", async () => {
    // The property that matters under contention: the read and the increment
    // are the same round trip. A SELECT-then-UPDATE would pass every test above
    // and still collide in production, so this asserts the shape.
    const c = fakeClient();
    await repo.allocateStaffNo(c, { entity_id: "ent-1" });
    const alloc = c.queries.find((q) => /employee_number_sequence/i.test(q.sql));
    expect(alloc.sql).toMatch(/ON CONFLICT \(sequence_key\) DO UPDATE/i);
    expect(alloc.sql).toMatch(/RETURNING/i);
    expect(c.queries.filter((q) => /employee_number_sequence/i.test(q.sql))).toHaveLength(1);
  });

  test("a number already typed by hand is skipped, not fought over", async () => {
    // An imported record holding SLAS-001 must not fail the next hire.
    const c = fakeClient({ taken: ["SLAS-001", "SLAS-002"] });
    expect(await repo.allocateStaffNo(c, { entity_id: "ent-1" })).toBe("SLAS-003");
  });

  test("it gives up rather than inventing a number outside the series", async () => {
    // 25 consecutive numbers taken by hand is a data problem, and quietly
    // stepping outside the series would hide it. The hire still saves — the
    // record simply has no matricule, which readiness then reports.
    const taken = Array.from({ length: 40 }, (_, i) => `SLAS-${String(i + 1).padStart(3, "0")}`);
    const c = fakeClient({ taken });
    expect(await repo.allocateStaffNo(c, { entity_id: "ent-1" })).toBeNull();
  });
});
