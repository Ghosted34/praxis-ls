"use strict";

/**
 * G5 — God Mode referential accounting guard + dependency preview.
 *
 * The old guard was a regex over six hand-listed prefixes; credit_note,
 * supplier_invoice, cash_request, regie and depreciation were purgeable. The
 * new guard is referential: any immutable-ledger row keyed to the record makes
 * it unpurgeable, which every posting module satisfies by writing the ledger.
 *
 * DoD assertions:
 *   - every posting-linked entity prefix is REFUSED when the ledger holds a
 *     reference (enumerated, not sampled);
 *   - a record with no ledger reference purges;
 *   - the dependency preview reports ledger refs + catalogue-discovered FK
 *     children.
 */

const repo = require("../../src/modules/dashboard/godmode/godmode.repo");
const service = require("../../src/modules/dashboard/godmode/godmode.service");

jest.mock("argon2", () => ({ verify: jest.fn(async () => true) }));

/** A fake client: ledgerRefs returns n for the exact entity_ref, and the
 *  catalogue is a hand-staged pg_constraint/pg_attribute response. */
function fakeClient({ ledger = 0, children = [], pk = "id", softRow = null } = {}) {
  const queries = [];
  const c = {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      // pinHash
      if (/SELECT godmode_pin_hash/.test(sql)) return { rows: [{ godmode_pin_hash: "h" }] };
      // getSoftDelete
      if (/FROM soft_delete WHERE soft_delete_id/.test(sql))
        return { rows: softRow ? [softRow] : [] };
      // ledgerRefs
      if (/FROM immutable_ledger/.test(sql)) return { rows: [{ n: ledger }] };
      // tablePk
      if (/contype = 'p'/.test(sql)) return { rows: pk ? [{ pk }] : [] };
      // referencingForeignKeys
      if (/con.contype = 'f'/.test(sql))
        return { rows: children.map((ch) => ({ child_table: ch.table, child_col: ch.column })) };
      // childCount
      const m = /FROM ([a-z_]+) WHERE ([a-z_]+) = \$1/.exec(sql);
      if (m) {
        const hit = children.find((ch) => ch.table === m[1] && ch.column === m[2]);
        return { rows: [{ n: hit ? hit.count : 0 }] };
      }
      // recordPurge insert
      return { rows: [] };
    },
  };
  return c;
}

const softRow = (entityRef) => ({
  soft_delete_id: "11111111-1111-4111-8111-111111111111",
  entity_ref: entityRef,
  payload_json: { id: "22222222-2222-4222-8222-222222222222" },
  deleted_at: new Date().toISOString(),
  restored_at: null,
});

const actor = { user_id: "33333333-3333-4333-8333-333333333333", display_name: "CEO", email: "ceo@t.cm" };

/** Every posting-linked entity prefix the old regex missed or covered. */
const POSTING_PREFIXES = [
  "invoice", "journal", "receipt", "payment", "asset", "payroll",
  "credit_note", "supplier_invoice", "cash_request", "regie", "depreciation",
  "debt", "tax_declaration", "quotation", "disbursement",
];

describe("G5 — purge refuses every posting-linked record the ledger knows", () => {
  for (const prefix of POSTING_PREFIXES) {
    it(`refuses ${prefix}:… when the ledger holds a reference`, async () => {
      const entityRef = `${prefix}:22222222-2222-4222-8222-222222222222`;
      const c = fakeClient({ ledger: 1, softRow: softRow(entityRef) });
      await expect(
        service.purge(c, { actor, softDeleteId: softRow(entityRef).soft_delete_id, pin: "123456", ip: "1.2.3.4" }),
      ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/accounting-connected/) });
      // Nothing may be purged — no recordPurge INSERT happened.
      expect(c.queries.some((q) => /INSERT INTO immutable_ledger/.test(q.sql))).toBe(false);
    });
  }

  it("purges a record the ledger has never seen", async () => {
    const entityRef = "lead:22222222-2222-4222-8222-222222222222";
    const c = fakeClient({ ledger: 0, softRow: softRow(entityRef) });
    const out = await service.purge(c, { actor, softDeleteId: softRow(entityRef).soft_delete_id, pin: "123456", ip: "1.2.3.4" });
    expect(out.purged).toBe(true);
    // The purge itself IS recorded on the ledger (sensitive, MOD-00B).
    expect(c.queries.some((q) => /INSERT INTO immutable_ledger/.test(q.sql))).toBe(true);
  });
});

describe("G5 — dependency preview", () => {
  it("reports ledger refs, purgeability and catalogue-discovered children", async () => {
    const entityRef = "invoice:22222222-2222-4222-8222-222222222222";
    const c = fakeClient({
      ledger: 3,
      softRow: softRow(entityRef),
      children: [
        { table: "invoice_line", column: "invoice_id", count: 2 },
        { table: "payment_allocation", column: "invoice_id", count: 1 },
        { table: "unrelated", column: "invoice_id", count: 0 },
      ],
    });
    const out = await service.dependencies(c, { softDeleteId: softRow(entityRef).soft_delete_id });
    expect(out.entity_ref).toBe(entityRef);
    expect(out.ledger_refs).toBe(3);
    expect(out.purgeable).toBe(false);
    // Zero-count children are dropped; the two real dependents are listed.
    expect(out.children).toEqual([
      { table: "invoice_line", column: "invoice_id", count: 2 },
      { table: "payment_allocation", column: "invoice_id", count: 1 },
    ]);
  });

  it("parses the entity_ref shape every module writes", () => {
    expect(repo.parseEntityRef("invoice:22222222-2222-4222-8222-222222222222")).toEqual({
      table: "invoice",
      id: "22222222-2222-4222-8222-222222222222",
    });
    expect(repo.parseEntityRef("lead:not-a-uuid")).toBeNull();
    expect(repo.parseEntityRef("")).toBeNull();
  });
});
