/**
 * THE SELF LOCK on `/employees/mine`.
 *
 * These endpoints take NO MOD-02 grant, which is the whole reason they exist:
 * requiring one would mean handing every member of staff the entire roster,
 * salaries and bank blocks included, so they could correct their own phone
 * number. That makes the scoping the only thing standing between a person and
 * everyone else's record, so it is what this file tests.
 *
 * Two properties, and both are structural rather than incidental:
 *
 *   1. The employee id comes from the SESSION. There is no id parameter to
 *      tamper with and none to enumerate.
 *   2. The writable fields are an ALLOW-LIST. A denylist would silently grant
 *      every column added later, which is how `base_salary` becomes
 *      self-editable the day someone adds a column next to it.
 */
"use strict";

const self = require("../../src/modules/master/employees/employees.self");
const validator = require("../../src/modules/master/employees/employees.validator");

/** A client that records every query and answers the two this module makes. */
function fakeClient({ linkedEmployeeId = "emp-1", row = null } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM app_user/i.test(sql)) {
        return { rows: linkedEmployeeId ? [{ employee_id: linkedEmployeeId }] : [] };
      }
      return { rows: row ? [row] : [] };
    },
  };
}

const ROW = {
  employee_id: "emp-1",
  full_name: "Line Audrey HAPPY",
  job_title: "Care Business Partner",
  department: "Client Care",
  email: "line.happy@smartls.cm",
  phone_desk: "+237 233-420-281",
  phone_mobile: "+237 657-133-028",
  entity_id: "ent-1",
  is_active: true,
  // Present on the row and NOT in READABLE — the projection must drop these.
  base_salary: 900000,
  bank_block: { iban: "CM21..." },
  risk_class_rate: 0.0175,
  cnps_number: "CNPS-9",
};

describe("resolving whose record it is", () => {
  test("the employee id is read from the session's user id", async () => {
    const c = fakeClient();
    const id = await self.employeeIdForUser(c, "user-42");
    expect(id).toBe("emp-1");
    // The lock: the ONLY input to the lookup is the session user id.
    expect(c.queries[0].params).toEqual(["user-42"]);
    expect(c.queries[0].sql).toMatch(/WHERE user_id = \$1/);
  });

  test("no user id resolves to nobody rather than to anybody", async () => {
    const c = fakeClient();
    expect(await self.employeeIdForUser(c, null)).toBeNull();
    expect(c.queries).toHaveLength(0);
  });

  /** A system account or an external auditor has no staff record. That is a
   *  state to render, not a 404 that reads as a bug. */
  test("an unlinked account reads as unlinked, not as an error", async () => {
    const c = fakeClient({ linkedEmployeeId: null });
    await expect(self.getMine(c, { actor: { user_id: "u" } }))
      .resolves.toEqual({ linked: false, employee: null });
  });
});

describe("what a person may READ about themselves", () => {
  test("the projection drops salary, bank details and everything else unlisted", async () => {
    const c = fakeClient({ row: ROW });
    const { employee } = await self.getMine(c, { actor: { user_id: "u" } });
    expect(employee.full_name).toBe("Line Audrey HAPPY");
    expect(employee.phone_desk).toBe("+237 233-420-281");
    expect(employee).not.toHaveProperty("base_salary");
    expect(employee).not.toHaveProperty("bank_block");
    expect(employee).not.toHaveProperty("risk_class_rate");
    expect(employee).not.toHaveProperty("cnps_number");
  });

  test("the readable set is exactly the declared list", async () => {
    const c = fakeClient({ row: ROW });
    const { employee } = await self.getMine(c, { actor: { user_id: "u" } });
    expect(Object.keys(employee).sort()).toEqual([...self.READABLE].sort());
  });
});

describe("what a person may WRITE about themselves", () => {
  test("only the phone columns are editable", () => {
    expect(self.EDITABLE).toEqual(["phone_desk", "phone_mobile"]);
  });

  /**
   * The one that matters. Someone POSTing a job title or a salary must not have
   * it applied — a staff member who could edit their own title could put
   * "Director" in the signature on every email they send.
   */
  test("a patch naming an unlisted column is refused by the validator", () => {
    const bad = validator.schemas.updateMine.safeParse({
      phone_desk: "+237 1", job_title: "Director", base_salary: 9e9,
    });
    expect(bad.success).toBe(false);
  });

  test("and is stripped by the service even if a route forgot the validator", async () => {
    const captured = [];
    const service = require("../../src/modules/master/employees/employees.service");
    const spy = jest.spyOn(service, "update").mockImplementation(async (_c, args) => {
      captured.push(args);
      return ROW;
    });
    try {
      const c = fakeClient({ row: ROW });
      await self.updateMine(c, {
        patch: { phone_desk: "+237 1", job_title: "Director", base_salary: 9e9 },
        actor: { user_id: "u" },
      });
      expect(captured[0].patch).toEqual({ phone_desk: "+237 1" });
      // And the id it writes is the resolved one, never anything from the patch.
      expect(captured[0].id).toBe("emp-1");
    } finally {
      spy.mockRestore();
    }
  });

  test("an empty string clears a number rather than storing a blank", async () => {
    const captured = [];
    const service = require("../../src/modules/master/employees/employees.service");
    const spy = jest.spyOn(service, "update").mockImplementation(async (_c, args) => {
      captured.push(args);
      return ROW;
    });
    try {
      const c = fakeClient({ row: ROW });
      await self.updateMine(c, { patch: { phone_mobile: "" }, actor: { user_id: "u" } });
      expect(captured[0].patch).toEqual({ phone_mobile: null });
    } finally {
      spy.mockRestore();
    }
  });

  test("a patch with nothing writable is a 422, not a silent no-op", async () => {
    const c = fakeClient({ row: ROW });
    await expect(
      self.updateMine(c, { patch: { job_title: "Director" }, actor: { user_id: "u" } }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("an unlinked account cannot write", async () => {
    const c = fakeClient({ linkedEmployeeId: null });
    await expect(
      self.updateMine(c, { patch: { phone_desk: "1" }, actor: { user_id: "u" } }),
    ).rejects.toMatchObject({ status: 422, code: "NO_EMPLOYEE" });
  });
});
