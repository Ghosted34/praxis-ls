"use strict";
/**
 * Treasury fixes from the tenant review of 21 Sep 2026 ("meeting 5"):
 *
 *   - a document record can carry its file: the scan is uploaded to the vault,
 *     then linked — and only a file filed against THIS account links;
 *   - a document's expiry is stamped with the renewal ladder and read by the
 *     readiness checklist;
 *   - the bank's signatory letter is generated from the ACTIVE signatories and
 *     filed on the account, and is refused when nobody may sign.
 */
const service = require("../../src/modules/master/treasury_account/treasury_account.service");
const repo = require("../../src/modules/master/treasury_account/treasury_account.repo");
const treasury360 = require("../../src/modules/master/treasury-360.service");
const templateSvc = require("../../src/modules/documents/template/template.service");
const { moduleKeyForDocType } = require("../../src/modules/vault/document_vault/document_vault.types");

const USER = "00000000-0000-4000-8000-000000000001";
/** A client whose only query is the vault lookup / actor resolution. */
const clientWith = (vaultRow) => ({
  query: jest.fn(async (sql) => {
    if (/FROM document_vault/.test(sql)) return { rows: vaultRow ? [vaultRow] : [] };
    return { rows: [{ user_id: USER }] };
  }),
});

afterEach(() => jest.restoreAllMocks());

describe("attaching a scan to a treasury document", () => {
  const doc = { document_id: "d1", treasury_account_id: "acc-1" };

  test("links a vault file filed against the document", async () => {
    jest.spyOn(repo, "getDocument").mockResolvedValue(doc);
    const attach = jest.spyOn(repo, "attachDocumentScan").mockImplementation(async (_c, id, f) => ({ ...doc, ...f }));
    const row = await service.attachDocumentScan(
      clientWith({ doc_id: "v1", entity_ref: "treasury_account_document:d1", original_name: "rib.pdf" }),
      { accountId: "acc-1", documentId: "d1", vault_id: "v1", actor: { user_id: USER } },
    );
    expect(attach).toHaveBeenCalledWith(expect.anything(), "d1", expect.objectContaining({ vault_id: "v1", file_name: "rib.pdf" }));
    expect(row.vault_id).toBe("v1");
  });

  test("refuses a file that belongs to another record", async () => {
    jest.spyOn(repo, "getDocument").mockResolvedValue(doc);
    await expect(service.attachDocumentScan(
      clientWith({ doc_id: "v2", entity_ref: "client_document:zzz" }),
      { accountId: "acc-1", documentId: "d1", vault_id: "v2" },
    )).rejects.toMatchObject({ code: "VAULT_DOC_FOREIGN" });
  });

  test("refuses a document of another account", async () => {
    jest.spyOn(repo, "getDocument").mockResolvedValue({ ...doc, treasury_account_id: "acc-2" });
    await expect(service.attachDocumentScan(clientWith(null), { accountId: "acc-1", documentId: "d1", vault_id: "v1" }))
      .rejects.toMatchObject({ status: 404 });
  });

  test("the scans are read under Treasury (MOD-09), not the Settings fallback", () => {
    expect(moduleKeyForDocType("TREASURY_DOCUMENT")).toBe("MOD-09");
    expect(moduleKeyForDocType("BANK_AUTHORISATION")).toBe("MOD-09");
  });
});

describe("renewal reminder", () => {
  test("documents are stamped with where their expiry sits", () => {
    const [expired, soon, far, none] = treasury360.withRenewal([
      { title: "Mandate", expiry_date: "2026-09-01" },
      { title: "RIB", expiry_date: "2026-10-01" },
      { title: "Card", expiry_date: "2027-09-01" },
      { title: "Letter", expiry_date: null },
    ], "2026-09-27");
    expect(expired.renewal_state).toBe("EXPIRED");
    expect(soon.renewal_state).toBe("DUE");
    expect(far.renewal_state).toBe("OK");
    expect(none.renewal_state).toBeNull();
  });

  test("the readiness checklist names what to renew", () => {
    const docs = treasury360.withRenewal([{ title: "Bank Mandate", expiry_date: "2026-09-01" }], "2026-09-27");
    const r = treasury360.buildReadiness({ label: "Main" }, docs);
    const item = r.items.find((i) => i.key === "documents_current");
    expect(item.ok).toBe(false);
    expect(item.hint).toContain("Bank Mandate");
  });
});

describe("the bank authorisation letter", () => {
  const acc = { treasury_account_id: "acc-1", entity_id: "e1", label: "Main", bank_name: "Afriland", currency: "XAF", account_number: "123" };

  test("is built from the active signatories only, and filed as a bank mandate", async () => {
    jest.spyOn(repo, "getWithCategory").mockResolvedValue(acc);
    jest.spyOn(repo, "listSignatories").mockResolvedValue([
      { full_name: "Jean", rule_type: "SINGLE_SIGNATURE", is_active: true, effective_from: "2026-01-01" },
      { full_name: "Former", rule_type: "SINGLE_SIGNATURE", is_active: false, effective_from: "2025-01-01" },
      { full_name: "Ended", rule_type: "SINGLE_SIGNATURE", is_active: true, effective_from: "2025-01-01", effective_to: "2025-12-31" },
    ]);
    const render = jest.spyOn(templateSvc, "renderPdfFromData").mockResolvedValue({ doc_id: "v9" });
    const insert = jest.spyOn(repo, "insertDocument").mockImplementation(async (_c, row) => ({ document_id: "d9", ...row }));

    const row = await service.authorisationLetter(clientWith(null), { accountId: "acc-1", actor: { user_id: USER } });

    const data = render.mock.calls[0][1].data;
    expect(render.mock.calls[0][1].docType).toBe("BANK_AUTHORISATION");
    expect(data.signatories.map((s) => s.full_name)).toEqual(["Jean"]);
    expect(insert.mock.calls[0][1]).toMatchObject({ document_type: "BANK_MANDATE", vault_id: "v9" });
    expect(row.vault_id).toBe("v9");
  });

  test("is refused when nobody may sign", async () => {
    jest.spyOn(repo, "getWithCategory").mockResolvedValue(acc);
    jest.spyOn(repo, "listSignatories").mockResolvedValue([]);
    await expect(service.authorisationLetter(clientWith(null), { accountId: "acc-1" }))
      .rejects.toMatchObject({ code: "NO_SIGNATORIES" });
  });

  test("the template names the signatories and the joint rule, in both languages", () => {
    const registry = require("../../src/services/documents/templates/registry");
    const kit = require("../../src/services/documents/templates/kit");
    const tpl = registry.get("BANK_AUTHORISATION");
    const fr = tpl.build(tpl.sampleData, { ...kit.defaults(), language: "fr" }, { legal_name: "ACME" }, null);
    const en = tpl.build(tpl.sampleData, { ...kit.defaults(), language: "en" }, { legal_name: "ACME" }, null);
    expect(fr).toContain("Aïcha Ndongo");
    expect(fr).toContain("Conjointe");
    expect(en).toContain("require the signatures of two authorised persons");
  });
});
