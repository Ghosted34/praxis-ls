"use strict";

/**
 * Régie — the holder's own view, and the client/server contract behind it
 * (Landing B).
 *
 * TWO THINGS THIS PINS.
 *
 * 1. `/regie/mine` IS SELF-SCOPED. It is the only régie route with no MOD-49
 *    grant — the same self-service rule as `hr_query`'s `/mine` — which is only
 *    safe while the holder id comes from the SESSION. The moment someone lets it
 *    read `req.query.holder_user_id`, an unprivileged user can enumerate every
 *    float in the tenant. That is a one-line change away at all times, so it is
 *    asserted here rather than left to review.
 *
 * 2. THE CLIENT DERIVES NOTHING. Landing B renders actions from the server's
 *    `next` (`rules.NEXT[state]`) and the balance from the server's
 *    `open_balance`. If the UI kept its own copy of either, the two would drift
 *    and the drift would show as the UI offering an action the API refuses. The
 *    scan below fails if the TSX starts recomputing them.
 *
 * DB-free, like the rest of tests/unit: the service is exercised against a stub
 * client, and the route/controller/TSX facts are asserted by parsing the source.
 */

const fs = require("fs");
const path = require("path");

const rules = require("../../src/modules/costing/regie/regie.rules");

const SRC = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "modules",
  "costing",
  "regie",
);
const CLIENT = path.join(__dirname, "..", "..", "client", "src");
const read = (p) => fs.readFileSync(p, "utf8");
/** Source with // and /* *\/ comments removed — so a rule is never "satisfied"
 *  by the prose in a comment that merely mentions it. */
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const HOLDER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("GET /regie/mine is self-scoped", () => {
  const routes = code(path.join(SRC, "regie.routes.js"));
  const controller = code(path.join(SRC, "regie.controller.js"));

  test("the route carries no MOD-49 permission gate", () => {
    const line = routes.split("\n").find((l) => l.includes('"/mine"'));
    expect(line).toBeDefined();
    // Self-service by design: you can always see the advances YOU hold.
    expect(line).not.toMatch(/requirePermission/);
  });

  test("…which is only safe because the holder id comes from the session", () => {
    const line = controller
      .split("\n")
      .filter((l) => l.includes("service.mine"))
      .join(" ");
    expect(line).toMatch(/req\.user/);
    // The whole point: never from the caller's own query string.
    expect(line).not.toMatch(/req\.query\.holder_user_id/);
    expect(line).not.toMatch(/req\.params/);
  });

  test("/mine is registered before /:id so it is not captured as an id", () => {
    expect(routes.indexOf('"/mine"')).toBeGreaterThan(-1);
    expect(routes.indexOf('"/mine"')).toBeLessThan(routes.indexOf('"/:id"'));
  });

  test("every other régie route IS gated", () => {
    const gated = routes
      .split("\n")
      .filter((l) => /^router\.(get|post|patch|delete)\(/.test(l.trim()))
      .filter((l) => !l.includes('"/mine"'));
    expect(gated.length).toBeGreaterThan(5);
    for (const l of gated) expect(l).toMatch(/requirePermission\(MODULE/);
  });
});

/**
 * `regie.service` pulls in the ledger, the document vault and the workflow
 * executor, which reach `@praxis/shared`, `dotenv` and `pino` — none of which
 * resolve without an `npm install`. `mine` touches none of them, so they are
 * mocked at the paths the service requires directly; the factories stop the
 * real modules (and their transitive requires) from ever loading.
 *
 * Only the collaborators `mine` does NOT use are stubbed. `repo` and `rules`
 * are the real implementations, so the SQL and the arithmetic asserted below
 * are the ones that run in production.
 */
jest.mock(
  "../../src/modules/finance/journal_entry/journal_entry.service",
  () => ({
    buildAndInsert: jest.fn(),
    post: jest.fn(),
    reverse: jest.fn(),
  }),
);
jest.mock("../../src/services/documents/document.service", () => ({
  capture: jest.fn(),
}));
jest.mock("../../src/services/documents/numbering.service", () => ({
  allocate: jest.fn(),
}));
jest.mock("../../src/services/workflow/executor", () => ({ start: jest.fn() }));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));

describe("service.mine", () => {
  const service = require("../../src/modules/costing/regie/regie.service");

  /**
   * A client stub that records the query it was asked for. `mine` goes through
   * repo.list, which builds SQL by hand, so this captures both the text and the
   * bound parameters.
   */
  function stubClient(rows) {
    const calls = [];
    return {
      calls,
      query: async (text, params) => {
        calls.push({ text, params });
        // `getRule` reads app_setting; return no row so the fallbacks apply.
        if (/app_setting/i.test(text)) return { rows: [] };
        return { rows };
      },
    };
  }

  const advance = (over = {}) => ({
    regie_advance_id: "11111111-1111-1111-1111-111111111111",
    holder_user_id: HOLDER,
    amount: 100000,
    justified_amount: 0,
    returned_amount: 0,
    issued_on: "2026-08-01",
    policy_window_days: 7,
    state: "ISSUED",
    currency: "XAF",
    ...over,
  });

  test("returns [] for an anonymous caller rather than every advance", async () => {
    // The failure mode this guards: a missing session silently becoming
    // "no holder filter", i.e. the whole table.
    const c = stubClient([advance()]);
    expect(await service.mine(c, null)).toEqual([]);
    expect(await service.mine(c, undefined)).toEqual([]);
    expect(c.calls).toHaveLength(0);
  });

  test("filters by the holder passed in, and only open advances", async () => {
    const c = stubClient([advance()]);
    await service.mine(c, HOLDER, { today: "2026-08-05" });
    const listCall = c.calls.find((q) => /FROM regie_advance/.test(q.text));
    expect(listCall).toBeDefined();
    expect(listCall.text).toMatch(/holder_user_id = \$\d/);
    expect(listCall.params).toContain(HOLDER);
    expect(listCall.params).not.toContain(OTHER);
    // open=true is expressed in SQL against the stored totals, so the database
    // does the same arithmetic openBalance() does.
    expect(listCall.text).toMatch(
      /\(amount - justified_amount - returned_amount\) > 0/,
    );
  });

  test("decorates each row with the derived fields the UI renders", async () => {
    const c = stubClient([advance()]);
    const [row] = await service.mine(c, HOLDER, { today: "2026-08-05" });
    expect(row.open_balance).toBe(100000);
    expect(row.days_to_window).toBe(3); // issued 08-01, window 7, today 08-05
    expect(row.is_aged).toBe(false);
    expect(row.is_due_soon).toBe(false); // 3 days left, warn default is 2
  });

  test("a partially justified advance reports what is still owed", async () => {
    const c = stubClient([
      advance({ justified_amount: 40000, returned_amount: 10000 }),
    ]);
    const [row] = await service.mine(c, HOLDER, { today: "2026-08-05" });
    expect(row.open_balance).toBe(50000);
  });

  test("soonest deadline first — the point of the list", async () => {
    const c = stubClient([
      advance({ regie_advance_id: "a", issued_on: "2026-08-04" }), // 6 days left
      advance({ regie_advance_id: "b", issued_on: "2026-07-25" }), // overdue
      advance({ regie_advance_id: "c", issued_on: "2026-08-01" }), // 3 days left
    ]);
    const rows = await service.mine(c, HOLDER, { today: "2026-08-05" });
    expect(rows.map((r) => r.regie_advance_id)).toEqual(["b", "c", "a"]);
    expect(rows[0].days_to_window).toBeLessThan(0);
  });

  test("an overdue advance is flagged aged", async () => {
    const c = stubClient([advance({ issued_on: "2026-07-01" })]);
    const [row] = await service.mine(c, HOLDER, { today: "2026-08-05" });
    expect(row.is_aged).toBe(true);
    expect(row.days_to_window).toBeLessThan(0);
  });
});

describe("the client does not keep a second copy of the state machine", () => {
  const detail = code(
    path.join(CLIENT, "features", "costing", "regie-detail.tsx"),
  );

  test("actions are gated on the server's `next`, not on a local NEXT map", () => {
    expect(detail).toMatch(/\.next\b/);
    // A literal transition table in TSX is the drift this forbids.
    expect(detail).not.toMatch(/const\s+NEXT\s*=/);
    expect(detail).not.toMatch(/PARTIALLY_JUSTIFIED\s*:\s*\[/);
  });

  test("the open balance is read from the server, never recomputed", () => {
    expect(detail).toMatch(/open_balance/);
    // i.e. no `amount - justified_amount - returned_amount` in the client.
    expect(detail).not.toMatch(/justified_amount\s*[-+]\s*/);
    expect(detail).not.toMatch(/amount\s*-\s*.*justified/);
  });

  test("the ageing window comes from the row, not a hardcoded day count", () => {
    // policy_window_days is frozen per advance at issue precisely so a changed
    // tenant default cannot retroactively age advances already in flight. A
    // literal 7 in the client would defeat that.
    expect(detail).toMatch(/days_to_window/);
    expect(detail).not.toMatch(/policy_window_days\s*\|\|\s*\d/);
    expect(detail).not.toMatch(/=\s*7\b/);
  });

  test("every write action Landing A added is reachable from the client", () => {
    const apiFile = code(path.join(CLIENT, "lib", "costing-api.ts"));
    for (const fn of [
      "getRegie",
      "regieWatchlist",
      "myRegie",
      "retireRegie",
      "queryRegie",
      "writeOffRegie",
      "unageRegie",
    ]) {
      expect(apiFile).toMatch(new RegExp(`export const ${fn}\\b`));
    }
  });

  test("the API helpers hit the paths the router actually registers", () => {
    const apiFile = code(path.join(CLIENT, "lib", "costing-api.ts"));
    const routes = code(path.join(SRC, "regie.routes.js"));
    // Each client path suffix must correspond to a registered route.
    for (const [suffix, verb] of [
      ["/retire", "post"],
      ["/query", "post"],
      ["/write-off", "post"],
      ["/unage", "post"],
      ["/watchlist", "get"],
      ["/mine", "get"],
    ]) {
      expect(apiFile).toContain(suffix);
      expect(routes).toMatch(
        new RegExp(`router\\.${verb}\\("(?:/:id)?${suffix}"`),
      );
    }
  });

  test("write-off is only offered from QUERIED — the KB §6.8 step 5 rule", () => {
    // Mirrors assertRetirable's NOT_QUERIED guard. Asserted on the rules module
    // (the source of truth) and reflected in the client.
    expect(rules.NEXT.ISSUED).not.toContain("WRITE_OFF");
    expect(detail).toMatch(/state === "QUERIED"/);
  });
});
