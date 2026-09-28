"use strict";
/**
 * Treasury account 360 — GET /treasury-accounts/:id/lines, the ledger lines
 * behind the movement tiles (Debits, Credits, This month, This year).
 *
 * The tiles are sums computed by `_balances`; this list must be the rows those
 * sums were added up from, or the dialog says "of 40" under a figure that 212
 * lines made. So what is pinned is the FILTER: the account's GL leaf, validated
 * entries only, the side the tile sums, and the same month / year start — plus
 * the true total on X-Total-Count and a refusal for a period nobody defined.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { user_id: "11111111-1111-1111-1111-111111111111" };
    next();
  },
}));
jest.mock("../../src/middleware/rbac", () => {
  const { AppError } = jest.requireActual("../../src/utils/errors");
  return {
    requirePermission: (mod, action) => (req, _res, next) =>
      String(req.headers["x-grants"] || "").split(",").includes(`${mod}:${action}`)
        ? next()
        : next(new AppError("PERMISSION_DENIED", `No permission for ${mod}.${action}`, 403)),
    requireCapability: () => (_req, _res, next) => next(),
    readPermissions: async (_req, specs) => specs.map(() => false),
  };
});

const accRepo = require("../../src/modules/master/treasury_account/treasury_account.repo");
const treasury360 = require("../../src/modules/master/treasury-360.service");
const routes = require("../../src/modules/master/treasury_account/treasury_account.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

const ACC = "22222222-2222-2222-2222-222222222222";
const { router } = routes;

let queries;
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.tenantDb = (fn) =>
      fn({
        query: async (sql, params) => {
          queries.push({ sql, params });
          return {
            rows: [
              { line_id: "l1", debit: "1000.00", credit: "0.00", entry_no: 7, _total: "212" },
              { line_id: "l2", debit: "250.00", credit: "0.00", entry_no: 6, _total: "212" },
            ],
          };
        },
      });
    next();
  });
  a.use(router);
  a.use(errorHandler);
  return a;
}

beforeEach(() => {
  queries = [];
  jest.spyOn(accRepo, "getWithCategory").mockImplementation(async (_c, id) =>
    id === ACC ? { treasury_account_id: ACC, coa_code: "521100" } : null,
  );
});
afterEach(() => jest.restoreAllMocks());

const get = (qs, id = ACC) =>
  request(app()).get(`/treasury-accounts/${id}/lines${qs}`).set("x-grants", "MOD-09:view");

describe("GET /treasury-accounts/:id/lines", () => {
  test("a page of lines, with the true total on X-Total-Count", async () => {
    const res = await get("?side=debit&limit=20&offset=20");
    expect(res.status).toBe(200);
    expect(res.headers["x-total-count"]).toBe("212");
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).not.toHaveProperty("_total");
    // leaf, side, no period start, then the page.
    expect(queries[0].params).toEqual(["521100", "debit", null, 20, 20]);
  });

  test("the filter is the tiles' filter: this leaf, validated entries only", async () => {
    await get("");
    const sql = queries[0].sql.replace(/\s+/g, " ");
    expect(sql).toMatch(/WHERE jl\.account_code = \$1 AND je\.status = 'validated'/);
    // The side keeps the lines that carry it; a zero debit adds nothing to the sum.
    expect(sql).toMatch(/\$2::text = 'debit' AND jl\.debit > 0/);
    expect(sql).toMatch(/\$2::text = 'credit' AND jl\.credit > 0/);
    expect(sql).toMatch(/je\.entry_date >= \$3::date/);
    expect(queries[0].params.slice(1, 3)).toEqual([null, null]);
  });

  test("This month / This year start where the tiles' sums start", async () => {
    const { mtd, ytd } = treasury360.periodStarts();
    await get("?period=mtd");
    await get("?period=ytd");
    expect(queries[0].params[2]).toBe(mtd);
    expect(queries[1].params[2]).toBe(ytd);
  });

  test("periodStarts is the 1st of the month and 1 January, whatever the server's zone", () => {
    // Local midnight on the 1st — the instant a UTC+1 server used to print as
    // the last day of the previous month.
    expect(treasury360.periodStarts(new Date(2026, 8, 1, 0, 0, 0))).toEqual({
      mtd: "2026-09-01",
      ytd: "2026-01-01",
    });
    expect(treasury360.periodStarts(new Date(2026, 0, 1, 0, 0, 0))).toEqual({
      mtd: "2026-01-01",
      ytd: "2026-01-01",
    });
  });

  test("an unknown side or period is refused, not guessed", async () => {
    expect((await get("?side=both")).status).toBe(422);
    expect((await get("?period=last-week")).status).toBe(422);
    expect(queries).toHaveLength(0);
  });

  test("a missing account is a 404; one with no GL leaf is an empty page", async () => {
    expect((await get("", "33333333-3333-3333-3333-333333333333")).status).toBe(404);
    accRepo.getWithCategory.mockResolvedValueOnce({ treasury_account_id: ACC, coa_code: null });
    const res = await get("");
    expect(res.status).toBe(200);
    expect(res.headers["x-total-count"]).toBe("0");
    expect(res.body.data).toEqual([]);
  });

  test("needs the treasury view grant, like the 360 itself", async () => {
    const res = await request(app()).get(`/treasury-accounts/${ACC}/lines`).set("x-grants", "MOD-05:view");
    expect(res.status).toBe(403);
  });
});
