"use strict";

/**
 * A RECIPIENT SEARCH IS A READ OF A PARTY REGISTER, and it was not gated as one.
 *
 * `/mail/recipients` UNIONed client_master, supplier_master, employee and lead
 * behind MOD-72 `view` — the grant that means "you may use mail". So anybody who
 * could open the composer could type two letters and enumerate every client,
 * supplier, employee and lead address in the tenant. The employee row is the
 * sharpest of the four: staff addresses are HR data, and HR is MOD-02.
 *
 * These tests hold the fix to the shape that makes it a fix rather than a
 * cosmetic filter: a source the caller may not read is NOT QUERIED. Filtering
 * results after the fact still counts, ranks and orders rows the caller was
 * never entitled to, and still leaks their existence through the shape of what
 * comes back.
 */

const repo = require("../../src/modules/mail/mail/mail.repo");
const service = require("../../src/modules/mail/mail/mail.service");

/** A client that records the SQL it was asked to run. */
function spyClient(rows = []) {
  const seen = [];
  return { seen, query: async (sql, params) => { seen.push({ sql, params }); return { rows }; } };
}

/** Grants, as identity-cache returns them: one row per role holding a module. */
const grantsFor = (modules) => (_c, { module }) =>
  (modules.includes(module) ? [{ can_read: true }] : []);

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(),
  getUserScopeClosure: jest.fn(async () => null),
}));
const identityCache = require("../../src/shared/cache/identity-cache");

const USER = { user_id: "u-1", role_ids: ["r-1"], is_ceo: false };

beforeEach(() => jest.clearAllMocks());

describe("the recipient search reads only what the caller may read", () => {
  test("a caller with no party grants queries nothing at all", async () => {
    // Not "returns []" after a query — no query. This is the assertion that
    // stops a future refactor from reintroducing a fetch-then-filter.
    identityCache.getGrants.mockImplementation(grantsFor([]));
    const client = spyClient();
    const out = await service.searchRecipients(client, "cim", { user: USER });
    expect(out).toEqual([]);
    expect(client.seen).toHaveLength(0);
  });

  test("a caller with only MOD-03 searches clients and nothing else", async () => {
    identityCache.getGrants.mockImplementation(grantsFor(["MOD-03"]));
    const client = spyClient([{ type: "client", id: "c1", name: "CIMENCAM", email: "a@b.cm" }]);
    await service.searchRecipients(client, "cim", { user: USER });

    const sql = client.seen[0].sql;
    expect(sql).toContain("client_master");
    expect(sql).not.toContain("supplier_master");
    expect(sql).not.toContain("FROM employee");
    expect(sql).not.toContain("FROM lead");
    // One source means no UNION to write.
    expect(sql).not.toContain("UNION ALL");
  });

  test("staff addresses need the HR grant, not the mail grant", async () => {
    // The whole point. MOD-72 is "you may use mail"; MOD-02 is "you may read
    // people". Someone holding the first and not the second must not be able to
    // pull a colleague's address out of the composer.
    identityCache.getGrants.mockImplementation(grantsFor(["MOD-72", "MOD-03"]));
    const client = spyClient();
    await service.searchRecipients(client, "jean", { user: USER });
    expect(client.seen[0].sql).not.toContain("FROM employee");

    identityCache.getGrants.mockImplementation(grantsFor(["MOD-02"]));
    const withHr = spyClient();
    await service.searchRecipients(withHr, "jean", { user: USER });
    expect(withHr.seen[0].sql).toContain("FROM employee");
  });

  test("every source is joined when the caller holds all four", async () => {
    identityCache.getGrants.mockImplementation(grantsFor(["MOD-02", "MOD-03", "MOD-04", "MOD-20"]));
    const client = spyClient();
    await service.searchRecipients(client, "a", { user: USER });
    const sql = client.seen[0].sql;
    for (const table of ["client_master", "supplier_master", "FROM employee", "FROM lead"]) {
      expect(sql).toContain(table);
    }
    expect((sql.match(/UNION ALL/g) || [])).toHaveLength(3);
  });

  test("a CEO reads everything, exactly as the route gate says", async () => {
    // The bypass has to agree with requirePermission's, or the two disagree
    // about what a CEO is and one of them is wrong.
    identityCache.getGrants.mockImplementation(grantsFor([]));
    const client = spyClient();
    await service.searchRecipients(client, "a", { user: { ...USER, is_ceo: true } });
    expect(client.seen[0].sql).toContain("client_master");
    expect(client.seen[0].sql).toContain("FROM employee");
  });

  test("no caller means no results — the signature fails safe", async () => {
    // This function used to take (client, q). A call site that is not updated
    // must return NOTHING rather than everything: the dangerous direction for
    // this signature to change in is the silent one.
    const client = spyClient();
    expect(await service.searchRecipients(client, "a")).toEqual([]);
    expect(client.seen).toHaveLength(0);
  });

  test("the term is bound, never interpolated", async () => {
    identityCache.getGrants.mockImplementation(grantsFor(["MOD-03"]));
    const client = spyClient();
    await service.searchRecipients(client, "'; DROP TABLE client_master; --", { user: USER });
    expect(client.seen[0].sql).not.toContain("DROP TABLE");
    expect(client.seen[0].params[0]).toBe("%'; DROP TABLE client_master; --%");
  });

  test("an empty term asks nothing, whatever the grants", async () => {
    identityCache.getGrants.mockImplementation(grantsFor(["MOD-03"]));
    const client = spyClient();
    expect(await repo.searchRecipients(client, "   ", { sources: ["client"] })).toEqual([]);
    expect(client.seen).toHaveLength(0);
  });

  test("the source list names a module for every address book", async () => {
    // A source added without a module would be a source with no gate — the
    // exact defect this file exists about, reintroduced one table at a time.
    for (const src of repo.RECIPIENT_SOURCES) {
      expect(src.type).toBeTruthy();
      expect(src.module).toMatch(/^MOD-\d+$/);
      expect(src.sql).toContain("ILIKE $1");
    }
  });

  test("an unknown source name cannot smuggle SQL in", async () => {
    // `sources` is derived server-side from grants, but it is a list of strings
    // and the repo filters a fixed table by it rather than trusting it.
    const client = spyClient();
    expect(await repo.searchRecipients(client, "a", { sources: ["client_master; DROP"] })).toEqual([]);
    expect(client.seen).toHaveLength(0);
  });
});
