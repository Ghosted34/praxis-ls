/**
 * The dossier drawer's budget is a gate, not a wish (§3.6, §3.7, §7.10).
 *
 *   ≤ 6 SQL statements per call · 300 ms cold · 50 ms warm
 *
 * This is the endpoint a user feels on every single thread click, which is why
 * the guide gives it its own aggregator and its own numbers. As merged it had
 * neither a statement gate nor a cache, so the warm figure was unreachable and
 * nothing stopped a later edit from adding a seventh query.
 *
 * Statements are counted against a recording client running the real service,
 * so the number is the number the driver would see. The warm case is asserted
 * against a fake Redis rather than a timer: "50 ms" is a claim that the second
 * call does not query, and a timing assertion in CI measures the CI box.
 */
"use strict";

const path = require("path");

/** An in-memory stand-in for the ioredis client, with SCAN. */
const mockStore = new Map();
const mockRedis = {
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return "OK"; }),
  del: jest.fn(async (...keys) => { let n = 0; for (const k of keys) { if (mockStore.delete(k)) n += 1; } return n; }),
  scan: jest.fn(async (_cursor, _m, pattern) => {
    const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$`);
    return ["0", [...mockStore.keys()].filter((k) => re.test(k))];
  }),
};
jest.mock("../../src/config/redis", () => ({ getClient: () => mockRedis }));

const context = require("../../src/modules/mail/binding/mail-context.service");
const cache = require("../../src/modules/mail/binding/context-cache");

const CLIENT_ROW = {
  client_id: "c-1", name: "Camrail", ref: "CLI-0001", is_vip: false,
  preferred_language: "fr", payment_terms_days: 30, credit_limit: 50_000_000,
  outstanding_xaf: 12_000_000, overdue_xaf: 3_000_000,
};

function recorder(answers = []) {
  const calls = [];
  return {
    calls,
    count: () => calls.length,
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

const ANSWERS = [
  { match: /FROM client_master WHERE client_id/, rows: [CLIENT_ROW] },
  { match: /AS open_dossiers/, rows: [{ open_dossiers: 7, open_quotes: 2, documents_missing: 3 }] },
  { match: /max\(m\.received_at\)/, rows: [{ last_contact_at: new Date("2026-08-18T09:12:00Z") }] },
];

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe("statement budget", () => {
  test("a cold client overview issues no more than SIX statements", async () => {
    const c = recorder(ANSWERS);
    await context.overview(c, "client:c-1", { userId: "u-1" });
    // The number in §3.6, asserted as an upper bound rather than an equality so
    // the gate does not fail on a legitimate consolidation.
    expect(c.count()).toBeLessThanOrEqual(6);
  });

  test("a client with 400 invoices costs the same — nothing here is per-row", async () => {
    const c = recorder([
      ...ANSWERS,
      { match: /FROM invoice/, rows: Array.from({ length: 400 }, (_, i) => ({ invoice_id: `i-${i}` })) },
    ]);
    await context.overview(c, "client:c-1", { userId: "u-1" });
    expect(c.count()).toBeLessThanOrEqual(6);
  });

  test("a dossier and a supplier overview are also inside the budget", async () => {
    for (const [ref, answer] of [
      ["dossier:d-1", { match: /FROM dossier_visible WHERE dossier_id/, rows: [{ dossier_id: "d-1", ref: "SLAS-2026-0042", status: "OPEN", client_id: "c-1" }] }],
      ["supplier:s-1", { match: /FROM supplier_master/, rows: [{ supplier_id: "s-1", name: "Maersk", ref: "SUP-1" }] }],
    ]) {
      const c = recorder([answer]);
      // eslint-disable-next-line no-await-in-loop
      await context.overview(c, ref, { userId: "u-1" });
      expect(c.count()).toBeLessThanOrEqual(6);
    }
  });

  test("opening a tab costs its own query and nothing else", async () => {
    const c = recorder([{ match: /FROM invoice/, rows: [] }]);
    await context.tab(c, "client:c-1", "money", { userId: "u-1" });
    // §7.9 criterion 7: "Opening the Money tab issues its own single query; not
    // opening it costs nothing."
    expect(c.count()).toBe(1);
  });

  test("not opening a tab costs nothing — the overview does not prefetch them", async () => {
    const c = recorder(ANSWERS);
    await context.overview(c, "client:c-1", { userId: "u-1" });
    expect(c.calls.some((q) => /FROM invoice/.test(q.text))).toBe(false);
  });
});

describe("the warm call does not go to the database at all", () => {
  test("the second overview issues ZERO statements", async () => {
    const cold = recorder(ANSWERS);
    const first = await context.overview(cold, "client:c-1", { userId: "u-1" });
    expect(first.cached).toBe(false);
    expect(cold.count()).toBeGreaterThan(0);

    const warm = recorder(ANSWERS);
    const second = await context.overview(warm, "client:c-1", { userId: "u-1" });
    expect(second.cached).toBe(true);
    expect(warm.count()).toBe(0);
    // The 50 ms warm budget is met by not querying. There is no arrangement of
    // SQL that meets it by being fast.
  });

  test("tabs are cached independently of the overview", async () => {
    await context.overview(recorder(ANSWERS), "client:c-1", { userId: "u-1" });
    const t = recorder([{ match: /FROM invoice/, rows: [] }]);
    await context.tab(t, "client:c-1", "money", { userId: "u-1" });
    expect(t.count()).toBe(1); // the overview's cache entry is not a money hit

    const warm = recorder([{ match: /FROM invoice/, rows: [] }]);
    await context.tab(warm, "client:c-1", "money", { userId: "u-1" });
    expect(warm.count()).toBe(0);
  });

  test("the entry expires — it is a 60-second cache, not a store", async () => {
    await context.overview(recorder(ANSWERS), "client:c-1", { userId: "u-1" });
    expect(mockRedis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), "EX", 60);
  });
});

describe("the cache is keyed by caller, not only by entity", () => {
  test("a colleague's warm entry is not served to another user", async () => {
    await context.overview(recorder(ANSWERS), "client:c-1", { userId: "u-1" });
    const other = recorder(ANSWERS);
    const out = await context.overview(other, "client:c-1", { userId: "u-2" });
    // last_contact_at and the interactions tab are visibility-filtered, so a
    // key on entity_ref alone would hand one colleague another's view of a
    // client's correspondence — §9.5's leak, reintroduced one layer up.
    expect(out.cached).toBe(false);
    expect(other.count()).toBeGreaterThan(0);
  });
});

describe("invalidation", () => {
  test("the four named events clear the entry", async () => {
    const { handlers } = require("../../src/orchestration/handlers/invalidate-mail-context");
    const keys = handlers.map((h) => h.eventKey).sort();
    expect(keys).toEqual(["document.captured", "invoice.posted", "milestone.completed", "payment.received"]);
  });

  test("posting an invoice drops every cached view of that client", async () => {
    await context.overview(recorder(ANSWERS), "client:c-1", { userId: "u-1" });
    await context.overview(recorder(ANSWERS), "client:c-1", { userId: "u-2" });
    expect(mockStore.size).toBe(2);

    const { handlers } = require("../../src/orchestration/handlers/invalidate-mail-context");
    const invoicePosted = handlers.find((h) => h.eventKey === "invoice.posted");
    const out = await invoicePosted.run({}, { entity_ref: "invoice:i-1", payload: { client_id: "c-1" } });

    expect(out.invalidated).toContain("client:c-1");
    // Both users' entries, every tab.
    expect([...mockStore.keys()].some((k) => k.includes("client:c-1"))).toBe(false);
  });

  test("it uses SCAN, never KEYS — this runs on an ordinary business event", async () => {
    await cache.invalidate("client:c-9");
    expect(mockRedis.scan).toHaveBeenCalled();
    expect(mockRedis.keys).toBeUndefined();
  });

  test("an event carrying no party reference is skipped, not guessed at", async () => {
    const { handlers } = require("../../src/orchestration/handlers/invalidate-mail-context");
    const out = await handlers[0].run({}, { entity_ref: null, payload: {} });
    expect(out.skipped).toMatch(/no party reference/);
  });
});

describe("it does not become party-360 (§3.6 MUST NOT)", () => {
  test("the aggregator never requires party-360.service", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/binding/mail-context.service.js"), "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/party-360/);
  });

  test("Overview is scoped to the caller, and says nothing rather than everything without one", async () => {
    const c = recorder(ANSWERS);
    const out = await context.overview(c, "client:c-1", {});
    expect(out.overview.last_contact_at).toBeNull();
    expect(c.calls.some((q) => /max\(m\.received_at\)/.test(q.text))).toBe(false);
  });

  test("the interactions tab is empty for an unknown caller, not full", async () => {
    const c = recorder([]);
    const out = await context.tab(c, "client:c-1", "interactions", {});
    expect(out.rows).toEqual([]);
    expect(c.count()).toBe(0);
  });

  test("a tab that is declared but not built says so, instead of looking empty", async () => {
    // A supplier has no commercial tab. Returning an empty list would be a
    // claim about the SUPPLIER; `not_built` is a claim about the software.
    const c = recorder([]);
    const out = await context.tab(c, "supplier:s-1", "commercial", { userId: "u-1" });
    expect(out.not_built).toBe(true);
  });

  test("and the overview only advertises tabs it can actually fill", async () => {
    const c = recorder([{ match: /FROM supplier_master/, rows: [{ supplier_id: "s-1", name: "Maersk", ref: "SUP-1" }] }]);
    const out = await context.overview(c, "supplier:s-1", { userId: "u-1" });
    expect(out.tabs_available).not.toContain("commercial");
  });
});
