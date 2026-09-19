"use strict";
/**
 * 13930 — `/operations?ids=…`, the lookup the one picker is built on.
 *
 * ── WHY THIS IS A UNIT TEST AND NOT A ROUTE TEST ───────────────────────────
 *
 * The route has no zod validator — reads on this module never had one — so
 * `ids` arrives as whatever the query string said and the parsing is the only
 * thing between it and the driver. That makes `parseIds` the security and
 * correctness boundary, and it is pure, so it can be tested exactly.
 *
 * Two failures it exists to prevent, both of which reach production as a 500
 * on a list endpoint that every form open now calls:
 *
 *   · a malformed uuid is SQLSTATE 22P02 at the driver;
 *   · an unbounded `= ANY($n)` is a way to ask for the whole table by URL.
 *
 * And one correctness rule that is easy to get wrong and silent when you do:
 * an id list is its own page. `page()` defaults to 50, so a caller naming 80
 * ids would get 50 rows back and render a raw uuid for the other 30 — the very
 * defect this filter exists to end, reintroduced one layer up.
 */

const repo = require("../../src/modules/operations/operations_file/operations_file.repo");

const U = (n) => `${String(n).padStart(8, "0")}-1111-1111-1111-111111111111`;

function mockClient(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

describe("parseIds — the guard in front of the driver", () => {
  it("keeps well-formed uuids", () => {
    expect(repo.parseIds(`${U(1)},${U(2)}`)).toEqual([U(1), U(2)]);
  });

  it("drops anything that is not a uuid rather than letting it reach Postgres", () => {
    // 22P02 is an unhandled 500 on a list endpoint; dropping degrades to "that
    // id resolved to nothing", which is what the UI already renders.
    expect(repo.parseIds("not-a-uuid")).toBeNull();
    expect(repo.parseIds(`not-a-uuid,${U(1)}`)).toEqual([U(1)]);
    expect(repo.parseIds("'; DROP TABLE dossier; --")).toBeNull();
  });

  it("de-duplicates, so a repeated id is not a repeated row", () => {
    expect(repo.parseIds(`${U(1)},${U(1)},${U(1)}`)).toEqual([U(1)]);
  });

  it("caps the list, so the filter cannot be used to read the whole table", () => {
    const many = Array.from({ length: 500 }, (_, i) => U(i)).join(",");
    expect(repo.parseIds(many)).toHaveLength(repo.MAX_IDS);
  });

  it("treats absent, empty and all-invalid input as no filter at all", () => {
    for (const v of [undefined, null, "", ",,,", "abc,def"]) {
      expect(repo.parseIds(v)).toBeNull();
    }
  });

  it("accepts an array, which is how Express parses a repeated ids=", () => {
    expect(repo.parseIds([U(1), U(2)])).toEqual([U(1), U(2)]);
  });
});

describe("listPaged — the ids filter in SQL", () => {
  it("binds the ids as a uuid[] and never interpolates them", async () => {
    const c = mockClient();
    await repo.listPaged(c, { ids: `${U(1)},${U(2)}` });
    const { sql, params } = c.calls[0];
    expect(sql).toContain("d.dossier_id = ANY($");
    expect(sql).toContain("::uuid[]");
    expect(params).toContainEqual([U(1), U(2)]);
  });

  it("makes an id list its own page, so naming 80 ids returns 80 rows", async () => {
    // The whole point: `page()`'s default of 50 would drop the 51st id and the
    // caller would render a uuid for it.
    const c = mockClient();
    const ids = Array.from({ length: 80 }, (_, i) => U(i));
    await repo.listPaged(c, { ids: ids.join(",") });
    // $1 is LIMIT, $2 is OFFSET — the shared pagination contract.
    expect(c.calls[0].params[0]).toBe(80);
    expect(c.calls[0].params[1]).toBe(0);
  });

  it("still honours an explicit limit, so a caller can ask for fewer", async () => {
    const c = mockClient();
    await repo.listPaged(c, { ids: `${U(1)},${U(2)},${U(3)}`, limit: 1 });
    expect(c.calls[0].params[0]).toBe(1);
  });

  it("adds no predicate when ids is absent, so the ordinary list is untouched", async () => {
    const c = mockClient();
    await repo.listPaged(c, {});
    expect(c.calls[0].sql).not.toContain("dossier_id = ANY");
    expect(c.calls[0].params[0]).toBe(50);
  });

  it("combines with the other filters rather than replacing them", async () => {
    const c = mockClient();
    await repo.listPaged(c, { ids: U(1), q: "BL123" });
    const { sql } = c.calls[0];
    expect(sql).toContain("d.dossier_id = ANY($");
    expect(sql).toContain("ILIKE");
  });

  it("reads dossier_visible, so a DRAFT can never be resolved by id", async () => {
    // A half-typed wizard file is not a file. The picker must not offer one
    // and a table must not name one.
    const c = mockClient();
    await repo.listPaged(c, { ids: U(1) });
    expect(c.calls[0].sql).toContain("FROM dossier_visible");
  });
});
