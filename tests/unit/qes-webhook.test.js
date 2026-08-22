"use strict";

/**
 * The QES completion path — webhook and poll share it — and §7.6 criterion 5:
 * "a replayed webhook is idempotent — one document_signature row, not two."
 *
 * The provider retries a webhook until it gets 2xx, and the poll backstop
 * can arrive for the same envelope in the same minute. The claim (a guarded
 * envelope transition) and the party settlement are the arbiters, and these
 * tests exercise every race the two of them settle:
 *
 *   · a replay after completion        → ignored, no second signature
 *   · a claim lost to a concurrent run → ignored, no second signature
 *   · a party that settled elsewhere   → the duplicate is recorded, not written
 *   · a document that moved mid-flight → the chain stops, no signature
 */

const crypto = require("crypto");

const qesIndex = require("../../src/services/qes");
const adapter = require("../../src/services/qes/signwell.adapter");
const qesService = require("../../src/modules/vault/qes/qes.service");
const repo = require("../../src/modules/vault/qes/qes.repo");
const sigRepo = require("../../src/modules/vault/document_signature/document_signature.repo");
const sigService = require("../../src/modules/vault/document_signature/document_signature.service");
const requestService = require("../../src/modules/vault/signature_request/signature_request.service");
const reqRepo = require("../../src/modules/vault/signature_request/signature_request.repo");
const vaultRepo = require("../../src/modules/vault/document_vault/document_vault.repo");
const storage = require("../../src/services/storage.service");
const fixtures = require("../fixtures/signature-canonical.fixtures");
const canonical = require("../../src/services/signatures/canonical");

const HASH = canonical.hash("FINAL_INVOICE", fixtures.FINAL_INVOICE);
const SIGNED_PDF = Buffer.from("%PDF-1.7 provider-signed");
const AUDIT_PDF = Buffer.from("%PDF-1.7 provider-signed-plus-audit-page");

const request = (over = {}) => ({
  request_id: "req-1",
  entity_ref: "final_invoice:abc",
  doc_type: "FINAL_INVOICE",
  document_vault_id: "vault-1",
  payload_version: 1,
  content_hash: HASH,
  allowed_presets: ["CERTIFIED"],
  status: "SENT",
  message: null,
  expires_at: null,
  ...over,
});

const party = (over = {}) => ({
  party_id: "party-2",
  request_id: "req-1",
  sequence_no: 2,
  party_kind: "COUNTERPARTY",
  source: "ON_FILE",
  full_name: "Aïssatou Njoya",
  party_role: "Procurement Manager",
  email: "aissatou@cimencam.cm",
  language: "fr",
  status: "SENT",
  ...over,
});

const envelope = (over = {}) => ({
  envelope_id: "env-1",
  request_id: "req-1",
  party_id: "party-2",
  provider_key: "signwell",
  provider_ref: "sw-doc-9",
  status: "SENT",
  audit_vault_id: null,
  signed_vault_id: null,
  last_error: null,
  ...over,
});

afterEach(() => jest.restoreAllMocks());

/** A tenant connection that answers the few queries these paths make. */
const makeClient = () => ({
  query: async (sql) => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/INSERT INTO event_log/.test(sql)) return { rows: [] };
    if (/FROM event_type/.test(sql)) return { rows: [{ is_security_critical: false, is_approvable: false }] };
    if (/INSERT INTO immutable_ledger/.test(sql)) return { rows: [] };
    if (/compliance_flag/.test(sql)) return { rows: [] };
    if (/FROM setting/.test(sql)) return { rows: [] };
    return { rows: [] };
  },
});

/** The pre-completion state: an open envelope, an open request, an open party. */
const primeCompletion = (_client) => {
  jest.spyOn(repo, "getEnvelopeByProviderRef").mockResolvedValue(envelope());
  jest.spyOn(repo, "lockEnvelope").mockResolvedValue({ rows: [] });
  jest.spyOn(repo, "transitionEnvelope").mockImplementation(async (_c, id, status) => ({ ...envelope(), envelope_id: id, status }));
  jest.spyOn(repo, "updateEnvelope").mockImplementation(async (_c, id, patch) => ({ ...envelope(), envelope_id: id, ...patch }));
  jest.spyOn(reqRepo, "getParty").mockResolvedValue(party());
  jest.spyOn(reqRepo, "getRequest").mockResolvedValue(request());
  jest.spyOn(sigService, "loadDoc").mockResolvedValue(fixtures.FINAL_INVOICE);
  jest.spyOn(qesIndex, "providerConfig").mockResolvedValue({ apiKey: "sw_key", source: "platform" });
  jest.spyOn(adapter, "fetchSignedDocument").mockResolvedValue(SIGNED_PDF);
  jest.spyOn(adapter, "fetchAuditCertificate").mockResolvedValue(AUDIT_PDF);
  jest.spyOn(storage, "put").mockResolvedValue({ key: "tenant_t/qes/x.pdf" });
  jest.spyOn(vaultRepo, "insert")
    .mockResolvedValueOnce({ doc_id: "vault-signed" })
    .mockResolvedValueOnce({ doc_id: "vault-audit" });
  jest.spyOn(reqRepo, "settleParty").mockResolvedValue({ ...party(), status: "SIGNED" });
  jest.spyOn(sigRepo, "insert").mockResolvedValue({ signature_id: "sig-1", verify_code: "A4B7K92MXQ1P" });
  jest.spyOn(requestService, "advance").mockResolvedValue({ completed: false });
};

describe("§7.6 criterion 5 — a replayed webhook writes one signature, not two", () => {
  test("an event for an already-completed envelope is ignored", async () => {
    const client = makeClient();
    jest.spyOn(repo, "getEnvelopeByProviderRef").mockResolvedValue(envelope({ status: "COMPLETED" }));
    const insert = jest.spyOn(sigRepo, "insert");

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });
    expect(out.ignored).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });

  test("a claim lost to a concurrent run writes nothing", async () => {
    const client = makeClient();
    primeCompletion(client);
    // The other run took the claim first: the guarded transition returns no
    // row, and this run must stand down.
    jest.spyOn(repo, "transitionEnvelope").mockResolvedValue(null);
    const insert = jest.spyOn(sigRepo, "insert");

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "poll",
    });
    expect(out.ignored).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(reqRepo.settleParty).not.toHaveBeenCalled();
  });

  test("two sequential deliveries: the first settles, the second is a no-op", async () => {
    const client = makeClient();
    primeCompletion(client);
    const insert = jest.spyOn(sigRepo, "insert");

    const first = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });
    expect(first).toMatchObject({ status: "COMPLETED" });

    // The provider retries until it gets 2xx — which it did — and the retry
    // arrives to find the envelope COMPLETED.
    jest.spyOn(repo, "getEnvelopeByProviderRef").mockResolvedValue(envelope({ status: "COMPLETED" }));
    const second = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });
    expect(second.ignored).toBe(true);

    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe("completion — the long one, and the one the rules live in", () => {
  test("writes exactly one QES signature, with the provider's bytes as the artifact", async () => {
    const client = makeClient();
    primeCompletion(client);
    const insert = jest.spyOn(sigRepo, "insert");
    const advance = jest.spyOn(requestService, "advance");

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });

    expect(out).toMatchObject({ status: "COMPLETED", signature_id: "sig-1" });

    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][1];
    expect(row).toMatchObject({
      entity_ref: "final_invoice:abc",
      doc_type: "FINAL_INVOICE",
      document_vault_id: "vault-signed",
      payload_version: 1,
      content_hash: HASH,
      assurance_level: "QES",
      visual_mark: "PROVIDER",
      preset_code: "CERTIFIED",
      party: "EXTERNAL",
      identity_source: "DECLARED",
      signer_name: "Aïssatou Njoya",
      signer_email: "aissatou@cimencam.cm",
      signature_request_id: "req-1",
    });
    // The provider verified the person, not an address: there is no OTP
    // challenge on this row, and the column must not be a null stand-in that
    // reads as "we checked and found none".
    expect(row).not.toHaveProperty("otp_challenge_id");
    // The artifact hash is the provider's BYTES — the file the portal will
    // verify is the file the provider signed, mirroring included.
    expect(row.artifact_hash).toBe(crypto.createHash("sha256").update(SIGNED_PDF).digest("hex"));
    // No ip/user_agent from our side: the webhook's address is the provider's
    // exit node, and printing it as the signer's location would be a false
    // fact in an evidence document.
    expect(row.ip).toBeNull();
    expect(row.user_agent).toBeNull();

    // Both artifacts mirrored, both ids on the envelope.
    expect(vaultRepo.insert).toHaveBeenCalledTimes(2);
    expect(repo.updateEnvelope).toHaveBeenCalledWith(
      client, "env-1",
      expect.objectContaining({ signed_vault_id: "vault-signed", audit_vault_id: "vault-audit" }),
    );

    // The chain moves on, and the next party is EMAILED — the webhook has no
    // operator to press the button.
    expect(advance).toHaveBeenCalledTimes(1);
    const advArg = advance.mock.calls[0][1];
    expect(typeof advArg.sendEmail).toBe("function");
  });

  test("the audit artifact is vaulted with its own row, distinct from the signed document", async () => {
    const client = makeClient();
    primeCompletion(client);

    await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });

    const [signed, audit] = vaultRepo.insert.mock.calls.map((c) => c[1]);
    expect(signed.doc_type).toBe("FINAL_INVOICE");
    expect(audit.doc_type).toBe("QES_AUDIT_CERTIFICATE");
    expect(signed.content_hash).toBe(crypto.createHash("sha256").update(SIGNED_PDF).digest("hex"));
    expect(audit.content_hash).toBe(crypto.createHash("sha256").update(AUDIT_PDF).digest("hex"));
    expect(signed.status).toBe("VERIFIED");
  });

  test("a fetch failure puts the claim back to the poll, with the reason", async () => {
    const client = makeClient();
    primeCompletion(client);
    jest.spyOn(adapter, "fetchSignedDocument").mockRejectedValue(
      new adapter.ProviderError("SignWell returned an empty completed PDF", { status: 500, retryable: true }),
    );
    const insert = jest.spyOn(sigRepo, "insert");

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });
    expect(out).toMatchObject({ status: "RETRY" });
    expect(insert).not.toHaveBeenCalled();

    // The claim is back where the poll can find it: SENT, with the reason.
    const putBack = repo.transitionEnvelope.mock.calls.find(
      (c) => c[2] === "SENT" && c[3][0] === "COMPLETED",
    );
    expect(putBack).toBeDefined();
    expect(putBack[4].last_error).toContain("empty completed PDF");
  });

  test("a 404 fetch is not retried: the envelope goes FAILED, with the event", async () => {
    const client = makeClient();
    primeCompletion(client);
    jest.spyOn(adapter, "fetchSignedDocument").mockRejectedValue(
      new adapter.ProviderError("document no longer exists", { status: 404, retryable: false }),
    );

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });
    expect(out).toMatchObject({ status: "FAILED" });
    const toFailed = repo.transitionEnvelope.mock.calls.find((c) => c[2] === "FAILED");
    expect(toFailed).toBeDefined();
  });

  test("a party that settled by another method: the duplicate is recorded, not written", async () => {
    const client = makeClient();
    primeCompletion(client);
    // The OTP path got there first (the window is small, but it exists): the
    // guarded settlement returns no row, and the provider's copy of the
    // signature must not be written a second time.
    jest.spyOn(reqRepo, "settleParty").mockResolvedValue(null);
    const insert = jest.spyOn(sigRepo, "insert");

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });
    expect(out).toMatchObject({ status: "CANCELLED" });
    expect(insert).not.toHaveBeenCalled();
  });

  test("a request that closed while the provider was working cannot settle", async () => {
    const client = makeClient();
    primeCompletion(client);
    jest.spyOn(reqRepo, "getRequest").mockResolvedValue(request({ status: "VOIDED" }));
    const insert = jest.spyOn(sigRepo, "insert");

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });
    expect(out).toMatchObject({ status: "CANCELLED" });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("rule 4 — the document that moved after the provider was sent", () => {
  test("an amended document stops the chain and writes no signature", async () => {
    const client = makeClient();
    primeCompletion(client);
    // Somebody edited the total after the envelope was sent.
    jest.spyOn(sigService, "loadDoc").mockResolvedValue({
      ...fixtures.FINAL_INVOICE,
      totals: { ...fixtures.FINAL_INVOICE.totals, total_ttc: 1_812_400 },
    });
    const onAmendment = jest.spyOn(requestService, "onAmendment").mockResolvedValue(undefined);
    const insert = jest.spyOn(sigRepo, "insert");

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "COMPLETED", source: "webhook",
    });

    expect(out).toMatchObject({ status: "FAILED" });
    expect(onAmendment).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    // The envelope says WHY it failed, rather than pretending the signature
    // exists somewhere.
    const toFailed = repo.transitionEnvelope.mock.calls.find((c) => c[2] === "FAILED" && c[3][0] === "COMPLETED");
    expect(toFailed).toBeDefined();
    expect(toFailed[4].last_error).toContain("amended");
  });
});

describe("the other terminal states", () => {
  test("a decline settles the party and the request, and declines the envelope", async () => {
    const client = makeClient();
    primeCompletion(client);
    const decline = jest.spyOn(requestService, "decline").mockResolvedValue(party({ status: "DECLINED" }));

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "DECLINED", source: "webhook",
    });

    expect(out).toMatchObject({ status: "DECLINED" });
    expect(decline).toHaveBeenCalledTimes(1);
    expect(decline.mock.calls[0][1].party.party_id).toBe("party-2");
    expect(sigRepo.insert).not.toHaveBeenCalled();
  });

  test("a provider-side cancel cancels the envelope and touches no signature", async () => {
    const client = makeClient();
    primeCompletion(client);

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "CANCELLED", source: "poll",
    });

    expect(out).toMatchObject({ status: "CANCELLED" });
    expect(sigRepo.insert).not.toHaveBeenCalled();
    expect(reqRepo.settleParty).not.toHaveBeenCalled();
  });

  test("a provider failure fails the envelope with a reason, and the party stays open", async () => {
    const client = makeClient();
    primeCompletion(client);

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "FAILED", source: "poll",
    });

    expect(out).toMatchObject({ status: "FAILED" });
    expect(reqRepo.settleParty).not.toHaveBeenCalled();
    expect(sigRepo.insert).not.toHaveBeenCalled();
  });

  test("a non-terminal status is a heartbeat, not an event", async () => {
    const client = makeClient();
    primeCompletion(client);

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-doc-9", providerStatus: "SENT", source: "poll",
    });

    expect(out.ignored).toBe(true);
    expect(repo.transitionEnvelope).not.toHaveBeenCalled();
  });

  test("an envelope the system never sent is ignored, not an error", async () => {
    const client = makeClient();
    jest.spyOn(repo, "getEnvelopeByProviderRef").mockResolvedValue(null);

    const out = await qesService.handleProviderEvent(client, {
      providerRef: "sw-someone-elses-doc", providerStatus: "COMPLETED", source: "webhook",
    });
    expect(out.ignored).toBe(true);
  });
});
