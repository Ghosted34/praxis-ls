"use strict";
/**
 * PR-09 — Scalable entity pickers: the server half.
 *
 * The repo has supported `q` search and `registration_status` filtering all
 * along; what the pickers needed was the true match count, so the client could
 * page instead of fetching `?limit=200` and filtering in the browser. These
 * tests pin that contract:
 *
 *   - `repo.listPaged` returns `{ rows, total }` with `_total` stripped;
 *   - the ACTIVE lifecycle filter the pickers send is bound as a parameter
 *     (Decision Q6: only ACTIVE entities for new/current links);
 *   - `service.list` still returns a bare array — the AI tool registry's
 *     `list_entities` is described to the model as returning a list, and the
 *     envelope must not leak into that contract;
 *   - the controller sends `{ data: rows }` unchanged plus `X-Total-Count`,
 *     which is what `useListPaged` reads (the response BODY is not altered, so
 *     every existing consumer keeps working).
 */

const repo = require("../../src/modules/master/corporate_entity/corporate_entity.repo");
const service = require("../../src/modules/master/corporate_entity/corporate_entity.service");
const controller = require("../../src/modules/master/corporate_entity/corporate_entity.controller");

/** A pg client stand-in that records every query and serves fixed rows. */
function fakeClient(rows) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      const statement = { sql: String(sql), params };
      queries.push(statement);
      return { rows: rows.map((r) => ({ ...r, _total: rows.length })), rowCount: rows.length };
    },
  };
}

const ROWS = [
  { entity_id: "e1", code: "ALPHA", legal_name: "Alpha SARL", registration_status: "ACTIVE" },
  { entity_id: "e2", code: "GONE", legal_name: "Gone SARL", registration_status: "DEACTIVATED" },
];

describe("corporate entity list — paged contract (PR-09)", () => {
  it("listPaged returns rows plus the true total, with _total stripped", async () => {
    const c = fakeClient(ROWS);
    const { rows, total } = await repo.listPaged(c, {});
    expect(total).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveProperty("_total");
    expect(rows[0].code).toBe("ALPHA");
  });

  it("binds the lifecycle filter and the search term the pickers send", async () => {
    const c = fakeClient(ROWS);
    await repo.listPaged(c, { registration_status: "ACTIVE", q: "omega" });
    const list = c.queries.find((s) => /FROM corporate_entity/i.test(s.sql));
    expect(list).toBeTruthy();
    // LIST_SQL parameter order: limit, offset, is_active, registration_status,
    // parent, country, q — the two the pickers rely on are asserted here.
    expect(list.params[3]).toBe("ACTIVE");
    expect(list.params[6]).toBe("%omega%");
    // The count rides along in the same statement, not a second query.
    expect(list.sql).toMatch(/COUNT\(\*\) OVER\(\) AS _total/);
  });

  it("keeps page()'s clamping: limit is bounded, offset non-negative", async () => {
    const c = fakeClient(ROWS);
    await repo.listPaged(c, { limit: "9999", offset: "-5" });
    const list = c.queries.find((s) => /FROM corporate_entity/i.test(s.sql));
    expect(list.params[0]).toBe(200); // page() maximum
    expect(list.params[1]).toBe(0);
  });

  it("service.list still returns a bare array (the AI read contract)", async () => {
    const c = fakeClient(ROWS);
    const rows = await service.list(c, {});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("the list route keeps the { data } body and reports the total via X-Total-Count", async () => {
    const c = fakeClient(ROWS);
    const captured = {};
    const res = {
      set: (k, v) => {
        captured[k] = v;
      },
      json: (body) => {
        captured.body = body;
      },
    };
    const req = { query: {}, tenantDb: (fn) => fn(c) };

    await controller.list(req, res, () => {});

    expect(captured["X-Total-Count"]).toBe("2");
    expect(Array.isArray(captured.body.data)).toBe(true);
    expect(captured.body.data).toHaveLength(2);
    // The body carries no envelope — a consumer that predates PR-09, and the
    // AI read above, must see exactly what they always saw.
    expect(captured.body.data[0]).not.toHaveProperty("_total");
    expect(captured.body).not.toHaveProperty("total");
  });
});
