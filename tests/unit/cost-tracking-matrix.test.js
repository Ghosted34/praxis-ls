"use strict";

/**
 * §3.4 — the master-ledger matrix, bulk entry and advance allocations.
 *
 * The matrix's columns are DERIVED from the dictionary items that carry
 * spend — the legacy hardcoded 15 categories as a PHP constant and matched
 * them by array index (add a category → edit PHP; rename one → history
 * splits). Advances follow the owner's decision (2026-08-19): per FILE, with
 * OPTIONAL per-item allocation, never summing past the advance.
 */
const service = require("../../src/modules/costing/cost_tracking/cost_tracking.service");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
jest.mock(
  "../../src/modules/finance/journal_entry/journal_entry.service",
  () => ({
    buildAndInsert: jest.fn(async () => ({ entry: { entry_id: "e-1" } })),
  }),
);
jest.mock("../../src/services/compliance/proof-obligation.service", () => ({
  check: jest.fn(async () => {}),
}));
jest.mock("../../src/shared/config/finance-accounts", () => ({
  accountFor: jest.fn(
    async (_c, kind, explicit) =>
      explicit || (kind === "treasury" ? "571100" : "473100"),
  ),
}));

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("matrix — columns derived from the dictionary", () => {
  function fakeClient() {
    const queries = [];
    return {
      queries,
      async query(sql, params) {
        queries.push({ sql, params });
        if (/FROM dossier_visible d\s+LEFT JOIN client_master/.test(sql)) {
          // portfolio row
          return {
            rows: [
              {
                dossier_id: UUID(1),
                ref: "SLAS-1",
                budget: 1000,
                actual: 700,
                advance_received: 300,
                advance_applied: 0,
              },
            ],
          };
        }
        if (/GROUP BY d\.dossier_id, ce\.dictionary_item_id/.test(sql)) {
          return {
            rows: [
              {
                dossier_id: UUID(1),
                dictionary_item_id: UUID(5),
                item_code: "DEMURRAGE",
                item_label: "Demurrage",
                amount: 500,
              },
              {
                dossier_id: UUID(1),
                dictionary_item_id: null,
                item_code: null,
                item_label: null,
                amount: 200,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
  }

  it("one row per file, one column per item with spend, OTHER for untagged", async () => {
    const out = await service.matrix(fakeClient(), {});
    expect(out.items.map((i) => i.code)).toEqual(["DEMURRAGE", "OTHER"]);
    const row = out.rows[0];
    expect(row.cells[UUID(5)]).toBe(500);
    expect(row.cells.OTHER).toBe(200);
    expect(row.total_spend).toBe(700); // = portfolio actual
    // balance = actual - advance_received (the same coverage everyone uses)
    expect(row.total_balance).toBe(400);
  });

  it("the cell query enumerates through dossier_visible, never the base table", async () => {
    const c = fakeClient();
    await service.matrix(c, {});
    const cellQ = c.queries.find((q) =>
      /GROUP BY d\.dossier_id, ce\.dictionary_item_id/.test(q.sql),
    );
    expect(cellQ.sql).toMatch(/JOIN dossier_visible d/);
  });
});

describe("recordCosts — the whole sheet in one transaction", () => {
  function fakeClient({ failOn = null } = {}) {
    const queries = [];
    let n = 0;
    return {
      queries,
      async query(sql, params) {
        queries.push({ sql, params });
        if (
          /INSERT INTO cost_entry/.test(sql) ||
          /insert into "cost_entry"/i.test(sql)
        ) {
          n += 1;
          if (failOn === n) throw new Error("boom on line " + n);
          return { rows: [{ cost_entry_id: UUID(n), amount: 1 }] };
        }
        if (/SELECT debit_account FROM posting_rule/.test(sql))
          return { rows: [{ debit_account: "611100" }] };
        return { rows: [{}] };
      },
    };
  }
  const base = {
    dossierId: UUID(1),
    entityId: UUID(2),
    entryDate: "2026-08-19",
    sourceDocRef: "SHEET-1",
    actor: { user_id: UUID(3) },
  };

  it("records every line under one BEGIN/COMMIT", async () => {
    const c = fakeClient();
    const out = await service.recordCosts(c, {
      ...base,
      lines: [
        { dictionary_item_id: UUID(5), amount: 100 },
        { amount: 50, is_disbursement: true },
      ],
    });
    expect(out.recorded).toBe(2);
    expect(c.queries.filter((q) => /^BEGIN$/.test(q.sql)).length).toBe(1);
    expect(c.queries.filter((q) => /^COMMIT$/.test(q.sql)).length).toBe(1);
  });

  it("one bad line rolls the whole sheet back — no half-saved state", async () => {
    const c = fakeClient({ failOn: 2 });
    await expect(
      service.recordCosts(c, {
        ...base,
        lines: [
          { dictionary_item_id: UUID(5), amount: 100 },
          { dictionary_item_id: UUID(6), amount: 50 },
        ],
      }),
    ).rejects.toThrow();
    expect(c.queries.some((q) => /^ROLLBACK$/.test(q.sql))).toBe(true);
    expect(c.queries.some((q) => /^COMMIT$/.test(q.sql))).toBe(false);
  });

  it("refuses an empty sheet", async () => {
    await expect(
      service.recordCosts(fakeClient(), { ...base, lines: [] }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("advance allocations — per file, optional earmark (owner-decided)", () => {
  function fakeClient({
    advance = { advance_id: UUID(7), amount: 1000 },
    allocated = 0,
  } = {}) {
    const queries = [];
    return {
      queries,
      async query(sql, params) {
        queries.push({ sql, params });
        if (/FROM advance WHERE advance_id/.test(sql))
          return { rows: advance ? [advance] : [] };
        if (/SUM\(amount\).*FROM advance_allocation/.test(sql))
          return { rows: [{ total: allocated }] };
        if (/advance_allocation/.test(sql) && /INSERT/i.test(sql))
          return {
            rows: [
              {
                advance_allocation_id: UUID(9),
                ...JSON.parse(JSON.stringify(params ? {} : {})),
              },
            ],
          };
        return { rows: [{}] };
      },
    };
  }
  const actor = { user_id: UUID(3) };

  it("allocates within the advance", async () => {
    const out = await service.allocateAdvance(fakeClient({ allocated: 200 }), {
      advanceId: UUID(7),
      dictionaryItemId: UUID(5),
      amount: 300,
      actor,
    });
    expect(out).toBeDefined();
  });

  it("refuses to earmark past the advance, naming the numbers", async () => {
    await expect(
      service.allocateAdvance(fakeClient({ allocated: 800 }), {
        advanceId: UUID(7),
        dictionaryItemId: UUID(5),
        amount: 300,
        actor,
      }),
    ).rejects.toMatchObject({ code: "OVER_ALLOCATED", status: 422 });
  });

  it("404s an unknown advance", async () => {
    await expect(
      service.allocateAdvance(fakeClient({ advance: null }), {
        advanceId: UUID(7),
        dictionaryItemId: UUID(5),
        amount: 1,
        actor,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
