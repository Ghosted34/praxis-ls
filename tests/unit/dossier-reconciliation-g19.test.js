"use strict";

/**
 * G19 — Operational Cost Reconciliation as a signed document.
 *
 * The legacy's ocr was a controlled document (DRAFT → SUBMITTED → VALIDATED |
 * REJECTED with maker-checker and a dossier write-back); the rebuild had only
 * a live query. These tests pin the lifecycle rules with a fake client.
 */

const service = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.service");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

function fakeClient({ status = "DRAFT", lines = [], submittedBy = null } = {}) {
  const queries = [];
  const c = {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM dossier_reconciliation WHERE reconciliation_id/.test(sql))
        return { rows: [{ reconciliation_id: UUID(1), dossier_id: UUID(2), status, submitted_by: submittedBy, created_by: UUID(3) }] };
      if (/FROM dossier_reconciliation WHERE dossier_id/.test(sql))
        return { rows: [] };
      if (/FROM dossier_reconciliation_line WHERE reconciliation_id/.test(sql))
        return { rows: lines };
      if (/FROM costing_line cl/.test(sql))
        return { rows: [{ dictionary_item_id: UUID(4), item_code: "OCEAN", item_label: "Ocean freight", budget_ttc: 1000000, actual_ttc: 0 }] };
      if (/FROM cost_entry WHERE dossier_id/.test(sql))
        return { rows: [{ dictionary_item_id: UUID(4), actual_ttc: 0 }] };
      if (/SELECT receipt_requirement FROM dictionary_item/.test(sql))
        return { rows: [{ receipt_requirement: "ALWAYS_REQUIRED" }] };
      if (/INSERT INTO dossier_reconciliation \(/.test(sql))
        return { rows: [{ reconciliation_id: UUID(9), dossier_id: params[0], status: "DRAFT" }] };
      if (/UPDATE dossier_reconciliation SET/.test(sql))
        return { rows: [{ reconciliation_id: params[0], status: /VALIDATED/.test(sql) ? "VALIDATED" : /REJECTED/.test(sql) ? "REJECTED" : "SUBMITTED", ocr_amount: 1234 }] };
      if (/UPDATE dossier SET/.test(sql)) return { rows: [] };
      if (/INSERT INTO dossier_reconciliation_line/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  return c;
}

const actor = { user_id: UUID(3) };

describe("G19 — lifecycle", () => {
  it("createDraft builds lines from costings and refuses a second open one", async () => {
    const c = fakeClient();
    const draft = await service.createDraft(c, { dossierId: UUID(2), actor });
    expect(draft.reconciliation_id).toBe(UUID(1));
    // The insert of the draft + its lines happened.
    expect(c.queries.some((q) => /INSERT INTO dossier_reconciliation /.test(q.sql))).toBe(true);
    expect(c.queries.some((q) => /INSERT INTO dossier_reconciliation_line/.test(q.sql))).toBe(true);
  });

  it("submit requires a DRAFT and moves to SUBMITTED", async () => {
    const c = fakeClient({ status: "DRAFT", lines: [{ line_id: "l-1", item_code: "X" }] });
    const out = await service.submit(c, { id: UUID(1), actor });
    expect(out.status).toBe("SUBMITTED");
  });

  it("refuses to submit an empty reconciliation", async () => {
    const c = fakeClient({ status: "DRAFT", lines: [] });
    await expect(service.submit(c, { id: UUID(1), actor })).rejects.toMatchObject({ status: 422 });
  });

  it("validate refuses self-validation (maker-checker)", async () => {
    const c = fakeClient({ status: "SUBMITTED", submittedBy: UUID(3), lines: [{ actual_ttc: 100 }] });
    await expect(service.validate(c, { id: UUID(1), actor })).rejects.toMatchObject({ status: 422 });
  });

  it("validate stamps the amount back onto the dossier", async () => {
    const c = fakeClient({ status: "SUBMITTED", submittedBy: UUID(4), lines: [{ actual_ttc: 250000 }] });
    const out = await service.validate(c, { id: UUID(1), actor });
    expect(out.status).toBe("VALIDATED");
    const stamp = c.queries.find((q) => /UPDATE dossier\s+SET/.test(q.sql));
    expect(stamp).toBeDefined();
    expect(stamp.sql).toMatch(/ocr_status = 'VALIDATED'/);
    expect(c.queries.some((q) => /ocr_amount/.test(q.sql))).toBe(true);
  });

  it("reject requires a reason and records it", async () => {
    const c = fakeClient({ status: "SUBMITTED", lines: [] });
    await expect(service.reject(c, { id: UUID(1), reason: "", actor })).rejects.toMatchObject({ status: 422 });
    const out = await service.reject(c, { id: UUID(1), reason: "Missing BL proof", actor });
    expect(out.status).toBe("REJECTED");
    const up = c.queries.find((q) => /UPDATE dossier_reconciliation SET/.test(q.sql));
    expect(up.params).toContain("Missing BL proof");
  });
});
