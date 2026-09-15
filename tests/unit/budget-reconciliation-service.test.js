"use strict";

/**
 * Budget Reconciliation — the lifecycle (MOD-76).
 *
 * ONE reconciliation per file, for ever (owner decision Q6). It does not close;
 * it settles, and re-opens when the costing is amended or more cash goes out.
 * Operations prepares, Finance settles, the MD is told.
 *
 * The property these tests exist to pin hardest is the one the whole design
 * rests on: THE GRID IS PROJECTED FROM `costing_line`, NOT COPIED. A line the
 * costing gained after settlement is simply there on the next read, and the
 * values a person typed on the lines that did not change are untouched.
 */

const service = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.service");
const { schemas } = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.validator");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const DOSSIER = UUID(2);
const LINE_A = UUID(11);
const LINE_B = UUID(12);

const gridRow = (over = {}) => ({
  costing_line_id: LINE_A,
  line_no: 1,
  label: "Port Charges",
  item_code: "PORT_CHARGES",
  item_label: "Port charges",
  is_disbursement: true,
  qty: 1,
  unit_cost: 100000,
  net: 100000,
  vat: 19250,
  budget_ttc: 119250,
  committed: 119250,
  pending: 0,
  disbursed: 119250,
  justification_required: false,
  document_count: 0,
  line_id: null,
  actual_ttc: null,
  actual_source: null,
  spent_on: null,
  variance_reason: null,
  reason_group_id: null,
  returned_amount: 0,
  ...over,
});

/**
 * Fake client, routed by SQL shape. `grid` is what `gridFor` returns and is the
 * single knob most tests turn — it is the projection, so it is also how a
 * "costing was amended" is expressed.
 */
function fakeClient({
  header = null,
  grid = [gridRow()],
  costing = { costing_id: UUID(5), doc_number: "CST-2026-0043", status: "APPROVED_LOCKED", currency: "XAF", exchange_rate_to_xaf: 1 },
  storedLine = null,
  lineOnDossier = true,
} = {}) {
  const queries = [];
  const c = {
    queries,
    written: [],
    async query(sql, params) {
      queries.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };

      if (/FROM dossier_reconciliation WHERE dossier_id/.test(sql)) return { rows: header ? [header] : [] };
      if (/FROM dossier_reconciliation WHERE reconciliation_id/.test(sql)) return { rows: header ? [header] : [] };
      if (/FROM costing\s+WHERE dossier_id/.test(sql)) return { rows: costing ? [costing] : [] };
      if (/FROM setting WHERE section/.test(sql)) return { rows: [] };
      if (/FROM costing_line cl\s+JOIN costing c/.test(sql) && /ORDER BY cl\.line_no, cl\.costing_line_id/.test(sql) && /dossier_reconciliation_line rl/.test(sql))
        return { rows: grid };
      if (/FROM costing_line cl\s+JOIN costing c/.test(sql)) return { rows: lineOnDossier ? [{ costing_line_id: params[1] }] : [] };
      if (/FROM dossier_reconciliation_document d/.test(sql)) return { rows: [] };
      if (/FROM dossier_reconciliation_settlement/.test(sql)) return { rows: [] };
      if (/FROM dossier_reconciliation_line\s+WHERE reconciliation_id = \$1 AND costing_line_id/.test(sql))
        return { rows: storedLine ? [storedLine] : [] };

      if (/INSERT INTO dossier_reconciliation \(/.test(sql)) {
        c.written.push({ op: "open", params });
        return { rows: [openHeader({ dossier_id: params[0] })] };
      }
      if (/INSERT INTO dossier_reconciliation_line/.test(sql)) {
        c.written.push({ op: "upsertLine", sql, params });
        return { rows: [{ line_id: UUID(21), reconciliation_id: params[0], costing_line_id: params[1] }] };
      }
      if (/INSERT INTO dossier_reconciliation_document/.test(sql)) { c.written.push({ op: "attach", params }); return { rows: [{ recon_document_id: UUID(31) }] }; }
      if (/INSERT INTO dossier_reconciliation_settlement/.test(sql)) { c.written.push({ op: "settlement", params }); return { rows: [{ settlement_id: UUID(41) }] }; }
      if (/UPDATE dossier_reconciliation_line SET/.test(sql)) { c.written.push({ op: "clear", sql, params }); return { rows: [] }; }
      if (/UPDATE dossier_reconciliation SET/.test(sql)) {
        c.written.push({ op: "status", sql, params });
        const status = /'SETTLED'/.test(sql) ? "SETTLED" : /'SUBMITTED'/.test(sql) ? "SUBMITTED" : "OPEN";
        return { rows: [{ ...header, status, ocr_amount: params[3], revision: (header ? header.revision : 1) + (/revision \+ 1/.test(sql) ? 1 : 0) }] };
      }
      if (/UPDATE dossier\s+SET/.test(sql)) { c.written.push({ op: "stamp", params }); return { rows: [] }; }
      if (/DELETE FROM dossier_reconciliation_document/.test(sql)) { c.written.push({ op: "detach", params }); return { rowCount: 1, rows: [] }; }
      return { rows: [] };
    },
  };
  return c;
}

const openHeader = (over = {}) => ({
  reconciliation_id: UUID(1), dossier_id: DOSSIER, status: "OPEN", revision: 1,
  currency: "XAF", exchange_rate_to_xaf: 1, returned_total: 0,
  submitted_by: null, quoted_ht: null, ...over,
});

const ops = { user_id: UUID(3) };
const finance = { user_id: UUID(4) };

describe("reads never write", () => {
  test("a file nobody has touched renders its whole budget with no row created", async () => {
    const c = fakeClient();
    const sheet = await service.sheetFor(c, { dossierId: DOSSIER });
    expect(sheet.reconciliation_id).toBeNull();
    expect(sheet.status).toBe("OPEN");
    expect(sheet.lines).toHaveLength(1);
    expect(sheet.lines[0].budget_ttc).toBe(119250);
    expect(c.written).toEqual([]);
  });

  test("no approved costing → the sheet explains itself instead of improvising a grid", async () => {
    // Owner decision Q11: no spend on an operations file without an approved
    // costing, so there is nothing to reconcile against and saying so beats
    // rendering an empty table.
    const c = fakeClient({ costing: { costing_id: UUID(5), doc_number: "CST-1", status: "DRAFT" } });
    const sheet = await service.sheetFor(c, { dossierId: DOSSIER });
    expect(sheet.can_reconcile).toBe(false);
    expect(sheet.blocked_reason).toMatch(/DRAFT/);
    expect(sheet.lines).toEqual([]);
  });

  test("no costing at all says so in different words", async () => {
    const c = fakeClient({ costing: null });
    const sheet = await service.sheetFor(c, { dossierId: DOSSIER });
    expect(sheet.can_reconcile).toBe(false);
    expect(sheet.blocked_reason).toMatch(/no costing yet/i);
  });
});

describe("recording what was spent", () => {
  test("the first edit opens the header — the row is as lazy as the lines", async () => {
    const c = fakeClient();
    await service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: { actual_ttc: 131250 }, actor: ops });
    expect(c.written.find((w) => w.op === "open")).toBeTruthy();
    expect(c.written.find((w) => w.op === "upsertLine")).toBeTruthy();
  });

  test("editing with no approved costing is refused, with the costing named", async () => {
    const c = fakeClient({ costing: { costing_id: UUID(5), status: "DRAFT" } });
    await expect(
      service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: { actual_ttc: 1 }, actor: ops }),
    ).rejects.toMatchObject({ code: "NO_APPROVED_COSTING" });
  });

  test("typing the number the grid already showed is CONFIRMED, not OVERRIDDEN", async () => {
    // Agreeing is a real act and is worth telling apart from never looking.
    const c = fakeClient({ header: openHeader() });
    await service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: { actual_ttc: 119250 }, actor: ops });
    const write = c.written.find((w) => w.op === "upsertLine");
    expect(write.params[3]).toBe("CONFIRMED");
  });

  test("typing a different number is OVERRIDDEN", async () => {
    const c = fakeClient({ header: openHeader() });
    await service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: { actual_ttc: 131250 }, actor: ops });
    expect(c.written.find((w) => w.op === "upsertLine").params[3]).toBe("OVERRIDDEN");
  });

  test("an omitted field is left alone; an explicit null clears it", async () => {
    // The upsert COALESCEs, so "absent" and "null" would otherwise be the same
    // instruction — and they mean opposite things to a person.
    const c = fakeClient({ header: openHeader() });
    await service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: { spent_on: null }, actor: ops });
    const cleared = c.written.find((w) => w.op === "clear");
    expect(cleared.sql).toMatch(/spent_on = NULL/);
  });

  test("a reason typed on one line leaves the group it was sharing", async () => {
    const c = fakeClient({ header: openHeader() });
    await service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: { variance_reason: "Tariff rose on 01/07/2026" }, actor: ops });
    expect(c.written.find((w) => w.op === "clear").sql).toMatch(/reason_group_id = NULL/);
  });

  test("a budget line from another file is refused", async () => {
    const c = fakeClient({ header: openHeader(), lineOnDossier: false });
    await expect(
      service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_B, fields: { actual_ttc: 1 }, actor: ops }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a submitted sheet cannot be edited under the reviewer", async () => {
    const c = fakeClient({ header: openHeader({ status: "SUBMITTED" }) });
    await expect(
      service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: { actual_ttc: 1 }, actor: ops }),
    ).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  test("an empty patch is refused rather than silently doing nothing", async () => {
    const c = fakeClient({ header: openHeader() });
    await expect(
      service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: {}, actor: ops }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("one reason, several lines (Q12)", () => {
  test("applies the same sentence and one group id across every line picked", async () => {
    const c = fakeClient({ header: openHeader() });
    await service.applyReason(c, {
      dossierId: DOSSIER, reason: "Customs network outage held the box an extra day",
      costingLineIds: [LINE_A, LINE_B], actor: ops,
    });
    const write = c.written.find((w) => w.op === "upsertLine" && /unnest/.test(w.sql));
    expect(write.params[1]).toEqual([LINE_A, LINE_B]);
    expect(write.params[2]).toMatch(/network outage/);
    expect(write.params[3]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("refuses an empty selection and a reason with no words in it", async () => {
    const c = fakeClient({ header: openHeader() });
    await expect(service.applyReason(c, { dossierId: DOSSIER, reason: "ok", costingLineIds: [LINE_A], actor: ops }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.applyReason(c, { dossierId: DOSSIER, reason: "a real reason", costingLineIds: [], actor: ops }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("documents — many per line (Q8)", () => {
  test("attaching before the amount is typed creates the line row first", async () => {
    // A person can come back with the receipt before they know the figure, and
    // that order is not wrong.
    const c = fakeClient({ header: openHeader() });
    await service.attachDocument(c, { dossierId: DOSSIER, costingLineId: LINE_A, docId: UUID(30), actor: ops });
    const ops_ = c.written.map((w) => w.op);
    expect(ops_.indexOf("upsertLine")).toBeLessThan(ops_.indexOf("attach"));
  });

  test("a second document sits beside the first rather than replacing it", async () => {
    const c = fakeClient({ header: openHeader(), storedLine: { line_id: UUID(21) } });
    await service.attachDocument(c, { dossierId: DOSSIER, costingLineId: LINE_A, docId: UUID(30), actor: ops });
    await service.attachDocument(c, { dossierId: DOSSIER, costingLineId: LINE_A, docId: UUID(32), actor: ops });
    const attached = c.written.filter((w) => w.op === "attach");
    expect(attached).toHaveLength(2);
    expect(attached[0].params[1]).not.toBe(attached[1].params[1]);
  });

  test("detaching removes the link and never the vault row", async () => {
    const c = fakeClient({ header: openHeader(), storedLine: { line_id: UUID(21) } });
    await service.detachDocument(c, { dossierId: DOSSIER, costingLineId: LINE_A, docId: UUID(30), actor: ops });
    expect(c.written.find((w) => w.op === "detach")).toBeTruthy();
    expect(c.queries.some((q) => /DELETE FROM document_vault/.test(q.sql))).toBe(false);
  });
});

describe("submit — both gates, reported together", () => {
  test("a missing reason and a missing receipt come back in ONE error", async () => {
    const c = fakeClient({
      header: openHeader(),
      grid: [
        gridRow({ line_id: UUID(21), actual_ttc: 131250, actual_source: "OVERRIDDEN" }),
        gridRow({ costing_line_id: LINE_B, label: "Customs", line_id: UUID(22), actual_ttc: 50000, actual_source: "OVERRIDDEN", justification_required: true }),
      ],
    });
    await expect(service.submit(c, { dossierId: DOSSIER, actor: ops })).rejects.toMatchObject({
      code: "SUBMISSION_BLOCKED",
      details: { blockers: expect.arrayContaining([expect.objectContaining({ kind: "REASON" }), expect.objectContaining({ kind: "PROOF" })]) },
    });
  });

  test("a clean sheet submits and clears any previous rejection", async () => {
    const c = fakeClient({
      header: openHeader({ reject_reason: "figures looked wrong" }),
      grid: [gridRow({ line_id: UUID(21), actual_ttc: 119250, actual_source: "CONFIRMED" })],
    });
    await service.submit(c, { dossierId: DOSSIER, actor: ops });
    const status = c.written.find((w) => w.op === "status");
    expect(status.sql).toMatch(/status = 'SUBMITTED'/);
    expect(status.sql).toMatch(/reject_reason = NULL/);
  });

  test("a file whose costing has no lines has nothing to submit", async () => {
    const c = fakeClient({ header: openHeader(), grid: [] });
    await expect(service.submit(c, { dossierId: DOSSIER, actor: ops }))
      .rejects.toMatchObject({ code: "EMPTY_RECONCILIATION" });
  });
});

describe("settle — Finance's visa, and maker-checker", () => {
  const submitted = () => openHeader({ status: "SUBMITTED", submitted_by: ops.user_id });

  test("the person who submitted cannot settle", async () => {
    // The legacy granted OPERATIONS on validate.php, so Operations could sign
    // off its own submission. That is the hole this closes.
    const c = fakeClient({ header: submitted(), grid: [gridRow({ line_id: UUID(21), actual_ttc: 119250 })] });
    await expect(service.settle(c, { dossierId: DOSSIER, actor: ops }))
      .rejects.toMatchObject({ code: "SELF_SETTLE" });
  });

  test("Finance settles, records what came back, and stamps the file", async () => {
    const c = fakeClient({
      header: submitted(),
      grid: [gridRow({ line_id: UUID(21), actual_ttc: 100000, actual_source: "OVERRIDDEN", returned_amount: 19250 })],
    });
    await service.settle(c, { dossierId: DOSSIER, returned: { [LINE_A]: 19250 }, actor: finance });
    expect(c.written.find((w) => w.op === "status").sql).toMatch(/status = 'SETTLED'/);
    expect(c.written.find((w) => w.op === "settlement")).toBeTruthy();
    const stamp = c.written.find((w) => w.op === "stamp");
    expect(stamp.params[3]).toBe("SETTLED");
  });

  test("settling an OPEN sheet is refused — it has not been handed over", async () => {
    const c = fakeClient({ header: openHeader() });
    await expect(service.settle(c, { dossierId: DOSSIER, actor: finance }))
      .rejects.toMatchObject({ code: "BAD_STATE" });
  });

  test("a returned amount naming a line from another file rolls the whole thing back", async () => {
    const c = fakeClient({ header: submitted(), lineOnDossier: false });
    await expect(service.settle(c, { dossierId: DOSSIER, returned: { [LINE_B]: 5 }, actor: finance }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(c.queries.some((q) => /ROLLBACK/i.test(q.sql))).toBe(true);
  });
});

describe("reject — straight back to OPEN, with the reason", () => {
  test("a living sheet has no REJECTED state to rest in", async () => {
    const c = fakeClient({ header: openHeader({ status: "SUBMITTED", submitted_by: ops.user_id }) });
    await service.reject(c, { dossierId: DOSSIER, reason: "Customs figure does not match the receipt", actor: finance });
    expect(c.written.find((w) => w.op === "status").sql).toMatch(/status = 'OPEN'/);
  });

  test("a rejection with no reason is refused — the preparer gets it verbatim", async () => {
    const c = fakeClient({ header: openHeader({ status: "SUBMITTED" }) });
    await expect(service.reject(c, { dossierId: DOSSIER, reason: "", actor: finance }))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });
});

describe("the living sheet — the property the whole design rests on (Q6)", () => {
  test("a line the costing gained after settlement is simply THERE, with the others untouched", async () => {
    // The owner's worked example: the container stays a 12th day, demurrage is
    // added to the costing and re-approved. Because the grid is projected from
    // costing_line rather than copied, nothing here has to be rebuilt — and the
    // actual somebody typed on Port Charges last month is still on it.
    const settled = openHeader({ status: "SETTLED", revision: 1 });
    const c = fakeClient({
      header: settled,
      grid: [
        gridRow({ line_id: UUID(21), actual_ttc: 119250, actual_source: "CONFIRMED" }),
        gridRow({ costing_line_id: LINE_B, line_no: 2, label: "Demurrage 1 day", budget_ttc: 160000, net: 160000, vat: 0, committed: 160000, disbursed: 160000 }),
      ],
    });
    const sheet = await service.sheetFor(c, { dossierId: DOSSIER });
    expect(sheet.lines).toHaveLength(2);
    expect(sheet.lines[0].actual_ttc).toBe(119250);
    expect(sheet.lines[0].actual_source).toBe("CONFIRMED");
    expect(sheet.lines[1].label).toBe("Demurrage 1 day");
    expect(sheet.lines[1].actual_source).toBe("DERIVED");
    expect(c.written).toEqual([]);
  });

  test("re-opening bumps the revision and puts it back on Operations' desk", async () => {
    const c = fakeClient({ header: openHeader({ status: "SETTLED", revision: 1, ocr_amount: 119250 }) });
    await service.reopen(c, { dossierId: DOSSIER, reason: "Demurrage added to the costing", actor: finance });
    const status = c.written.find((w) => w.op === "status");
    expect(status.sql).toMatch(/revision = revision \+ 1/);
    expect(status.sql).toMatch(/submitted_by = NULL/);
    expect(c.written.find((w) => w.op === "stamp").params[3]).toBe("OPEN");
  });

  test("re-opening a sheet that is not settled does nothing", async () => {
    const c = fakeClient({ header: openHeader() });
    expect(await service.reopen(c, { dossierId: DOSSIER, reason: "x", actor: finance })).toBeNull();
    expect(c.written).toEqual([]);
  });
});

/**
 * What the DATABASE no longer enforces, and the code must.
 *
 * 13801 could not add a CHECK to `dossier_reconciliation_line`: a constraint on
 * a pre-existing table above 13791 aborts provisioning for every new tenant
 * (tests/unit/migration-constraint-ordering.test.js). The migration says the
 * two rules are enforced in code instead. These are that promise, kept — the
 * half of the trade that makes it honest rather than a hole.
 */
describe("the rules the migration could not make constraints", () => {
  test("a caller cannot set actual_source — the service derives it", () => {
    // The CHECK would have been actual_source IN ('DERIVED','CONFIRMED',
    // 'OVERRIDDEN'). The schema is .strict(), so the field is not merely
    // ignored, it is REFUSED — which is stronger than the constraint was.
    const bad = schemas.patchLine.safeParse({ actual_ttc: 100, actual_source: "CONFIRMED" });
    expect(bad.success).toBe(false);
    const good = schemas.patchLine.safeParse({ actual_ttc: 100 });
    expect(good.success).toBe(true);
    expect(good.data.actual_source).toBeUndefined();
  });

  test("derived, not trusted: confirming the shown figure vs replacing it", async () => {
    const c = fakeClient({ header: openHeader() });
    await service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_A, fields: { actual_ttc: 119250 }, actor: ops });
    expect(c.written.find((w) => w.op === "upsertLine").params[3]).toBe("CONFIRMED");
  });

  test("negative money is refused on every amount the sheet writes", () => {
    // The CHECK would have been actual_ttc >= 0 AND returned_amount >= 0.
    expect(schemas.patchLine.safeParse({ actual_ttc: -1 }).success).toBe(false);
    expect(schemas.patchLine.safeParse({ returned_amount: -1 }).success).toBe(false);
    expect(schemas.settle.safeParse({ returned: { [LINE_A]: -1 } }).success).toBe(false);
    expect(schemas.patchLine.safeParse({ actual_ttc: 0 }).success).toBe(true);
  });

  test("spent_on takes the wire format, and nothing else", () => {
    // ISO on the wire is what every date column and the @shared validators are
    // built on; dd/mm/yyyy is what a PERSON reads, and DateField converts.
    expect(schemas.patchLine.safeParse({ spent_on: "2026-07-27" }).success).toBe(true);
    expect(schemas.patchLine.safeParse({ spent_on: "27/07/2026" }).success).toBe(false);
    // Explicitly clearing it is a different instruction from omitting it.
    expect(schemas.patchLine.safeParse({ spent_on: null }).success).toBe(true);
  });

  test("a budget line from another file is refused, which the dropped FK could not have done", async () => {
    // The FK would have accepted ANY real costing_line_id. This refuses one
    // that belongs to a different operations file — a stronger guarantee.
    const c = fakeClient({ header: openHeader(), lineOnDossier: false });
    await expect(
      service.patchLine(c, { dossierId: DOSSIER, costingLineId: LINE_B, fields: { actual_ttc: 1 }, actor: ops }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
