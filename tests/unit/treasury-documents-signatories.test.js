"use strict";
/**
 * Treasury Documents and Signatories (PR-03, Audit #1-3, #15).
 */
const service = require("../../src/modules/master/treasury_account/treasury_account.service");
const repo = require("../../src/modules/master/treasury_account/treasury_account.repo");
const treasury360 = require("../../src/modules/master/treasury-360.service");

describe("Treasury Documents & Signatories — service logic", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("addDocument records a bank RIB document against treasury account", async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({
        rows: [{ user_id: "00000000-0000-4000-8000-000000000001" }],
      }),
    };
    jest.spyOn(repo, "get").mockResolvedValue({ treasury_account_id: "acc-1" });
    jest.spyOn(repo, "insertDocument").mockResolvedValue({
      document_id: "doc-1",
      treasury_account_id: "acc-1",
      document_type: "BANK_RIB",
      title: "Bank RIB / Attestation",
      document_number: "RIB-001",
      is_verified: false,
    });

    const doc = await service.addDocument(mockClient, {
      accountId: "acc-1",
      document_type: "BANK_RIB",
      title: "Bank RIB / Attestation",
      document_number: "RIB-001",
      actor: { user_id: "00000000-0000-4000-8000-000000000001" },
    });

    expect(doc.document_id).toBe("doc-1");
    expect(doc.document_type).toBe("BANK_RIB");
  });

  test("verifyDocument stamps is_verified on document", async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({
        rows: [{ user_id: "00000000-0000-4000-8000-000000000001" }],
      }),
    };
    jest.spyOn(repo, "getDocument").mockResolvedValue({
      document_id: "doc-1",
      treasury_account_id: "acc-1",
      is_verified: false,
    });
    jest.spyOn(repo, "verifyDocument").mockResolvedValue({
      document_id: "doc-1",
      treasury_account_id: "acc-1",
      is_verified: true,
      verified_by: "00000000-0000-4000-8000-000000000001",
    });

    const verified = await service.verifyDocument(mockClient, {
      accountId: "acc-1",
      documentId: "doc-1",
      actor: { user_id: "00000000-0000-4000-8000-000000000001" },
    });

    expect(verified.is_verified).toBe(true);
  });

  test("addSignatory registers primary/joint signatories", async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({
        rows: [{ user_id: "00000000-0000-4000-8000-000000000001" }],
      }),
    };
    jest.spyOn(repo, "get").mockResolvedValue({ treasury_account_id: "acc-1" });
    jest.spyOn(repo, "insertSignatory").mockResolvedValue({
      signatory_id: "sig-1",
      treasury_account_id: "acc-1",
      full_name: "John Doe",
      signatory_type: "PRIMARY",
      rule_type: "SINGLE_SIGNATURE",
      limit_amount: 5000000,
      currency: "XAF",
    });

    const sig = await service.addSignatory(mockClient, {
      accountId: "acc-1",
      full_name: "John Doe",
      signatory_type: "PRIMARY",
      rule_type: "SINGLE_SIGNATURE",
      limit_amount: 5000000,
      currency: "XAF",
      actor: { user_id: "00000000-0000-4000-8000-000000000001" },
    });

    expect(sig.signatory_id).toBe("sig-1");
    expect(sig.full_name).toBe("John Doe");
    expect(sig.rule_type).toBe("SINGLE_SIGNATURE");
  });

  test("buildReadiness flags missing bank RIB until document is attached", () => {
    const bankAcc = {
      label: "Main Bank",
      category_id: "cat-1",
      category_is_bank_identity: true,
      coa_code: "521101",
      currency: "XAF",
      bank_name: "Ecobank",
      account_number: "123456",
      swift_bic: "ECOBCMMA",
      opening_date: "2026-01-01",
      is_verified: false,
    };

    const readinessBefore = treasury360.buildReadiness(bankAcc, []);
    const ribItemBefore = readinessBefore.items.find((i) => i.key === "bank_rib");
    expect(ribItemBefore).toBeDefined();
    expect(ribItemBefore.ok).toBe(false);

    const readinessAfter = treasury360.buildReadiness(bankAcc, [
      { document_type: "BANK_RIB", expiry_date: "2027-01-01" },
    ]);
    const ribItemAfter = readinessAfter.items.find((i) => i.key === "bank_rib");
    expect(ribItemAfter.ok).toBe(true);
  });
});
