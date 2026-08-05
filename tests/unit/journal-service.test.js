"use strict";
/**
 * Service-orchestration tests for the ledger posting engine, with the repo and
 * event layers mocked (no database). Verifies the posting workflow: draft insert
 * → line insert → validate, gap-free entry_no use, event emission, and the
 * reversal contra-swap (#23.16). The DB triggers are covered separately by an
 * integration test that runs when DATABASE_URL is set.
 */
jest.mock("../../src/modules/finance/journal_entry/journal_entry.repo");
jest.mock("../../src/shared/events/emit", () => ({ emitEvent: jest.fn().mockResolvedValue(), audit: jest.fn().mockResolvedValue() }));

const repo = require("../../src/modules/finance/journal_entry/journal_entry.repo");
const { emitEvent } = require("../../src/shared/events/emit");
const service = require("../../src/modules/finance/journal_entry/journal_entry.service");

function fakeClient() {
  return { calls: [], query(sql) { this.calls.push(String(sql).trim().split(/\s+/)[0].toUpperCase()); return Promise.resolve({ rows: [] }); } };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.getJournal.mockResolvedValue({ journal_id: "J1" });
  repo.getPeriodForDate.mockResolvedValue({ period_id: "P1", status: "OPEN", code: "2026-01" });
  repo.lockSequence.mockResolvedValue();
  repo.nextEntryNo.mockResolvedValue(7);
  repo.insertEntry.mockImplementation((_c, d) => Promise.resolve({ entry_id: "E1", ...d }));
  repo.insertLine.mockImplementation((_c, d) => Promise.resolve({ line_id: "L" + d.line_no, ...d }));
  repo.setStatus.mockImplementation((_c, id, patch) => Promise.resolve({ entry_id: id, ...patch }));
});

const baseInput = {
  journalCode: "BQ", entityId: "ent-1", entryDate: "2026-01-15",
  sourceDocRef: "vault:doc-1", source: "SYSTEM_AUTO",
  lines: [ { account_code: "521", debit: 1000, credit: 0 }, { account_code: "4191", debit: 0, credit: 1000 } ],
  actor: { user_id: "u1" },
};

describe("posting service", () => {
  it("posts a balanced entry: draft insert, lines, validate, event", async () => {
    const c = fakeClient();
    const { entry, lines } = await service.post(c, baseInput);
    expect(repo.insertEntry).toHaveBeenCalledWith(c, expect.objectContaining({ status: "draft", entry_no: 7, journal_id: "J1", period_id: "P1" }));
    expect(repo.insertLine).toHaveBeenCalledTimes(2);
    expect(repo.setStatus).toHaveBeenCalledWith(c, "E1", expect.objectContaining({ status: "validated" }));
    expect(entry.status).toBe("validated");
    expect(lines).toHaveLength(2);
    expect(emitEvent).toHaveBeenCalledWith(c, expect.objectContaining({ eventTypeKey: "journal.posted" }));
    expect(c.calls).toContain("BEGIN");
    expect(c.calls).toContain("COMMIT");
  });

  // Asserts the CODE, not the sentence: the wording moved to packages/shared and
  // is now written for an operator, while the code is the 422 body's contract.
  it("rolls back and rejects an unbalanced entry", async () => {
    const c = fakeClient();
    const bad = { ...baseInput, lines: [ { account_code: "521", debit: 1000, credit: 0 }, { account_code: "4191", debit: 0, credit: 999 } ] };
    await expect(service.post(c, bad)).rejects.toMatchObject({ code: "ENTRY_UNBALANCED" });
    expect(c.calls).toContain("ROLLBACK");
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it("requires source_doc_ref to validate (#23.11)", async () => {
    const c = fakeClient();
    const noDoc = { ...baseInput, sourceDocRef: undefined };
    await expect(service.post(c, noDoc)).rejects.toThrow(/source_doc_ref/i);
  });

  it("rejects posting into a non-open period", async () => {
    repo.getPeriodForDate.mockResolvedValue({ period_id: "P1", status: "CLOSED", code: "2026-01" });
    const c = fakeClient();
    await expect(service.post(c, baseInput)).rejects.toThrow(/CLOSED/);
  });

  it("reverses a validated entry by swapping debit/credit (#23.16)", async () => {
    repo.getEntry.mockResolvedValue({ entry_id: "E1", status: "validated", journal_id: "J1", entity_id: "ent-1", entry_no: 7, source_doc_ref: "vault:doc-1" });
    repo.listLines.mockResolvedValue([
      { account_code: "521", debit: "1000.00", credit: "0.00" },
      { account_code: "4191", debit: "0.00", credit: "1000.00" },
    ]);
    const c = fakeClient();
    await service.reverse(c, { entryId: "E1", reason: "typo", actor: { user_id: "u1" } });
    // contra: original debit line becomes a credit line and vice-versa
    const linePayloads = repo.insertLine.mock.calls.map((call) => call[1]);
    expect(linePayloads[0]).toMatchObject({ account_code: "521", debit: "0.00", credit: "1000.00" });
    expect(linePayloads[1]).toMatchObject({ account_code: "4191", debit: "1000.00", credit: "0.00" });
    expect(repo.insertEntry).toHaveBeenCalledWith(c, expect.objectContaining({ source: "HUMAN_CORRECTION", corrects_entry_id: "E1" }));
    expect(emitEvent).toHaveBeenCalledWith(c, expect.objectContaining({ eventTypeKey: "journal.reversed" }));
  });

  it("refuses to reverse a draft entry", async () => {
    repo.getEntry.mockResolvedValue({ entry_id: "E1", status: "draft" });
    const c = fakeClient();
    await expect(service.reverse(c, { entryId: "E1", actor: {} })).rejects.toThrow(/validated/i);
  });
});
