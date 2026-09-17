"use strict";

/**
 * The statement (MOD-76 PR 3, Q19).
 *
 * Pins the three conditions the statement was signed off on:
 *
 *   1. ONE MODEL, TWO RENDERINGS — statementData never formats a money value
 *      (the xlsx must sum what the PDF prints); the variance reason and the
 *      proofs travel per line — a statement showing −12 000 with no sentence
 *      explaining it is the document that generates the email asking why.
 *   2. The settled round's render is point-AND-COUNT: statementForSettlement
 *      writes the doc id back onto the settlement row, write-once — later
 *      exports reuse the history rather than rewrite it.
 *   3. SEND — Smart Comms in-house only (Q19-C): the dossier's own thread by
 *      default, a DIRECT message when the operator picks a person, and the
 *      attachment is a vault POINTER either way — never bytes, never email.
 *
 * pdf.service is-mocked at the seam: renderAndStore's puppeteer leg is a
 * render concern, not a statement-logic concern. template.service supplies a
 * fake cfg and the registry's template is stubbed for the same reason —
 * template layout correctness has its own template tests.
 */

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
const mockDOC_UUID = "00000700-0000-4000-8000-000000000000";
jest.mock("../../src/services/pdf.service", () => ({
  renderAndStore: jest.fn(async () => ({ doc_id: mockDOC_UUID, content_hash: "h123", key: "k", public_url: null })),
}));
jest.mock("../../src/modules/documents/template/template.service", () => ({
  resolveCfg: jest.fn(async () => ({ cfg: { language: "en", watermark: null }, entity: {} })),
}));
jest.mock("../../src/modules/smartcomm/smartcomm.service", () => ({
  findDossierChannel: jest.fn(async () => ({ group_id: "grp-dossier", kind: "DOSSIER", name: "SBX-2026-0001" })),
  createChannel: jest.fn(async (_c, { data }) => ({
    group_id: data.kind === "DIRECT" ? "grp-direct" : "grp-new-dossier",
    kind: data.kind,
    member_ids: data.member_ids,
  })),
  postMessage: jest.fn(async (_c, { groupId, body, attachments }) => ({
    message_id: "msg-1", group_id: groupId, body, attachments,
  })),
}));

const registry = require("../../src/services/documents/templates/registry");
const pdf = require("../../src/services/pdf.service");
const smartcomm = require("../../src/modules/smartcomm/smartcomm.service");
const statement = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.statement");
const service = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.service");

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const DOSSIER = UUID(2);
const LINE_A = UUID(11);
const RECON = UUID(70);

const gridRow = (over = {}) => ({
  costing_line_id: LINE_A, line_no: 1, label: "Port Charges", item_code: "PORT_CHARGES",
  item_label: "Port charges", is_disbursement: true, qty: 1, unit_cost: 100000,
  net: 100000, vat: 19250, budget_ttc: 119250, committed: 119250, pending: 0,
  disbursed: 169250, justification_required: true, document_count: 0,
  line_id: UUID(21), actual_ttc: 169250, actual_source: "TALLY",
  spent_on: "2026-09-02", variance_reason: "Network outage at customs held the container an extra day.",
  reason_group_id: null, returned_amount: 0,
  ...over,
});

const headerRow = (over = {}) => ({
  reconciliation_id: RECON, dossier_id: DOSSIER, status: "SUBMITTED", revision: 1,
  currency: "XAF", exchange_rate_to_xaf: 1, submitted_by: UUID(80), submitted_at: "2026-09-05T10:00:00Z",
  settled_by: null, settled_at: null, reject_reason: null, reopened_reason: null,
  returned_total: 0, quoted_ht: null,
  ...over,
});

const proofDocs = [{
  recon_document_id: UUID(61), line_id: UUID(21), doc_id: UUID(62),
  note: "Port invoice", uploaded_by: UUID(80), uploaded_at: "2026-09-03T08:00:00Z",
  costing_line_id: LINE_A, doc_type: "COST_PROOF", storage_path: "dossiers/2/proof-scnn-1.pdf",
  doc_status: "VERIFIED", content_hash: "abc", uploaded_by_name: "Jean Mballa",
}];

/** Fake client routed by SQL shape — the same harness the service tests use,
 *  extended for the dossier header, people names, settlements and binding. */
function fakeClient({
  header = headerRow(), grid = [gridRow()],
  docs = proofDocs,
  settlements = [],
  setting = null,
  spend = [],
} = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };
      if (/FROM dossier_reconciliation WHERE dossier_id/.test(sql)) return { rows: header ? [header] : [] };
      if (/FROM dossier_reconciliation WHERE reconciliation_id/.test(sql)) return { rows: header ? [header] : [] };
      if (/FROM costing\s+WHERE dossier_id/.test(sql)) return { rows: [{ costing_id: UUID(5), doc_number: "CST-2026-0043", status: "APPROVED_LOCKED", currency: "XAF", exchange_rate_to_xaf: 1 }] };
      if (/FROM setting WHERE section/.test(sql)) return { rows: setting ? [{ value: setting }] : [] };
      if (/FROM dossier d\s+LEFT JOIN client_master/.test(sql)) return { rows: [{
        dossier_id: DOSSIER, ref: "SBX-2026-0001", title: "Import 40ft", entity_id: UUID(99), client_id: UUID(30),
        client_name: "CIMENCAM SA", client_niu: "P01", client_rccm: null, service_en: "Sea freight import", service_fr: "Fret maritime import",
      }] };
      if (/FROM app_user WHERE user_id = ANY/.test(sql)) return {
        rows: (params[0] || []).filter(Boolean).map((id) => ({ user_id: id, full_name: id === UUID(80) ? "Jean Mballa" : "Alice Ngo" })),
      };
      // The grid projection — identified by the recon-line LEFT JOIN and its
      // ordering, the three conditions the service tests pin it by too.
      if (/FROM costing_line cl\s+JOIN costing c/.test(sql) && /ORDER BY cl\.line_no, cl\.costing_line_id/.test(sql) && /dossier_reconciliation_line rl/.test(sql)) return { rows: grid };
      if (/FROM dossier_reconciliation_document d/.test(sql)) return { rows: docs };
      if (/FROM dossier_reconciliation_settlement/.test(sql)) return { rows: settlements };
      if (/FROM dossier_reconciliation_line\s+WHERE reconciliation_id = \$1 AND costing_line_id/.test(sql)) return { rows: [] };
      if (/FROM cost_entry ce/.test(sql)) return { rows: spend };
      if (/FROM regie_advance/.test(sql)) return { rows: [] };
      if (/FROM cash_request/.test(sql)) return { rows: [] };
      if (/UPDATE dossier_reconciliation_settlement\s+SET statement_doc_id/.test(sql)) return { rows: [{ settlement_id: "settle-1" }] };
      return { rows: [] };
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(registry, "get").mockImplementation((docType) =>
    (docType === "RECONCILIATION_STATEMENT" ? { build: () => "<html><body>statement</body></html>" } : null));
});
afterEach(() => { registry.get.mockRestore(); });

describe("statementData — one model, two renderings", () => {
  it("carries the variance reason and the proof NAMES on every line", async () => {
    const data = await statement.statementData(fakeClient(), { dossierId: DOSSIER });
    expect(data.lines).toHaveLength(1);
    const line = data.lines[0];
    expect(line.variance_reason).toContain("Network outage");
    // The note, when the uploader wrote one — "3 documents" is a number,
    // "Port invoice" is a thing.
    expect(line.proofs).toEqual(["Port invoice"]);
    // Money stays NUMERIC: the xlsx must sum what the PDF prints.
    expect(typeof line.budget_ttc).toBe("number");
    expect(typeof line.actual_ttc).toBe("number");
    // over budget: budget − actual, so overspend goes NEGATIVE (sign convention documented in rules.lineView).
    expect(line.variance).toBe(-50000);
    expect(data.number).toBe("REC-SBX-2026-0001-r1");
  });

  it("answers the three questions that make up the grades (Q17)", async () => {
    const data = await statement.statementData(fakeClient(), { dossierId: DOSSIER });
    expect(data.grade_sentences).toHaveLength(3);
    expect(data.grade_sentences[0]).toContain("execute to plan");
    expect(data.grade_sentences[1]).toContain("accounted for");
    expect(data.grade_sentences[2]).toContain("make money");
    expect(data.grade_sentences[2]).toContain("No accepted quotation");
  });

  it("falls back to the storage file name when the uploader wrote no note", async () => {
    const c = fakeClient({ docs: [{ ...proofDocs[0], note: null }] });
    const data = await statement.statementData(c, { dossierId: DOSSIER });
    expect(data.lines[0].proofs).toEqual(["proof-scnn-1.pdf"]);
  });

  it("binds the settled round to its statement — write-once, revision-scoped", async () => {
    const c = fakeClient();
    await statement.statementForSettlement(c, { dossierId: DOSSIER, actor: { user_id: UUID(81) } });
    expect(pdf.renderAndStore).toHaveBeenCalledTimes(1);
    // …with a STABLE ref, not the contract path's timestamped one — the same
    // settled round re-rendered must bump the same vault row, not clone it.
    expect(pdf.renderAndStore.mock.calls[0][1].entityRef).toBe(`reconciliation_statement:${RECON}:rev1`);
    const bind = c.queries.find((q) => /SET statement_doc_id/.test(q.sql));
    expect(bind).toBeTruthy();
    expect(bind.params).toEqual([RECON, 1, mockDOC_UUID]);
  });
});

describe("sendStatement — in-house, and the vault is a pointer", () => {
  const settled = [{ revision: 1, statement_doc_id: mockDOC_UUID, settled_at: "2026-09-06T08:00:00Z" }];

  it("posts to the file's DOSSIER thread by default with the vault id, not bytes", async () => {
    const c = fakeClient({ settlements: settled });
    const out = await statement.sendStatement(c, {
      dossierId: DOSSIER, actor: { user_id: UUID(80) }, ip: null, target: "channel",
    });
    // A settled round with a render on file is reused — re-rendering would
    // blur what was agreed and stored.
    expect(pdf.renderAndStore).not.toHaveBeenCalled();
    const msg = smartcomm.postMessage.mock.calls.at(-1)[1];
    expect(msg.groupId).toBe("grp-dossier");
    expect(msg.attachments).toEqual([expect.objectContaining({
      attachment_kind: "VAULT", vault_id: mockDOC_UUID, content_type: "application/pdf",
    })]);
    expect(out.doc_id).toBe(mockDOC_UUID);
  });

  it("direct target: the OTHER person is the channel (actor is enrolled as OWNER by the service)", async () => {
    smartcomm.findDossierChannel.mockResolvedValueOnce(null);
    const c = fakeClient({ settlements: settled });
    await statement.sendStatement(c, {
      dossierId: DOSSIER, actor: { user_id: UUID(80) }, ip: null, target: "direct", userId: UUID(90),
    });
    const chan = smartcomm.createChannel.mock.calls.find(([, { data }]) => data.kind === "DIRECT");
    expect(chan).toBeTruthy();
    expect(chan[1].data.member_ids).toEqual([UUID(90)]);
    const posted = smartcomm.postMessage.mock.calls.at(-1)[1];
    expect(posted.groupId).toBe("grp-direct");
  });

  it("renders when the settled round has no stored statement yet (direct)", async () => {
    const c = fakeClient({ settlements: [{ revision: 1, statement_doc_id: null, settled_at: "2026-09-06T08:00:00Z" }] });
    const out = await statement.sendStatement(c, {
      dossierId: DOSSIER, actor: { user_id: UUID(80) }, ip: null, target: "channel",
    });
    expect(pdf.renderAndStore).toHaveBeenCalledTimes(1);
    expect(out.doc_id).toBe(mockDOC_UUID);
  });

  it("refuses a direct with no person", async () => {
    await expect(statement.sendStatement(fakeClient(), {
      dossierId: DOSSIER, actor: { user_id: UUID(80) }, ip: null, target: "direct", userId: null,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});


describe("timeline — the Full view's third chart (§6.2)", () => {
  it("returns the day's net spend WITH the budget and the grades alongside", async () => {
    const spend = [
      { day: "2026-09-01", actual_ttc: "119250.00" },
      { day: "2026-09-03", actual_ttc: "50000.00" },
    ];
    const data = await service.timeline(fakeClient({ spend, setting: { overspend_allowance_amount: 50000, overspend_allowance_percent: 2 } }), { dossierId: DOSSIER });
    expect(data.days).toEqual([
      { day: "2026-09-01", actual_ttc: 119250 },
      { day: "2026-09-03", actual_ttc: 50000 },
    ]);
    expect(data.budget_ttc).toBe(119250);
    expect(data.currency).toBe("XAF");
    // The drawer shows the three grades anyway — they ride along so the
    // client does not have to ask twice (the sheet pays the same query).
    expect(data.grades.execution.key).toBe("OVER_BUDGET");
  });

  it("an unreconciled file (no approved costing) answers honest emptiness", async () => {
    // The same rule as sheetFor: no budget, no spend — nothing to chart.
    const c = fakeClient();
    const orig = c.query.bind(c);
    c.query = async (sql, params) => {
      if (/FROM costing\s+WHERE dossier_id/.test(sql)) return { rows: [] };
      return orig(sql, params);
    };
    const data = await service.timeline(c, { dossierId: DOSSIER });
    expect(data).toEqual({ days: [], budget_ttc: 0, currency: "XAF", grades: null });
  });
});
