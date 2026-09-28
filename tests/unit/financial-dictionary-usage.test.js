"use strict";
/**
 * The dictionary 360's usage drill-ins — GET /financial-dictionary/:id/usage/:kind.
 *
 * The five tiles on a line's 360 (Costings, Cash requests, Invoices, Purchase
 * orders, Rates) were counts that opened nothing. Each now opens a paged list
 * of the rows it counts. What is worth pinning here:
 *
 *   - the list reads the SAME table and filter as the tile's count, so the
 *     number the reader clicked is the total the dialog pages through;
 *   - the true total rides on `X-Total-Count`, not the page length;
 *   - the rows name clients and amounts that belong to other modules, so each
 *     document list needs that module's own view grant — the tile count does
 *     not, and the drill must not be a side door around it;
 *   - invoices are two modules, and the list narrows to the types the viewer
 *     may open instead of refusing them whole;
 *   - rates carry no extra gate (Cost & evolution already shows them) and are
 *     marked in force by the same rule that tab uses.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { user_id: "11111111-1111-1111-1111-111111111111" };
    next();
  },
}));
// A grant list per request (`x-grants: MOD-05:view,MOD-46:view`), read by the
// route gate and by the controller's per-list check alike.
jest.mock("../../src/middleware/rbac", () => {
  const { AppError } = jest.requireActual("../../src/utils/errors");
  const held = (req) => String(req.headers["x-grants"] || "").split(",");
  return {
    requirePermission: (mod, action) => (req, _res, next) =>
      held(req).includes(`${mod}:${action}`)
        ? next()
        : next(new AppError("PERMISSION_DENIED", `No permission for ${mod}.${action}`, 403)),
    readPermissions: async (req, specs) => specs.map(([m, a]) => held(req).includes(`${m}:${a}`)),
  };
});

const { router } = require("../../src/modules/master/financial_dictionary/financial_dictionary.routes");
const repo = require("../../src/modules/master/financial_dictionary/financial_dictionary.repo");
const rules = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");
const { errorHandler } = require("../../src/middleware/error-handler");

const ITEM = "22222222-2222-2222-2222-222222222222";
const MISSING = "33333333-3333-3333-3333-333333333333";

/** Every query the request ran, and a canned answer: the item exists (unless it
 *  is MISSING) and a usage list returns two rows of a total of 57. */
let queries;
function fakeClient() {
  return {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM dictionary_item WHERE/.test(sql)) {
        return { rows: params[0] === MISSING ? [] : [{ dictionary_item_id: ITEM }] };
      }
      if (/FROM expense_rate er/.test(sql)) {
        return {
          rows: [
            { row_id: "r1", rate: "150000.00", effective_from: "2026-01-01", effective_to: null, _total: "2" },
            { row_id: "r0", rate: "120000.00", effective_from: "2025-01-01", effective_to: "2025-12-31", _total: "2" },
          ],
        };
      }
      return {
        rows: [
          { row_id: "l1", doc_id: "d1", doc_number: "CST-2026-0043", party_name: "Acme SARL", dossier_ref: "SLAS-2026-0007", _total: "57" },
          { row_id: "l2", doc_id: "d2", doc_number: "CST-2026-0041", party_name: "Beta SA", dossier_ref: null, _total: "57" },
        ],
      };
    },
  };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.tenantDb = (fn) => fn(fakeClient());
    next();
  });
  a.use(router);
  a.use(errorHandler);
  return a;
}

const get = (kind, grants, qs = "", id = ITEM) =>
  request(app()).get(`/${id}/usage/${kind}${qs}`).set("x-grants", grants.join(","));

/** The usage SELECT the request ran — not the item lookup. */
const usageQuery = () => queries.find((q) => !/FROM dictionary_item WHERE/.test(q.sql));

beforeEach(() => {
  queries = [];
});

describe("routing", () => {
  test("a kind that is not one of the five tiles is a 404, and runs no query", async () => {
    const res = await get("journal_lines", ["MOD-05:view", "MOD-46:view"]);
    expect(res.status).toBe(404);
    expect(queries).toHaveLength(0);
  });

  test("the dictionary's own view grant still opens the route at all", async () => {
    const res = await get("rates", ["MOD-46:view"]);
    expect(res.status).toBe(403);
  });

  test("an item that does not exist is a 404, not an empty list", async () => {
    const res = await get("costings", ["MOD-05:view", "MOD-46:view"], "", MISSING);
    expect(res.status).toBe(404);
  });

  test("a page larger than the ceiling is refused rather than silently clamped", async () => {
    const res = await get("costings", ["MOD-05:view", "MOD-46:view"], "?limit=500");
    expect(res.status).toBe(422);
  });
});

describe("one page, and the true total", () => {
  test("rows come back without the window column, the total on X-Total-Count", async () => {
    const res = await get("costings", ["MOD-05:view", "MOD-46:view"], "?limit=20&offset=40");
    expect(res.status).toBe(200);
    expect(res.headers["x-total-count"]).toBe("57");
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ doc_number: "CST-2026-0043", party_name: "Acme SARL" });
    expect(res.body.data[0]).not.toHaveProperty("_total");
    // The item, then the page — the dialog's third page of twenty.
    expect(usageQuery().params.slice(0, 3)).toEqual([ITEM, 20, 40]);
  });
});

describe("each document list needs the grant of the module that owns it", () => {
  test.each([
    ["costings", "MOD-46"],
    ["cash_requests", "MOD-49"],
    ["purchase_orders", "MOD-60"],
  ])("%s: refused on the dictionary grant alone, listed with %s view", async (kind, mod) => {
    const refused = await get(kind, ["MOD-05:view"]);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/permission/);
    expect(queries).toHaveLength(0);

    const allowed = await get(kind, ["MOD-05:view", `${mod}:view`]);
    expect(allowed.status).toBe(200);
  });

  test("invoices: refused with neither invoice module", async () => {
    const res = await get("invoices", ["MOD-05:view"]);
    expect(res.status).toBe(403);
    expect(queries).toHaveLength(0);
  });

  test.each([
    [["MOD-51:view"], ["FINAL", "CREDIT_NOTE"]],
    [["MOD-50:view"], ["PROFORMA"]],
    [["MOD-51:view", "MOD-50:view"], ["FINAL", "CREDIT_NOTE", "PROFORMA"]],
  ])("invoices with %j list exactly the types %j", async (grants, types) => {
    const res = await get("invoices", ["MOD-05:view", ...grants]);
    expect(res.status).toBe(200);
    expect(usageQuery().params[3]).toEqual(types);
  });

  test("rates need nothing beyond the dictionary — Cost & evolution already shows them", async () => {
    const res = await get("rates", ["MOD-05:view"]);
    expect(res.status).toBe(200);
  });
});

describe("rates", () => {
  test("each row is marked in force / superseded by the Cost & evolution rule", async () => {
    const res = await get("rates", ["MOD-05:view"]);
    const [open, old] = res.body.data;
    expect(open).toMatchObject({ rate: 150000, superseded: false });
    expect(old).toMatchObject({ rate: 120000, in_force: false, superseded: true });
  });

  test("rateState is the window rateTimeline applies", () => {
    const row = { effective_from: "2026-01-01", effective_to: "2026-06-30" };
    expect(rules.rateState(row, "2026-03-15")).toEqual({ in_force: true, superseded: true });
    expect(rules.rateState(row, "2026-07-01")).toEqual({ in_force: false, superseded: true });
    expect(rules.rateState({ effective_from: "2026-08-01" }, "2026-07-31")).toEqual({ in_force: false, superseded: false });
    // Both ends inclusive, as the tax-code picker reads them.
    expect(rules.rateState(row, "2026-06-30").in_force).toBe(true);
    const [t] = rules.rateTimeline([row], "2026-03-15");
    expect(t).toMatchObject(rules.rateState(row, "2026-03-15"));
  });
});

describe("the list reads what the tile counts", () => {
  /**
   * `usageCounts` is the tile; `usageRows` is the list behind it. If they read
   * different tables — or the list grows a filter the count does not have — the
   * dialog says "Showing 1–20 of 40" under a tile that says 57.
   */
  test.each([
    ["costings", "costing_line"],
    ["cash_requests", "cash_request_line"],
    ["invoices", "invoice_line"],
    ["purchase_orders", "purchase_order_item"],
    ["rates", "expense_rate"],
  ])("%s lists %s rows filtered only by the item", async (kind, table) => {
    const seen = [];
    const client = { query: async (sql, params) => (seen.push({ sql, params }), { rows: [] }) };
    await repo.usageRows(client, ITEM, kind, {}, { invoiceTypes: ["FINAL"] });
    const countSeen = [];
    await repo.usageCounts({ query: async (sql) => (countSeen.push(sql), { rows: [{}] }) }, ITEM);

    const sql = seen[0].sql.replace(/\s+/g, " ");
    const m = new RegExp(`FROM ${table} (\\w+)`).exec(sql);
    expect(m).not.toBeNull();
    const where = sql.slice(sql.indexOf(" WHERE "), sql.indexOf(" ORDER BY "));
    // The item is the one filter; invoices add only the viewer's type narrowing.
    expect(where.trim()).toBe(
      kind === "invoices"
        ? `WHERE ${m[1]}.dictionary_item_id = $1 AND inv.type = ANY($4::text[])`
        : `WHERE ${m[1]}.dictionary_item_id = $1`,
    );
    expect(countSeen[0]).toMatch(new RegExp(`FROM ${table}\\s+WHERE dictionary_item_id = \\$1`));
  });
});

describe("GET /:id/spend/documents — the rows behind the Spend tab's tiles", () => {
  test("one lens, one page, the true total; the window is normalised as the tiles' is", async () => {
    const res = await request(app())
      .get(`/${ITEM}/spend/documents?from=2026-06-01&to=2026-01-01&lens=committed&limit=20&offset=20`)
      .set("x-grants", "MOD-05:view");
    expect(res.status).toBe(200);
    expect(res.headers["x-total-count"]).toBe("57");
    const q = usageQuery();
    // A reversed window collapses exactly as `spend` collapses it (rules.normalisePeriod).
    const p = rules.normalisePeriod({ from: "2026-06-01", to: "2026-01-01" });
    expect(q.params).toEqual([ITEM, p.from, p.to, 20, null, "committed", 20]);
    expect(q.sql).toMatch(/lens = \$6::text/);
  });

  test("no lens is every lens — the Documents tile", async () => {
    await request(app()).get(`/${ITEM}/spend/documents`).set("x-grants", "MOD-05:view");
    expect(usageQuery().params[5]).toBeNull();
  });

  test("a lens that does not exist is refused", async () => {
    const res = await request(app())
      .get(`/${ITEM}/spend/documents?lens=forecast`)
      .set("x-grants", "MOD-05:view");
    expect(res.status).toBe(422);
    expect(queries).toHaveLength(0);
  });

  test("the paged list and the capped list read the same union", async () => {
    const seen = [];
    const client = { query: async (sql) => (seen.push(sql), { rows: [] }) };
    await repo.spendDocuments(client, ITEM, "2026-01-01", "2026-06-30", 100, null);
    await repo.spendDocumentsPage(client, ITEM, "2026-01-01", "2026-06-30", { limit: 20, offset: 0 });
    const union = (sql) => sql.slice(sql.indexOf("FROM (") + 6, sql.lastIndexOf(") docs"));
    expect(union(seen[1])).toBe(union(seen[0]));
    for (const lens of ["'estimated'", "'committed'", "'actual'"]) expect(seen[0]).toContain(lens);
  });
});
