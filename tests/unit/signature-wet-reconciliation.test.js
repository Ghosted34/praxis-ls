"use strict";

function loadWith({ jobStatus = "PRINTED", duplicate = false } = {}) {
  jest.resetModules();
  const repo = {
    lockIngest: jest.fn().mockResolvedValue(null),
    lockJob: jest.fn().mockResolvedValue(null),
    getIngest: jest.fn().mockResolvedValue({
      ingest_id: "ingest-1",
      document_vault_id: "scan-doc-1",
      decode_status: "PENDING",
    }),
    getJobByCode: jest.fn().mockResolvedValue({
      print_job_id: "job-1",
      request_id: "req-1",
      party_id: "party-1",
      entity_ref: "delivery_note:1",
      doc_type: "DELIVERY_NOTE",
      content_hash: "hash-1",
      print_code: "0123456789ABCDEFGH",
      status: jobStatus,
    }),
    getJob: jest.fn().mockImplementation(async () => ({
      print_job_id: "job-1",
      request_id: "req-1",
      party_id: "party-1",
      entity_ref: "delivery_note:1",
      doc_type: "DELIVERY_NOTE",
      content_hash: "hash-1",
      print_code: "0123456789ABCDEFGH",
      status: jobStatus,
    })),
    hasReconciledScan: jest.fn().mockResolvedValue(duplicate),
    transitionJob: jest.fn().mockResolvedValue({}),
    updateIngest: jest.fn().mockImplementation(async (_client, _id, patch) => ({
      ingest_id: "ingest-1",
      document_vault_id: "scan-doc-1",
      ...patch,
    })),
    insertJob: jest.fn(),
    openJobForParty: jest.fn(),
    latestReprintNo: jest.fn(),
    markPrinted: jest.fn(),
    listQueue: jest.fn(),
    unreconciled: jest.fn().mockResolvedValue([]),
  };
  const sigRepo = { insert: jest.fn().mockResolvedValue({ signature_id: "sig-1", verify_code: "A4B7K92MXQ1P" }) };
  const requestRepo = {
    getRequest: jest.fn().mockResolvedValue({
      request_id: "req-1",
      entity_ref: "delivery_note:1",
      doc_type: "DELIVERY_NOTE",
      status: "SENT",
    }),
    listParties: jest.fn().mockResolvedValue([{ party_id: "party-1", party_kind: "EXTERNAL", source: "ON_FILE", full_name: "Amina", email: "a@example.com" }]),
    settleParty: jest.fn().mockResolvedValue({ party_id: "party-1" }),
    nextPendingParty: jest.fn().mockResolvedValue(null),
    transitionRequest: jest.fn().mockResolvedValue({ request_id: "req-1" }),
  };

  jest.doMock("../../src/modules/vault/signature_wet/signature_wet.repo", () => repo);
  jest.doMock("../../src/modules/vault/document_signature/document_signature.repo", () => sigRepo);
  jest.doMock("../../src/modules/vault/signature_request/signature_request.repo", () => requestRepo);
  jest.doMock("../../src/modules/vault/document_vault/document_vault.service", () => ({ fetchBytes: jest.fn().mockResolvedValue({ buffer: Buffer.from("scan") }) }));
  jest.doMock("../../src/services/signatures/barcode", () => ({
    decode: jest.fn().mockResolvedValue({ status: "DECODED", code: "0123456789ABCDEFGH" }),
    formatCode: (v) => v,
    mintCode: () => "0123456789ABCDEFGH",
  }));
  jest.doMock("../../src/services/signatures/canonical", () => ({
    build: jest.fn().mockReturnValue({ hash: "hash-1", payload: {}, version: 1 }),
  }));
  jest.doMock("../../src/modules/vault/signature_request/signature_request.service", () => ({
    assertUnamended: jest.fn().mockResolvedValue({}),
    generateCertificate: jest.fn().mockResolvedValue({ doc_id: "cert-1" }),
  }));
  jest.doMock("../../src/shared/events/emit", () => ({
    emitEvent: jest.fn().mockResolvedValue(null),
    audit: jest.fn().mockResolvedValue(null),
    resolveActorId: jest.fn().mockResolvedValue("user-1"),
  }));
  jest.doMock("../../src/shared/config/settings", () => ({ getSetting: jest.fn().mockResolvedValue(7) }));

  const service = require("../../src/modules/vault/signature_wet/signature_wet.service");
  return { service, repo, sigRepo, requestRepo };
}

describe("wet-signature reconciliation behaviour", () => {
  test("all corroborating checks passing writes one WET / INK signature and completes the chain", async () => {
    const { service, repo, sigRepo, requestRepo } = loadWith();

    const out = await service.decodeAndReconcile({}, { ingestId: "ingest-1", actor: { user_id: "user-1" } });

    expect(sigRepo.insert).toHaveBeenCalledTimes(1);
    expect(sigRepo.insert.mock.calls[0][1]).toMatchObject({
      assurance_level: "WET",
      visual_mark: "INK",
      preset_code: "PRINT_SIGN",
      document_vault_id: "scan-doc-1",
    });
    expect(repo.transitionJob).toHaveBeenCalledWith(expect.anything(), "job-1", "RECONCILED", ["ISSUED", "PRINTED", "REVIEW"], expect.objectContaining({ scan_vault_id: "scan-doc-1" }));
    expect(requestRepo.settleParty).toHaveBeenCalledWith(expect.anything(), "party-1", "SIGNED");
    expect(out.match_status).toBe("AUTO");
  });

  test("a duplicate scan goes to review and never moves a terminal job or writes a second signature", async () => {
    const { service, repo, sigRepo } = loadWith({ jobStatus: "RECONCILED", duplicate: true });

    const out = await service.decodeAndReconcile({}, { ingestId: "ingest-1", actor: { user_id: "user-1" } });

    expect(sigRepo.insert).not.toHaveBeenCalled();
    expect(repo.transitionJob).not.toHaveBeenCalled();
    expect(out.match_status).toBe("REVIEW");
    expect(out.match_notes).toContain("PRINT_JOB_NOT_OPEN");
    expect(out.match_notes).toContain("ALREADY_RECONCILED");
  });
});
