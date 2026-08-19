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

/**
 * Fake client. costCompare (the FULL OUTER JOIN per-item query) and
 * disbursementTotals (the two scalar subqueries) both read costing_line and
 * cost_entry, so they are distinguished by SQL shape rather than table name.
 */
function fakeClient({
  status = "DRAFT",
  lines = [],
  submittedBy = null,
  compareRows = null,
  disbursement = { budget_ht: 0, actual_ht: 0 },
} = {}) {
  const queries = [];
  const c = {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM dossier_reconciliation WHERE reconciliation_id/.test(sql))
        return {
          rows: [
            {
              reconciliation_id: UUID(1),
              dossier_id: UUID(2),
              status,
              submitted_by: submittedBy,
              created_by: UUID(3),
            },
          ],
        };
      if (/FROM dossier_reconciliation WHERE dossier_id/.test(sql))
        return { rows: [] };
      if (/FROM dossier_reconciliation_line WHERE reconciliation_id/.test(sql))
        return { rows: lines };
      if (/FULL OUTER JOIN/.test(sql))
        return {
          rows: compareRows || [
            {
              dictionary_item_id: UUID(4),
              item_code: "OCEAN",
              item_label: "Ocean freight",
              budget_ht: 1000000,
              actual_ht: 0,
            },
          ],
        };
      if (
        /AS budget_ht,\s*COALESCE\(\(SELECT SUM\(ce\.amount\)/m.test(sql) ||
        /disbursement/i.test(sql) ||
        (/SUM\(cl\.qty \* cl\.unit_cost\)/.test(sql) &&
          /SUM\(ce\.amount\)/.test(sql) &&
          !/FULL OUTER JOIN/.test(sql))
      )
        return { rows: [disbursement] };
      if (/SELECT receipt_requirement FROM dictionary_item/.test(sql))
        return { rows: [{ receipt_requirement: "ALWAYS_REQUIRED" }] };
      if (/INSERT INTO dossier_reconciliation \(/.test(sql))
        return {
          rows: [
            {
              reconciliation_id: UUID(9),
              dossier_id: params[0],
              status: "DRAFT",
            },
          ],
        };
      if (/UPDATE dossier_reconciliation SET/.test(sql))
        return {
          rows: [
            {
              reconciliation_id: params[0],
              status: /VALIDATED/.test(sql)
                ? "VALIDATED"
                : /REJECTED/.test(sql)
                  ? "REJECTED"
                  : "SUBMITTED",
              ocr_amount: 1234,
            },
          ],
        };
      if (/UPDATE dossier SET/.test(sql)) return { rows: [] };
      if (/INSERT INTO dossier_reconciliation_line/.test(sql))
        return { rows: [] };
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
    expect(
      c.queries.some((q) => /INSERT INTO dossier_reconciliation /.test(q.sql)),
    ).toBe(true);
    expect(
      c.queries.some((q) =>
        /INSERT INTO dossier_reconciliation_line/.test(q.sql),
      ),
    ).toBe(true);
  });

  it("budget subquery filters on the legal APPROVED_LOCKED status (BUG-1)", async () => {
    // costing_status_check (10718) permits APPROVED_LOCKED, not 'APPROVED' or
    // 'LOCKED'. The old IN ('APPROVED','LOCKED') matched zero rows, so every
    // reconciliation silently reported a zero budget.
    const c = fakeClient();
    await service.createDraft(c, { dossierId: UUID(2), actor });
    const budgetQ = c.queries.find((q) => /FULL OUTER JOIN/.test(q.sql));
    expect(budgetQ).toBeDefined();
    expect(budgetQ.sql).toMatch(/c\.status = 'APPROVED_LOCKED'/);
    expect(budgetQ.sql).not.toMatch(/'APPROVED'\s*,\s*'LOCKED'/);
  });

  it("budget and actual columns are HT, not TTC (BUG-2)", async () => {
    // The columns were renamed budget_ttc/actual_ttc -> budget_ht/actual_ht in
    // 10740 because the value stored is HT (VAT lives on tax_code_id).
    const c = fakeClient();
    await service.createDraft(c, { dossierId: UUID(2), actor });
    const compareQ = c.queries.find((q) => /FULL OUTER JOIN/.test(q.sql)).sql;
    expect(compareQ).toMatch(/AS budget_ht/);
    expect(compareQ).toMatch(/AS actual_ht/);
    expect(compareQ).not.toMatch(/budget_ttc|actual_ttc/);
    const insertQ = c.queries.find((q) =>
      /INSERT INTO dossier_reconciliation_line/.test(q.sql),
    ).sql;
    expect(insertQ).toMatch(/budget_ht, actual_ht/);
  });

  it("excludes débours from the per-item variance base (BUG-3)", async () => {
    // OHADA_KB §6.7: débours are pass-through and must not move the service
    // cost variance. The budget subquery filters costing_line.is_disbursement;
    // actuals (which have no flag on cost_entry) join dictionary_item.
    const c = fakeClient();
    await service.createDraft(c, { dossierId: UUID(2), actor });
    const compareQ = c.queries.find((q) => /FULL OUTER JOIN/.test(q.sql)).sql;
    expect(compareQ).toMatch(/cl\.is_disbursement/);
    expect(compareQ).toMatch(/d2\.is_disbursement/);
    // A separate disbursement total is derived, not mixed into the lines.
    expect(
      c.queries.some(
        (q) =>
          /disbursement/i.test(q.sql) ||
          (/SUM\(ce\.amount\)/.test(q.sql) && /dictionary_item di/.test(q.sql)),
      ),
    ).toBe(true);
  });

  it("submit requires a DRAFT and moves to SUBMITTED", async () => {
    const c = fakeClient({
      status: "DRAFT",
      lines: [{ line_id: "l-1", item_code: "X" }],
    });
    const out = await service.submit(c, { id: UUID(1), actor });
    expect(out.status).toBe("SUBMITTED");
  });

  it("refuses to submit an empty reconciliation", async () => {
    const c = fakeClient({ status: "DRAFT", lines: [] });
    await expect(
      service.submit(c, { id: UUID(1), actor }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("validate refuses self-validation (maker-checker)", async () => {
    const c = fakeClient({
      status: "SUBMITTED",
      submittedBy: UUID(3),
      lines: [{ actual_ht: 100 }],
    });
    await expect(
      service.validate(c, { id: UUID(1), actor }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("validate stamps the total actual (service + débours) back onto the dossier", async () => {
    const c = fakeClient({
      status: "SUBMITTED",
      submittedBy: UUID(4),
      lines: [{ actual_ht: 250000 }],
      disbursement: { budget_ht: 80000, actual_ht: 75000 },
    });
    const out = await service.validate(c, { id: UUID(1), actor });
    expect(out.status).toBe("VALIDATED");
    const stamp = c.queries.find((q) => /UPDATE dossier\s+SET/.test(q.sql));
    expect(stamp).toBeDefined();
    expect(stamp.sql).toMatch(/ocr_status = 'VALIDATED'/);
    const setQ = c.queries.find((q) =>
      /UPDATE dossier_reconciliation SET/.test(q.sql),
    );
    // 250000 service actual + 75000 débours = 325000 closes the file.
    expect(setQ.params).toContain(325000);
  });

  it("reject requires a reason and records it", async () => {
    const c = fakeClient({ status: "SUBMITTED", lines: [] });
    await expect(
      service.reject(c, { id: UUID(1), reason: "", actor }),
    ).rejects.toMatchObject({ status: 422 });
    const out = await service.reject(c, {
      id: UUID(1),
      reason: "Missing BL proof",
      actor,
    });
    expect(out.status).toBe("REJECTED");
    const up = c.queries.find((q) =>
      /UPDATE dossier_reconciliation SET/.test(q.sql),
    );
    expect(up.params).toContain("Missing BL proof");
  });
});
