"use strict";
/** final_invoice lifecycle (BUILD_CONVENTIONS): draft → submit → auto-post (number + capture). */
jest.mock(
  "../../src/modules/finance/journal_entry/journal_entry.service",
  () => ({
    buildAndInsert: jest
      .fn()
      .mockResolvedValue({ entry: { entry_id: "je1" }, lines: [] }),
  }),
);
jest.mock("../../src/services/accounting/determination", () => ({
  resolve: jest
    .fn()
    .mockResolvedValue({
      lines: [{ account_code: "4111", debit: 1192500, credit: 0 }],
      totals: {
        subtotal_ht: 1000000,
        disbursement_total: 0,
        tax_total: 192500,
        total: 1192500,
      },
    }),
}));
jest.mock("../../src/services/documents/numbering.service", () => ({
  allocate: jest
    .fn()
    .mockResolvedValue({ number: "SMLS-INV-2026-0001", seq: 1, year: 2026 }),
}));
jest.mock("../../src/services/documents/document.service", () => ({
  capture: jest.fn().mockResolvedValue({ doc_id: "d1" }),
}));
jest.mock("../../src/services/workflow/executor", () => ({
  start: jest.fn().mockResolvedValue({ autoApproved: true }),
}));
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: jest.fn().mockResolvedValue(),
  audit: jest.fn().mockResolvedValue(),
}));

const numbering = require("../../src/services/documents/numbering.service");
const documents = require("../../src/services/documents/document.service");
const executor = require("../../src/services/workflow/executor");
const service = require("../../src/modules/finance/final_invoice/final_invoice.service");

// Minimal stateful fake client around a single invoice + its lines.
function fakeClient(initial) {
  const st = { invoice: initial || null, lines: [] };
  return {
    st,
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(s)) return { rows: [] };
      if (/^INSERT INTO invoice \(/.test(s)) {
        st.invoice = {
          invoice_id: "inv1",
          entity_id: "e1",
          client_id: null,
          dossier_id: null,
          status: "DRAFT",
          type: "FINAL",
        };
        return { rows: [st.invoice] };
      }
      if (/^INSERT INTO invoice_line/.test(s)) {
        st.lines.push({
          invoice_line_id: "l" + st.lines.length,
          line_ht: params[params.length - 2],
          is_disbursement: false,
        });
        return { rows: [{}] };
      }
      if (/^DELETE FROM invoice_line/.test(s)) {
        st.lines = [];
        return { rows: [] };
      }
      if (/^SELECT \* FROM invoice_line/.test(s))
        return {
          rows: st.lines.length
            ? st.lines
            : [
                {
                  dictionary_item_id: "i1",
                  line_ht: 1000000,
                  is_disbursement: false,
                },
              ],
        };
      // PERF S20 quoted every identifier in query-helpers.getById, so this
      // arrives as `WHERE "invoice_id" = $1`. The regex matched the unquoted
      // form only and this fake returns {rows: []} for anything unmatched —
      // which is precisely TC-Q3's complaint about these fakes, seen from the
      // inside: a query-shape change becomes "Invoice not found".
      if (/^SELECT \* FROM invoice WHERE "?invoice_id"?/.test(s))
        return { rows: st.invoice ? [st.invoice] : [] };
      if (/^UPDATE invoice SET /.test(s)) {
        const status = params[1];
        st.invoice = {
          ...st.invoice,
          status,
          ...(status === "POSTED_LOCKED" ? { doc_number: params[2] } : {}),
        };
        return { rows: [st.invoice] };
      }
      if (/^SELECT advance_id/.test(s)) return { rows: [] };

      /**
       * TC-Q3 — THROW on unrecognised SQL. Do not return `{ rows: [] }`.
       *
       * This line used to be `return { rows: [] }`, which made the fake
       * incapable of noticing anything: a wrong WHERE clause, a dropped
       * tenant/entity filter, a changed column list, or a query that was never
       * issued at all, each arrived as "no rows" and the test carried on to
       * assert something else. The comment eleven lines above is the proof — a
       * real query-shape change (S20's identifier quoting) turned into "Invoice
       * not found", and the fake said nothing.
       *
       * An empty result is a LEGITIMATE ANSWER to some queries and a SILENT
       * FAILURE for the rest, and a catch-all cannot tell them apart. So the
       * catch-all is gone: every query this service issues must be matched
       * above, and adding one to the service means adding it here. That is the
       * cost, and it is the point — it is what makes the fake disagree with a
       * change instead of absorbing it.
       *
       * Adapted from tests/unit/wms-inventory.test.js, where writing a strict
       * fake caught two genuine mismatches during authoring. This is still a
       * fake and still cannot prove the SQL is CORRECT — only a real database
       * does that (TC-C6, and the integration job now runs one). What it can do
       * is stop being confidently wrong.
       */
      throw new Error(
        `Unmatched SQL in fakeClient — the fake does not model this query, so any assertion after it is meaningless.\n` +
          `If final_invoice.service issues this legitimately, add a branch for it above.\n\n  ${s.slice(0, 300)}`,
      );
    },
  };
}

beforeEach(() => jest.clearAllMocks());

describe("final invoice lifecycle", () => {
  it("creates a DRAFT (no GL, no number)", async () => {
    const c = fakeClient(null);
    const inv = await service.createDraft(c, {
      entityId: "e1",
      lines: [{ dictionary_item_id: "i1", amount: 1000000 }],
      actor: {},
    });
    expect(inv.status).toBe("DRAFT");
    expect(numbering.allocate).not.toHaveBeenCalled();
  });

  it("submit with no workflow auto-posts: numbers + captures the document", async () => {
    const c = fakeClient({
      invoice_id: "inv1",
      entity_id: "e1",
      client_id: null,
      dossier_id: null,
      status: "DRAFT",
      type: "FINAL",
    });
    c.st.lines = [
      { dictionary_item_id: "i1", line_ht: 1000000, is_disbursement: false },
    ];
    const r = await service.submit(c, {
      invoiceId: "inv1",
      entryDate: "2026-02-01",
      sourceDocRef: "vault:doc",
      actor: {},
    });
    expect(executor.start).toHaveBeenCalled();
    expect(numbering.allocate).toHaveBeenCalledWith(
      c,
      expect.objectContaining({ moduleKey: "MOD-51", entityId: "e1" }),
    );
    expect(documents.capture).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        entityRef: "invoice:inv1",
        docType: "FINAL_INVOICE",
      }),
    );
    expect(r.posted.doc_number).toBe("SMLS-INV-2026-0001");
    expect(r.invoice.status).toBe("POSTED_LOCKED");
  });

  it("rejects editing a locked invoice", async () => {
    const c = fakeClient({
      invoice_id: "inv1",
      status: "POSTED_LOCKED",
      type: "FINAL",
    });
    await expect(
      service.updateDraft(c, { invoiceId: "inv1", patch: {}, actor: {} }),
    ).rejects.toThrow(/DRAFT/);
  });
});
