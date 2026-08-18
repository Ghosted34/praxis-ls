"use strict";

jest.mock("../../src/modules/sales/proposal/proposal.repo", () => ({
  byShareHash: jest.fn(),
  listLines: jest.fn(),
  listNarratives: jest.fn(),
  stampViewed: jest.fn(),
  stampDownloaded: jest.fn(),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  getByRef: jest.fn(),
  fetchBytes: jest.fn(),
}));

const fs = require("fs");
const path = require("path");
const repo = require("../../src/modules/sales/proposal/proposal.repo");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const service = require("../../src/modules/sales/proposal_public/proposal_public.service");
const presentation = require("../../src/modules/sales/proposal/proposal.presentation");
const document = require("../../src/modules/sales/proposal/proposal.document");

const live = {
  proposal_id: "p1",
  status: "SENT",
  share_expires_at: "2099-01-01",
  share_revoked_at: null,
  pdf_vault_id: "legacy-pdf",
  client_id: null,
  language: "BILINGUAL",
  currency: "XAF",
  title: "Douala freight",
  doc_number: "P-1",
};
const lines = [{ label: "Freight", qty: 2, unit_price: 5000, dictionary_item_id: "secret" }];
const narratives = [
  { section: "client_context", language: "EN", body: "English client context", sort_order: 1 },
  { section: "service_scope", language: "EN", body: "English service scope", sort_order: 2 },
  { section: "client_context", language: "FR", body: "Contexte client français", sort_order: 1 },
  { section: "service_scope", language: "FR", body: "Périmètre français", sort_order: 2 },
];

beforeEach(() => {
  jest.clearAllMocks();
  repo.byShareHash.mockResolvedValue({ ...live });
  repo.listLines.mockResolvedValue(lines);
  repo.listNarratives.mockResolvedValue(narratives);
  vault.getByRef.mockResolvedValue({ doc_id: "selected-pdf" });
});

describe("F5 public proposal", () => {
  test("returns the shared selected-language presentation and stamps the first view", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const out = await service.get(client, "token", "FR");
    expect(out.presentation).toEqual(presentation.build({
      proposal: live, lines, narratives, client: null, language: "FR",
    }));
    expect(out.presentation.sections.map((section) => section.body)).toEqual([
      "Contexte client français", "Périmètre français",
    ]);
    expect(out.presentation).not.toHaveProperty("dictionary_item_id");
    expect(repo.stampViewed).toHaveBeenCalledWith(client, "p1");
  });

  test.each(["EN", "FR"])("bilingual %s page model and PDF HTML have exact selected-copy parity", async (language) => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const model = (await service.get(client, "token", language)).presentation;
    const html = document.html({ presentation: model });
    const selectedBodies = narratives.filter((row) => row.language === language).map((row) => row.body);
    const otherBodies = narratives.filter((row) => row.language !== language).map((row) => row.body);
    for (const body of selectedBodies) expect(html).toContain(body);
    for (const body of otherBodies) expect(html).not.toContain(body);
    expect(html).toContain(model.labels.quantity);
    expect(html).toContain(model.lines[0].total_display);
  });

  test.each([
    { ...live, share_expires_at: "2000-01-01" },
    { ...live, share_revoked_at: "2026-01-01" },
    { ...live, status: "DRAFT" },
    null,
  ])("expired, revoked, unsent and unknown all give the same 404", async (row) => {
    repo.byShareHash.mockResolvedValue(row);
    await expect(service.resolve({}, "token")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  test("download resolves the language-specific vaulted capture and stamps engagement", async () => {
    vault.fetchBytes.mockResolvedValue({ doc: { doc_number: "P-1" }, buffer: Buffer.from("pdf") });
    const out = await service.download({}, "token", "FR");
    expect(vault.getByRef).toHaveBeenCalledWith({}, "proposal:p1:lang:FR");
    expect(vault.fetchBytes).toHaveBeenCalledWith({}, "selected-pdf");
    expect(out.buffer.toString()).toBe("pdf");
    expect(repo.stampDownloaded).toHaveBeenCalledWith({}, "p1");
  });

  test("implementation signs 256-bit random tokens, rate-limits public reads and captures server PDFs", () => {
    const proposal = fs.readFileSync(path.join(__dirname, "../../src/modules/sales/proposal/proposal.service.js"), "utf8");
    const routes = fs.readFileSync(path.join(__dirname, "../../src/modules/sales/proposal_public/proposal_public.routes.js"), "utf8");
    expect(proposal).toContain("randomBytes(32)");
    expect(proposal).toContain("createHmac");
    expect(proposal).toContain("languageRef(id, language)");
    expect(routes).toContain("makeLimiter");
  });

  test("migration provides entropy lifecycle and engagement columns", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../migrations/tenant/0692_sales_crm_f5_proposal_sharing.sql"), "utf8");
    for (const key of ["share_token_hash", "share_expires_at", "share_revoked_at", "viewed_at", "downloaded_at"]) {
      expect(sql).toContain(key);
    }
  });
});
