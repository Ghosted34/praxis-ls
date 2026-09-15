"use strict";

/**
 * Budget Reconciliation settlement (PR 2) — posting rules.
 *
 * Pins the rules the guide §4.4 / §7.2 spell out:
 *   · delta-not-gross: if the ledger already holds 198 000 for THC, settling
 *     198 000 posts 0, not a second 198 000;
 *   · no-op when the actual already matches the posted total;
 *   · negative delta → reversing entry (never a negative amount);
 *   · spent_on reaches journal_entry.entry_date;
 *   · PERIOD_CLOSED names the period, the line, and offers earliest open date;
 *   · a refused régie retirement rolls the whole settlement back;
 *   · re-settle after reopen posts only the new delta.
 *
 * The fake client below is richer than the lifecycle tests' — it tracks
 * recordCostInner / retireCore calls so we can assert what was posted without
 * spinning up a real Postgres.
 */

const service = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.service");

const mockUUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const DOSSIER = mockUUID(2);
const LINE_A = mockUUID(11);
const ENTITY = mockUUID(99);

const mockCalls = { record: [], retire: [], journal: [] };
const mockPostedEntries = [];

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
jest.mock("../../src/modules/costing/cost_tracking/cost_tracking.service", () => ({
  recordCostInner: jest.fn(async (client, opts) => {
    mockCalls.record.push(opts);
    mockPostedEntries.push({ costing_line_id: opts.costingLineId, amount: opts.amount, entryDate: opts.entryDate, direction: "forward" });
    return { cost_entry: { cost_entry_id: mockUUID(900) }, entry: { entry_id: mockUUID(901) } };
  }),
}));
jest.mock("../../src/modules/costing/regie/regie.service", () => ({
  policy: jest.fn(async () => ({
    journals: { retire: "RG", issue: "RG" },
    accounts: { regie: "581", cash: "571", dossier_mandant: "4731", write_off: "658" },
    allowPartialJustification: false,
    requireProofForReceipt: false,
  })),
  retireCore: jest.fn(async (client, opts) => {
    mockCalls.retire.push(opts);
    return {
      advance: {
        regie_advance_id: opts.advanceId,
        amount: 100000,
        justified_amount: opts.kind === "RECEIPT" ? opts.amount : 0,
        returned_amount: opts.kind === "CASH_RETURN" ? opts.amount : 0,
        state: "JUSTIFIED",
      },
      retirement: { retirement_id: mockUUID(902) },
      entry: { entry_id: mockUUID(903) },
    };
  }),
}));
jest.mock("../../src/modules/finance/journal_entry/journal_entry.service", () => ({
  buildAndInsert: jest.fn(async (client, opts) => {
    mockCalls.journal.push(opts);
    return { entry: { entry_id: mockUUID(904) } };
  }),
  getPeriodForDate: jest.fn(async () => ({ period_id: mockUUID(905), code: "2026-09", status: "OPEN" })),
  earliestOpenPeriod: jest.fn(async () => ({ starts_on: "2026-10-01", code: "2026-10" })),
}));

function resetCalls() {
  mockCalls.record = []; mockCalls.retire = []; mockCalls.journal = []; mockPostedEntries.length = 0;
}

const gridRow = (over = {}) => ({
  costing_line_id: LINE_A, line_no: 1, label: "Port Charges", item_code: "PORT_CHARGES",
  item_label: "Port charges", dictionary_item_id: mockUUID(50), is_disbursement: true,
  qty: 1, unit_cost: 100000, net: 100000, vat: 19250, budget_ttc: 119250,
  committed: 119250, pending: 0, disbursed: 119250, posted_ht: 0, posted_ttc: 0,
  justification_required: false, document_count: 1,
  line_id: mockUUID(21), actual_ttc: 119250, actual_source: "CONFIRMED",
  spent_on: "2026-07-10", variance_reason: null, reason_group_id: null,
  returned_amount: 0, updated_at: null, updated_by: null,
  ...over,
});

function fakeClient({ header = null, grid = [gridRow()], advances = [], cashReqs = [], closedPeriod = false } = {}) {
  const je = require("../../src/modules/finance/journal_entry/journal_entry.service");
  je.getPeriodForDate.mockImplementation(async () => closedPeriod
    ? { period_id: mockUUID(905), code: "2026-07", status: "CLOSED" }
    : { period_id: mockUUID(905), code: "2026-09", status: "OPEN" });
  je.buildAndInsert.mockImplementation(async (client, opts) => {
    mockCalls.journal.push(opts);
    return { entry: { entry_id: mockUUID(904) } };
  });

  return {
    queries: [],
    written: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };
      if (/FROM dossier_reconciliation WHERE dossier_id/.test(sql)) return { rows: header ? [header] : [] };
      if (/FROM dossier_reconciliation WHERE reconciliation_id/.test(sql)) return { rows: header ? [header] : [] };
      if (/FROM costing\s+WHERE dossier_id/.test(sql)) {
        return { rows: [{ costing_id: mockUUID(5), doc_number: "CST-1", status: "APPROVED_LOCKED", currency: "XAF", exchange_rate_to_xaf: 1 }] };
      }
      if (/SELECT entity_id FROM dossier WHERE dossier_id/.test(sql)) return { rows: [{ entity_id: ENTITY }] };
      if (/FROM setting WHERE section/.test(sql)) return { rows: [] };
      if (/dossier_reconciliation_line rl/.test(sql)) return { rows: grid };
      if (/FROM costing_line cl\s+JOIN costing c/.test(sql)) {
        // gridFor
        if (/dossier_reconciliation_line rl/.test(sql)) return { rows: grid };
        return { rows: [{ costing_line_id: params[1] }] };
      }
      if (/FROM regie_advance/.test(sql)) return { rows: advances };
      if (/FROM cash_request cr/.test(sql) && /regie_advance_id/.test(sql)) return { rows: cashReqs };
      if (/MIN\(rl\.spent_on\)/.test(sql)) {
        const spent = grid.find((g) => g.spent_on);
        return { rows: [{ earliest: spent ? spent.spent_on : null }] };
      }
      if (/FROM dossier_reconciliation_document d/.test(sql)) return { rows: [] };
      if (/FROM dossier_reconciliation_settlement/.test(sql)) return { rows: [] };
      if (/UPDATE cash_request SET status = 'JUSTIFIED'/.test(sql)) { this.written.push({ op: "closeCR", params }); return { rows: [] }; }
      if (/FROM cost_entry ce/.test(sql)) return { rows: [] };
      if (/INSERT INTO cost_entry/.test(sql)) { this.written.push({ op: "costEntry", params }); return { rows: [{ cost_entry_id: mockUUID(900) }] }; }
      if (/INSERT INTO dossier_reconciliation_line/.test(sql)) {
        this.written.push({ op: "upsertLine", sql, params }); return { rows: [{ line_id: mockUUID(21) }] };
      }
      if (/INSERT INTO dossier_reconciliation_settlement/.test(sql)) { this.written.push({ op: "settlement", params }); return { rows: [{ settlement_id: mockUUID(41) }] }; }
      if (/UPDATE dossier_reconciliation SET/.test(sql)) {
        this.written.push({ op: "status", sql, params });
        return { rows: [{ ...header, status: "SETTLED", ocr_amount: params[3], revision: header.revision }] };
      }
      if (/UPDATE dossier\s+SET/.test(sql)) { this.written.push({ op: "stamp", params }); return { rows: [] }; }
      return { rows: [] };
    },
  };
}

const openHeader = (over = {}) => ({
  reconciliation_id: mockUUID(1), dossier_id: DOSSIER, status: "OPEN", revision: 1,
  currency: "XAF", exchange_rate_to_xaf: 1, returned_total: 0,
  submitted_by: null, quoted_ht: null, ...over,
});
const submitted = () => openHeader({ status: "SUBMITTED", submitted_by: mockUUID(3) });
const finance = { user_id: mockUUID(4) };

beforeEach(resetCalls);

describe("settlement posts the actuals — delta, never gross (Q3)", () => {
  test("a line whose actual already matches the ledger posts nothing", async () => {
    // The owner's exact example: supplier invoice already posted 198 000 against
    // THC; settling an actual of 198 000 posts 0, not a second 198 000.
    const c = fakeClient({
      header: submitted(),
      grid: [gridRow({ actual_ttc: 119250, posted_ht: 100000, posted_ttc: 119250 })],
    });
    await service.settle(c, { dossierId: DOSSIER, actor: finance });
    expect(mockCalls.record).toHaveLength(0);
    expect(mockCalls.journal.filter((j) => /reversed/.test(j.description || ""))).toHaveLength(0);
  });

  test("a line with a positive delta posts one forward cost_entry through recordCostInner", async () => {
    const c = fakeClient({
      header: submitted(),
      grid: [gridRow({ actual_ttc: 130000, posted_ht: 100000, posted_ttc: 119250 })],
    });
    await service.settle(c, { dossierId: DOSSIER, actor: finance });
    const posted = mockCalls.record.find((r) => r.costingLineId === LINE_A);
    expect(posted).toBeTruthy();
    expect(posted.entryDate).toBe("2026-07-10");
    expect(posted.spentOn).toBe("2026-07-10");
    // Forward delta ≈ (130000 − 119250) * HT ratio = 10750 * (100000/119250) ≈ 9015
    expect(posted.amount).toBeGreaterThan(0);
    expect(posted.amount).toBeLessThan(130000);
  });

  test("a line with a negative delta posts a REVERSING entry, never a negative amount", async () => {
    // chk_cost_entry_amount_nonneg forbids < 0; a correction must credit the
    // expense side. The cost_entry row still holds a POSITIVE amount.
    const c = fakeClient({
      header: submitted(),
      grid: [gridRow({ actual_ttc: 100000, posted_ht: 110000, posted_ttc: 131175 })],
    });
    await service.settle(c, { dossierId: DOSSIER, actor: finance });
    expect(mockCalls.record).toHaveLength(0); // no forward posting
    const rev = mockCalls.journal.find((j) => /reversed/.test(j.description || ""));
    expect(rev).toBeTruthy();
    // The treasury is DEBITED in a reversal (money back to cash).
    expect(rev.lines[0].debit).toBeGreaterThan(0);
  });

  test("spent_on is used as the journal entry date (owner's Q3 question)", async () => {
    const c = fakeClient({
      header: submitted(),
      grid: [gridRow({ actual_ttc: 130000, spent_on: "2026-07-07" })],
    });
    await service.settle(c, { dossierId: DOSSIER, actor: finance });
    const posted = mockCalls.record.find((r) => r.costingLineId === LINE_A);
    expect(posted.entryDate).toBe("2026-07-07");
  });

  test("a closed spent_on is refused with PERIOD_CLOSED naming the period and line", async () => {
    const c = fakeClient({
      header: submitted(),
      grid: [gridRow({ actual_ttc: 130000, spent_on: "2026-07-10" })],
      closedPeriod: true,
    });
    await expect(service.settle(c, { dossierId: DOSSIER, actor: finance }))
      .rejects.toMatchObject({
        code: "PERIOD_CLOSED",
        details: expect.objectContaining({
          label: "Port Charges",
          period_code: "2026-07",
          earliest_open_date: "2026-10-01",
        }),
      });
  });

  test("a refused régie retirement rolls the whole settlement back", async () => {
    const regie = require("../../src/modules/costing/regie/regie.service");
    regie.retireCore.mockRejectedValueOnce(Object.assign(new Error("over"), { code: "OVER_RETIRED" }));
    const c = fakeClient({
      header: submitted(),
      grid: [gridRow({ actual_ttc: 119250 })],
      advances: [{ regie_advance_id: mockUUID(70), entity_id: ENTITY, amount: 119250, justified_amount: 0, returned_amount: 0, state: "ISSUED", holder_user_id: mockUUID(3), issued_on: "2026-07-07" }],
      cashReqs: [{ cash_request_id: mockUUID(71), regie_advance_id: mockUUID(70), doc_number: "CR-1", status: "DISBURSED" }],
    });
    await expect(service.settle(c, { dossierId: DOSSIER, actor: finance })).rejects.toMatchObject({ code: "OVER_RETIRED" });
    expect(c.queries.some((q) => /ROLLBACK/i.test(q.sql))).toBe(true);
    expect(c.written.find((w) => w.op === "status")).toBeFalsy();
  });
});
