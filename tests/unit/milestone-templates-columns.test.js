"use strict";

/**
 * Regression — milestone templates list must reference REAL service_type
 * columns.
 *
 * Deployed error (2026-08-18): `column st.code does not exist` on
 * GET /api/tenant/milestones/templates. The query selected `st.code` and
 * `st.name`, but service_type (0310) has `key`, `name_fr`, `name_en` — no
 * `code`, no `name`. Every other read in the codebase uses st.key / st.name_fr
 * / st.name_en; this pins the list query to those real columns so a future
 * edit cannot re-introduce a phantom column that only blows up at runtime.
 */

const repo = require("../../src/modules/operations/milestone/milestone.repo");

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(),
  audit: jest.fn(),
  resolveActorId: jest.fn(),
}));

/** A fake client that records the SQL and returns staged rows. */
function fakeClient() {
  const queries = [];
  const c = {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM milestone_template t/.test(sql))
        return { rows: [{ milestone_template_id: "t-1", is_active: true, service_type_code: "SEA_FREIGHT_IMPORT", service_type_name: "Sea freight import", stage_count: 2 }] };
      if (/FROM milestone_template_stage/.test(sql))
        return { rows: [{ milestone_template_stage_id: "s-1" }, { milestone_template_stage_id: "s-2" }] };
      return { rows: [] };
    },
  };
  return c;
}

describe("milestone templates — real service_type columns (regression)", () => {
  it("selects st.key (not st.code) and COALESCE(name_en, name_fr) (not st.name)", async () => {
    const c = fakeClient();
    await repo.listTemplates(c, {});
    const sql = c.queries.find((q) => /FROM milestone_template t/.test(q.sql)).sql;
    expect(sql).toContain("st.key AS service_type_code");
    expect(sql).toContain("COALESCE(st.name_en, st.name_fr) AS service_type_name");
    // The phantom columns that caused the 42P01 must never appear.
    expect(sql).not.toContain("st.code");
    expect(sql).not.toContain("st.name AS");
  });

  it("returns templates with their stages attached", async () => {
    const c = fakeClient();
    const out = await repo.listTemplates(c, {});
    expect(out[0].service_type_code).toBe("SEA_FREIGHT_IMPORT");
    expect(out[0].service_type_name).toBe("Sea freight import");
    expect(out[0].stages).toHaveLength(2);
  });
});
