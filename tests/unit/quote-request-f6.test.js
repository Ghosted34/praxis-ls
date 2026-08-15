"use strict";
/**
 * F6 — Lead register & quote intake (MOD-20). The regression suite for the
 * seven defects the first pass shipped, each of which is asserted here so it
 * cannot come back quietly.
 *
 * The repo, the vault, object storage, the numbering service and the event
 * emitter are mocked, so what is under test is the ORCHESTRATION — which is
 * where every one of these defects lived. The one thing that is NOT mocked is
 * `quote_request.rules`, because the KPI arithmetic is the feature.
 */
jest.mock("../../src/modules/sales/quote_request/quote_request.repo");
jest.mock("../../src/modules/sales/opportunity/opportunity.repo");
jest.mock("../../src/modules/vault/document_vault/document_vault.service");
jest.mock("../../src/services/storage.service");
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (_c, id) => id || null,
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));

const repo = require("../../src/modules/sales/quote_request/quote_request.repo");
const opportunityRepo = require("../../src/modules/sales/opportunity/opportunity.repo");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const storage = require("../../src/services/storage.service");
const service = require("../../src/modules/sales/quote_request/quote_request.service");
const rules = require("../../src/modules/sales/quote_request/quote_request.rules");
const numbering = require("../../src/services/documents/numbering.service");

const QR = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const OPP = "33333333-3333-4333-8333-333333333333";

/** A client that records the transaction verbs it was asked to run. */
function makeClient() {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push(String(sql).trim().split(/\s+/)[0].toUpperCase());
      if (/INSERT INTO doc_sequence/i.test(sql)) return { rows: [{ seq: 7 }] };
      if (/FROM corporate_entity/i.test(sql)) return { rows: [{ doc_prefix: null }] };
      if (/FROM setting/i.test(sql)) return { rows: [] };
      if (/FROM lead/i.test(sql)) return { rows: [{ entity_id: null }] };
      return { rows: [] };
    }),
  };
}

let client;
beforeEach(() => {
  jest.clearAllMocks();
  client = makeClient();
  repo.defaultEntityId.mockResolvedValue(ENTITY);
  repo.get.mockResolvedValue({ quote_request_id: QR, status: "QUOTED", lead_id: null, owner_user_id: null, converted_opportunity_id: null });
  repo.insert.mockImplementation(async (_c, data) => ({ quote_request_id: QR, ...data }));
  repo.update.mockImplementation(async (_c, id, fields) => ({ quote_request_id: id, ...fields }));
  repo.addAttachment.mockImplementation(async (_c, d) => ({ quote_request_attachment_id: "att-1", ...d }));
  repo.demotePrimary.mockResolvedValue(undefined);
  repo.WRITABLE = jest.requireActual("../../src/modules/sales/quote_request/quote_request.repo").WRITABLE;
  opportunityRepo.insert.mockImplementation(async (_c, d) => ({ opportunity_id: OPP, ...d }));
});

/* ── 1. The reference. Create used to 422 on every call. ─────────────────── */

describe("public reference", () => {
  test("a create allocates a reference instead of failing on a null entity", async () => {
    const row = await service.create(client, { data: { incoterm: "FOB" }, actor: { user_id: null } });
    // The tenant's seeded scheme supplies the SQ prefix; with no `setting` row
    // (as here) the module token still puts SQ in the reference, and the
    // sequence and year come from doc_sequence. What matters is that a
    // reference exists at all — this call used to throw 422 NO_ENTITY.
    expect(row.public_ref).toMatch(/SQ/);
    expect(row.public_ref).toMatch(new RegExp(`${new Date().getUTCFullYear()}-0007$`));
    expect(row.entity_id).toBe(ENTITY);
  });

  test("the reference is written in the SAME statement as the row, not by a follow-up update", async () => {
    await service.create(client, { data: { incoterm: "FOB" }, actor: {} });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert.mock.calls[0][1].public_ref).toEqual(expect.stringContaining("SQ-"));
    expect(repo.update).not.toHaveBeenCalled();
  });

  test("allocation happens inside the transaction, so a rolled-back create burns no number", async () => {
    repo.insert.mockRejectedValueOnce(new Error("boom"));
    await expect(service.create(client, { data: { incoterm: "FOB" }, actor: {} })).rejects.toThrow("boom");
    expect(client.calls).toContain("BEGIN");
    expect(client.calls).toContain("ROLLBACK");
    const beganBeforeAllocating = client.calls.indexOf("BEGIN") < client.calls.indexOf("INSERT");
    expect(beganBeforeAllocating).toBe(true);
  });

  test("a tenant with two corporate entities is asked, not guessed at", async () => {
    repo.defaultEntityId.mockResolvedValue(null);
    await expect(service.create(client, { data: { incoterm: "FOB" }, actor: {} }))
      .rejects.toMatchObject({ code: "ENTITY_REQUIRED", status: 422 });
  });

  test("the intake register has its own numbering token — it does not share the lead counter", async () => {
    const cfg = await numbering.schemeFor(client, "MOD-20-INTAKE");
    expect(cfg.code).toBe("SQ");
    const leadCfg = await numbering.schemeFor(client, "MOD-20");
    expect(leadCfg.code).not.toBe(cfg.code);
  });
});

/* ── 2. The KPI tiles must partition the set. ────────────────────────────── */

describe("KPI tiles", () => {
  test("every status has a tile — the set is derived, not hand-listed", () => {
    for (const s of rules.STATUSES) expect(rules.KPI_TILES).toContain(s);
    expect(rules.KPI_TILES).toContain("TOTAL");
  });

  test("CLARIFICATION_REQUIRED and CLOSED_NO_ACTION are counted — the two the first pass dropped", () => {
    const kpi = rules.kpiFrom([
      { status: "RECEIVED", c: 3 },
      { status: "CLARIFICATION_REQUIRED", c: 2 },
      { status: "CLOSED_NO_ACTION", c: 4 },
    ]);
    expect(kpi.CLARIFICATION_REQUIRED).toBe(2);
    expect(kpi.CLOSED_NO_ACTION).toBe(4);
    expect(kpi.TOTAL).toBe(9);
  });

  test("the tiles sum to TOTAL for every status the CHECK constraint allows", () => {
    const kpi = rules.kpiFrom(rules.STATUSES.map((s, i) => ({ status: s, c: i + 1 })));
    expect(rules.assertPartitions(kpi)).toBe(true);
    const sum = rules.STATUSES.reduce((n, s) => n + kpi[s], 0);
    expect(sum).toBe(kpi.TOTAL);
  });

  test("an unrecognised status surfaces as OTHER rather than unbalancing the tiles", () => {
    const kpi = rules.kpiFrom([{ status: "RECEIVED", c: 1 }, { status: "LEGACY_JUNK", c: 5 }]);
    expect(kpi.OTHER).toBe(5);
    expect(rules.assertPartitions(kpi)).toBe(true);
  });

  test("the service refuses to answer with tiles that do not add up", async () => {
    repo.list.mockResolvedValue({ rows: [], total: 0, kpiRows: [{ status: "RECEIVED", c: 2 }], limit: 50, offset: 0 });
    const spy = jest.spyOn(rules, "kpiFrom").mockReturnValue({ TOTAL: 9, RECEIVED: 2 });
    await expect(service.list(client, {})).rejects.toMatchObject({ code: "KPI_NOT_PARTITIONED" });
    spy.mockRestore();
  });

  test("the KPI query keeps every filter EXCEPT status", () => {
    // The repo is mocked for the service tests, so assert on the real builder —
    // one WHERE function serves the list, the total, the KPI and the export, and
    // `includeStatus` is the only thing that differs between them.
    const real = jest.requireActual("../../src/modules/sales/quote_request/quote_request.repo");
    const listed = real.buildWhere({ status: "QUOTED", intake_channel: "WEBSITE" });
    const kpiOnly = real.buildWhere({ status: "QUOTED", intake_channel: "WEBSITE" }, { includeStatus: false });
    expect(listed.where).toContain("status =");
    expect(kpiOnly.where).not.toContain("status =");
    expect(kpiOnly.where).toContain("intake_channel =");
  });
});

/* ── 3. Conversion is one transaction. ───────────────────────────────────── */

describe("convert to opportunity", () => {
  test("the opportunity is written inside this function's transaction", async () => {
    await service.convertToOpportunity(client, { id: QR, opportunity: { name: "Douala reefer" }, actor: {} });
    const begin = client.calls.indexOf("BEGIN");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(client.calls).toContain("COMMIT");
    // opportunity.service is NOT used: it opens its own BEGIN/COMMIT, which
    // would commit the opportunity before this function's own write.
    expect(opportunityRepo.insert).toHaveBeenCalledTimes(1);
  });

  test("a failure after the opportunity insert leaves no orphan opportunity", async () => {
    repo.update.mockRejectedValueOnce(new Error("update failed"));
    await expect(service.convertToOpportunity(client, { id: QR, opportunity: { name: "X" }, actor: {} }))
      .rejects.toThrow("update failed");
    expect(client.calls).toContain("ROLLBACK");
    expect(client.calls).not.toContain("COMMIT");
  });

  test("converting twice is refused on the FK, not on the status string", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "QUOTED", converted_opportunity_id: OPP });
    await expect(service.convertToOpportunity(client, { id: QR, opportunity: { name: "X" }, actor: {} }))
      .rejects.toMatchObject({ code: "ALREADY_CONVERTED" });
  });

  test("a request that has not been quoted cannot skip straight to converted", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "RECEIVED", converted_opportunity_id: null });
    await expect(service.convertToOpportunity(client, { id: QR, opportunity: { name: "X" }, actor: {} }))
      .rejects.toMatchObject({ code: "BAD_STATE" });
  });
});

/* ── 4. An attachment upload that fails leaves no orphan. ────────────────── */

describe("attachments", () => {
  const dataUrl = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 hello").toString("base64");

  beforeEach(() => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "UNDER_REVIEW", converted_opportunity_id: null });
    vault.createDocument.mockResolvedValue({ doc_id: "doc-1", storage_path: "tenant_x/vault/doc_ab.pdf", original_name: "packing.pdf", content_hash: "hash" });
    storage.delete.mockResolvedValue(undefined);
  });

  test("bytes and link are written in one transaction", async () => {
    const out = await service.uploadAttachment(client, { id: QR, dataUrl, filename: "packing.pdf", slug: "x", actor: {} });
    expect(out.vault_id).toBe("doc-1");
    expect(client.calls).toContain("BEGIN");
    expect(client.calls).toContain("COMMIT");
  });

  test("a failure after the bytes are stored deletes the stored object", async () => {
    repo.addAttachment.mockRejectedValueOnce(new Error("link failed"));
    await expect(service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} })).rejects.toThrow("link failed");
    expect(client.calls).toContain("ROLLBACK");
    expect(storage.delete).toHaveBeenCalledWith("tenant_x/vault/doc_ab.pdf");
  });

  test("a cleanup that itself fails does not mask the original error", async () => {
    repo.addAttachment.mockRejectedValueOnce(new Error("link failed"));
    storage.delete.mockRejectedValueOnce(new Error("storage down"));
    await expect(service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} })).rejects.toThrow("link failed");
  });

  test("a rejected file stores nothing at all", async () => {
    vault.createDocument.mockRejectedValueOnce(Object.assign(new Error("bad type"), { code: "BAD_FILE_TYPE" }));
    await expect(service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} })).rejects.toThrow("bad type");
    expect(storage.delete).not.toHaveBeenCalled();
    expect(repo.addAttachment).not.toHaveBeenCalled();
  });

  test("uploads are sniffed — the vault is asked to check the bytes, not the label", async () => {
    await service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} });
    expect(vault.createDocument.mock.calls[0][1]).toMatchObject({ sniff: true, docType: "QUOTE_REQUEST_ATTACHMENT" });
  });

  test("promoting a new PRIMARY demotes the old one, so there is never two", async () => {
    await service.uploadAttachment(client, { id: QR, dataUrl, kind: "PRIMARY", slug: "x", actor: {} });
    expect(repo.demotePrimary).toHaveBeenCalledWith(client, QR);
  });

  test("a converted request refuses new attachments", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "CONVERTED_TO_OPPORTUNITY" });
    await expect(service.uploadAttachment(client, { id: QR, dataUrl, slug: "x", actor: {} }))
      .rejects.toMatchObject({ code: "LOCKED" });
    expect(vault.createDocument).not.toHaveBeenCalled();
  });
});

/* ── 5. The CSV export is not silently truncated. ────────────────────────── */

describe("CSV export", () => {
  test("the export path is unpaginated — it does not go through the 200-row clamp", async () => {
    repo.listForExport.mockResolvedValue({ rows: [{ public_ref: "SQ-1" }], truncated: false });
    await service.listForExport(client, { status: "QUOTED" });
    expect(repo.listForExport).toHaveBeenCalledWith(client, { status: "QUOTED" }, service.EXPORT_CAP);
    expect(repo.list).not.toHaveBeenCalled();
  });

  test("truncation is reported rather than hidden", async () => {
    repo.listForExport.mockResolvedValue({ rows: [], truncated: true });
    const out = await service.listForExport(client, {});
    expect(out.truncated).toBe(true);
  });
});

/* ── 6. The lifecycle stays an INTAKE lifecycle. ─────────────────────────── */

describe("intake status is not a pipeline stage", () => {
  test("no intake status is also a pipeline stage code", () => {
    // The seeded pipeline stages (9030_seed_reference + F7's PRICING_IN_PROGRESS).
    const PIPELINE = ["NEW", "QUALIFIED", "PROPOSAL", "PRICING_IN_PROGRESS", "QUOTATION_SENT", "NEGOTIATION", "WON", "LOST"];
    for (const s of rules.STATUSES) expect(PIPELINE).not.toContain(s);
  });

  test("no intake status is also a lead funnel state", () => {
    const LEAD = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];
    for (const s of rules.STATUSES) expect(LEAD).not.toContain(s);
  });

  test("terminal states are locked against edits", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "CLOSED_NO_ACTION" });
    await expect(service.update(client, { id: QR, patch: { incoterm: "CIF" }, actor: {} }))
      .rejects.toMatchObject({ code: "LOCKED" });
  });

  test("the reference and the entity are not patchable after allocation", async () => {
    repo.get.mockResolvedValue({ quote_request_id: QR, status: "RECEIVED" });
    await service.update(client, { id: QR, patch: { public_ref: "SQ-9999", entity_id: ENTITY, incoterm: "CIF" }, actor: {} });
    const fields = repo.update.mock.calls[0][2];
    expect(fields).not.toHaveProperty("public_ref");
    expect(fields).not.toHaveProperty("entity_id");
    expect(fields.incoterm).toBe("CIF");
  });
});
