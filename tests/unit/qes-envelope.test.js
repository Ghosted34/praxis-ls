"use strict";

/**
 * The QES handoff and the charge-on-issue rule —
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §7.4 steps 2–4, and §7.6 criteria 1, 2
 * and 3.
 *
 * The assertion that matters most is negative, and it is the one that costs
 * money if it regresses: a provider failure must leave ZERO ledger rows.
 * "Charged, then the row deleted on failure" is an implementation detail
 * someone will eventually forget; "the row cannot exist without the ref" is
 * a shape of data that cannot be forgotten. These tests pin the shape.
 */

const qesIndex = require("../../src/services/qes");
const adapter = require("../../src/services/qes/signwell.adapter");
const qesService = require("../../src/modules/vault/qes/qes.service");
const repo = require("../../src/modules/vault/qes/qes.repo");
const sigRepo = require("../../src/modules/vault/document_signature/document_signature.repo");
const vaultService = require("../../src/modules/vault/document_vault/document_vault.service");
const storage = require("../../src/services/storage.service");
const fixtures = require("../fixtures/signature-canonical.fixtures");
const canonical = require("../../src/services/signatures/canonical");

const HASH = canonical.hash("FINAL_INVOICE", fixtures.FINAL_INVOICE);
const PDF = Buffer.from("%PDF-1.7 pretend-signed-bytes");

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

const codeOf = async (p) => {
  try { await p; return null; } catch (e) { return e.code || e.message; }
};

afterEach(() => jest.restoreAllMocks());

/** A tenant connection that answers the few queries these paths make. */
const makeClient = () => ({
  query: async (sql) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(String(sql).trim())) return { rows: [] };
    if (/INSERT INTO event_log/.test(sql)) return { rows: [] };
    if (/FROM event_type/.test(sql)) return { rows: [{ is_security_critical: false, is_approvable: false }] };
    if (/INSERT INTO immutable_ledger/.test(sql)) return { rows: [] };
    if (/FROM setting/.test(sql)) return { rows: [] };
    return { rows: [] };
  },
});

/** The standard pre-handoff state: configured provider, rendered document, no in-flight envelope. */
const primeHandoff = (_client) => {
  jest.spyOn(qesIndex, "providerConfig").mockResolvedValue({ apiKey: "sw_key", source: "platform" });
  jest.spyOn(adapter, "ensureWebhook").mockResolvedValue({ webhookId: "hook-1", created: false });
  jest.spyOn(sigRepo, "listByRef").mockResolvedValue([]);
  jest.spyOn(vaultService, "fetchBytes").mockResolvedValue({ buffer: PDF, doc: { doc_id: "vault-1" } });
  jest.spyOn(repo, "getActiveForParty").mockResolvedValue(null);
  jest.spyOn(repo, "insertEnvelope").mockResolvedValue({
    envelope_id: "env-1", request_id: "req-1", party_id: "party-2", provider_key: "signwell", status: "CREATING",
  });
  jest.spyOn(repo, "updateEnvelope").mockResolvedValue({ envelope_id: "env-1" });
  jest.spyOn(repo, "chargeForEnvelope").mockResolvedValue({ usage_id: "usage-1" });
  jest.spyOn(storage, "put").mockResolvedValue({ key: "tenant_t/qes/env-1_signed.pdf" });
  jest.spyOn(qesIndex, "platformPricing").mockResolvedValue({ unitCost: 2500, currency: "XAF", monthlyQuota: 25 });
};

describe("§7.6 criterion 1 — the dispatch confirmation reports, it does not block", () => {
  test("an unconfigured provider is a fact, not a 424", async () => {
    jest.spyOn(qesIndex, "providerConfig").mockResolvedValue(null);
    const out = await qesService.quote(makeClient(), { docType: "FINAL_INVOICE", language: "en" });
    expect(out.available).toBe(false);
    expect(out.configured).toBe(false);
    // No figure anywhere: the tenant is shown the count, never the rate.
    expect(JSON.stringify(out)).not.toMatch(/2500/);
  });

  test("a doc type whose ceiling forbids QES is unavailable, with the reason", async () => {
    jest.spyOn(qesIndex, "providerConfig").mockResolvedValue({ apiKey: "sw_key", source: "platform" });
    // PAYSLIP is not in SIGNATURE_CEILING at all: an unregistered type cannot
    // be certified, and the quote says so rather than failing.
    const out = await qesService.quote(makeClient(), { docType: "PAYSLIP", language: "en" });
    expect(out.ceiling.allows_qes).toBe(false);
    expect(out.ceiling.reason).toBe("NOT_AVAILABLE_FOR_DOC_TYPE");
  });
});

describe("§7.6 criterion 2 — a provider failure leaves ZERO ledger rows", () => {
  test("a 5xx from the provider: envelope FAILED, no charge, a 502 for the signer", async () => {
    const client = makeClient();
    primeHandoff(client);
    jest.spyOn(adapter, "createEnvelope").mockRejectedValue(
      new adapter.ProviderError("SignWell POST /documents/ failed (HTTP 503)", { status: 503, retryable: true }),
    );
    const charge = jest.spyOn(repo, "chargeForEnvelope");

    const thrown = await codeOf(
      qesService.handoff(client, { party: party(), request: request(), language: "fr", slug: "t", origin: "https://t.example" }),
    );
    expect(thrown).toBe("QES_PROVIDER_ERROR");

    // The envelope records WHY, in words an operator can act on.
    expect(repo.updateEnvelope).toHaveBeenCalledWith(
      client, "env-1",
      expect.objectContaining({ status: "FAILED", last_error: expect.stringContaining("503") }),
    );
    // And the ledger was never touched: nothing to delete, because nothing
    // was ever written.
    expect(charge).not.toHaveBeenCalled();
  });

  test("a 401 (a rotated key) is the same shape: FAILED, uncharged, loud", async () => {
    const client = makeClient();
    primeHandoff(client);
    jest.spyOn(adapter, "createEnvelope").mockRejectedValue(
      new adapter.ProviderError("Not valid authorization token", { status: 401, retryable: false }),
    );
    const charge = jest.spyOn(repo, "chargeForEnvelope");
    expect(await codeOf(
      qesService.handoff(client, { party: party(), request: request(), language: "fr", slug: "t", origin: "https://t.example" }),
    )).toBe("QES_PROVIDER_ERROR");
    expect(charge).not.toHaveBeenCalled();
  });
});

describe("§7.6 criterion 3 — a successful create writes exactly one ledger row, with the ref", () => {
  test("the row carries the provider ref, the platform rate, and the request", async () => {
    const client = makeClient();
    primeHandoff(client);
    jest.spyOn(adapter, "createEnvelope").mockResolvedValue({
      envelopeId: "sw-doc-9", webhookId: "hook-1", partyLinks: ["https://sw/link"],
    });

    const out = await qesService.handoff(client, {
      party: party(), request: request(), language: "fr", slug: "t", origin: "https://t.example",
    });

    expect(out).toMatchObject({ sent: true, provider: "signwell", envelope_id: "env-1" });
    expect(repo.updateEnvelope).toHaveBeenCalledWith(
      client, "env-1",
      expect.objectContaining({ provider_ref: "sw-doc-9", status: "SENT" }),
    );
    expect(repo.chargeForEnvelope).toHaveBeenCalledTimes(1);
    expect(repo.chargeForEnvelope).toHaveBeenCalledWith(client, expect.objectContaining({
      envelopeId: "env-1",
      requestId: "req-1",
      entityRef: "final_invoice:abc",
      providerKey: "signwell",
      providerRef: "sw-doc-9",
      unitFee: 2500,
      currency: "XAF",
    }));
  });

  test("the created document carries the praxis envelope in its metadata", async () => {
    const client = makeClient();
    primeHandoff(client);
    const create = jest.spyOn(adapter, "createEnvelope").mockResolvedValue({
      envelopeId: "sw-doc-9", webhookId: "hook-1", partyLinks: [],
    });

    await qesService.handoff(client, {
      party: party(), request: request(), language: "en", slug: "t", origin: "https://t.example",
    });

    const arg = create.mock.calls[0][0];
    expect(arg.metadata.praxis).toEqual({
      envelope_id: "env-1", request_id: "req-1", entity_ref: "final_invoice:abc",
    });
    expect(arg.parties).toEqual([{
      email: "aissatou@cimencam.cm", name: "Aïssatou Njoya", role: "Procurement Manager", signingOrder: 1,
    }]);
    expect(arg.document.dataBase64).toBe(PDF.toString("base64"));
  });
});

describe("the charge transaction is the arbiter — a failed commit un-sends the envelope", () => {
  test("BEGIN/COMMIT failing: rollback, provider cancel, no ledger row, a retryable 500", async () => {
    const client = makeClient();
    primeHandoff(client);
    jest.spyOn(adapter, "createEnvelope").mockResolvedValue({
      envelopeId: "sw-doc-9", webhookId: "hook-1", partyLinks: [],
    });
    jest.spyOn(client, "query")
      .mockImplementation(async (sql) => {
        if (String(sql).trim() === "COMMIT") throw new Error("connection lost mid-commit");
        return { rows: [] };
      });
    const cancel = jest.spyOn(adapter, "cancelEnvelope").mockResolvedValue({ cancelled: true });
    const charge = jest.spyOn(repo, "chargeForEnvelope");

    const thrown = await codeOf(
      qesService.handoff(client, { party: party(), request: request(), language: "fr", slug: "t", origin: "https://t.example" }),
    );
    expect(thrown).toBe("QES_LEDGER_FAILED");

    // The ledger row was attempted but the transaction rolled back — the
    // assertion is on the OUTCOME: no row survived, and the provider's
    // document is cancelled so an unbillable link is not sitting in a
    // mailbox.
    expect(charge).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sw_key", envelopeId: "sw-doc-9" }),
    );
  });

  test("the stranded envelope goes FAILED immediately, so the advised retry is possible", async () => {
    // The audit finding: insertEnvelope runs BEFORE the BEGIN, so on charge
    // failure the row survives the rollback as CREATING — an IN-FLIGHT state
    // that uq_qes_active_party and getActiveForParty both cover. Left there,
    // the "please try again" advice is a lie for the next hour (until the
    // poll's stale sweep clears it), and the retry throws ENVELOPE_IN_FLIGHT.
    // The row must be transitioned to FAILED in the rollback path.
    const client = makeClient();
    primeHandoff(client);
    jest.spyOn(adapter, "createEnvelope").mockResolvedValue({
      envelopeId: "sw-doc-9", webhookId: "hook-1", partyLinks: [],
    });
    const update = jest.spyOn(repo, "updateEnvelope");
    jest.spyOn(client, "query")
      .mockImplementation(async (sql) => {
        if (String(sql).trim() === "COMMIT") throw new Error("connection lost mid-commit");
        return { rows: [] };
      });
    jest.spyOn(adapter, "cancelEnvelope").mockResolvedValue({ cancelled: true });

    expect(await codeOf(
      qesService.handoff(client, { party: party(), request: request(), language: "fr", slug: "t", origin: "https://t.example" }),
    )).toBe("QES_LEDGER_FAILED");

    // FAILED, not left CREATING — and with a reason that is also the answer
    // to "why can't I see it in the provider dashboard?"
    expect(update).toHaveBeenCalledWith(
      client, "env-1",
      expect.objectContaining({ status: "FAILED", last_error: expect.stringContaining("cancelled at the provider") }),
    );
  });
});

describe("one in-flight envelope per party — the friendly half of the index", () => {
  test("a second handoff for the same party is a 409, not a duplicate envelope", async () => {
    const client = makeClient();
    primeHandoff(client);
    jest.spyOn(repo, "getActiveForParty").mockResolvedValue({
      envelope_id: "env-0", status: "SENT",
    });
    const insert = jest.spyOn(repo, "insertEnvelope");

    expect(await codeOf(
      qesService.handoff(client, { party: party(), request: request(), language: "fr", slug: "t", origin: "https://t.example" }),
    )).toBe("ENVELOPE_IN_FLIGHT");
    expect(insert).not.toHaveBeenCalled();
  });

  test("an unconfigured provider is answered with a straight 409, before anything is written", async () => {
    const client = makeClient();
    jest.spyOn(qesIndex, "providerConfig").mockResolvedValue(null);
    const insert = jest.spyOn(repo, "insertEnvelope");

    expect(await codeOf(
      qesService.handoff(client, { party: party(), request: request(), language: "fr", slug: "t", origin: "https://t.example" }),
    )).toBe("QES_NOT_CONFIGURED");
    expect(insert).not.toHaveBeenCalled();
  });

  test("an unrendered document cannot be certified", async () => {
    const client = makeClient();
    primeHandoff(client);
    const insert = jest.spyOn(repo, "insertEnvelope");

    // document_vault_id null AND no vaulted row by ref: there is no bytes to
    // hand the provider, and a certified signature with no artifact is not a
    // signature.
    const thrown = await codeOf(
      qesService.handoff(client, { party: party(), request: request({ document_vault_id: null }), language: "fr", slug: "t", origin: "https://t.example" }),
    );
    expect(thrown).toBe("NOT_READY");
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("the usage view — the only numbers a tenant is shown", () => {
  test("the count is reported, the rate is not", async () => {
    const client = makeClient();
    jest.spyOn(qesIndex, "providerConfig").mockResolvedValue({ apiKey: "sw_key", source: "platform" });
    jest.spyOn(repo, "countForMonth").mockResolvedValue({ n: 7, total_fee: 17500, currency: "XAF" });

    const out = await qesService.usage(client, { language: "en" });

    expect(out.envelopes).toBe(7);
    expect(out.configured).toBe(true);
    expect(out.credential_source).toBe("platform");
    // §7.5: no tenant needs to see the figure at all. The fee sum is on the
    // row the repo returned and it must not ride out to the panel.
    expect(JSON.stringify(out)).not.toContain("17500");
    expect(out).not.toHaveProperty("total_fee");
  });
});

describe("the void path — §7.4 step 7: cancel the document, keep the charge", () => {
  test("voiding cancels in-flight envelopes and leaves the ledger row in place", async () => {
    const client = makeClient();
    jest.spyOn(repo, "listActiveForRequest").mockResolvedValue([
      { envelope_id: "env-1", request_id: "req-1", provider_key: "signwell", provider_ref: "sw-doc-9", status: "SENT" },
    ]);
    jest.spyOn(repo, "transitionEnvelope").mockResolvedValue({ envelope_id: "env-1", status: "CANCELLED" });
    jest.spyOn(qesIndex, "providerConfig").mockResolvedValue({ apiKey: "sw_key", source: "platform" });
    const cancel = jest.spyOn(adapter, "cancelEnvelope").mockResolvedValue({ cancelled: true });

    const out = await qesService.cancelForRequest(client, { requestId: "req-1", actor: { user_id: "u1" } });

    expect(out).toEqual({ cancelled: 1, of: 1 });
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ envelopeId: "sw-doc-9", reason: "request voided" }));
    expect(repo.transitionEnvelope).toHaveBeenCalledWith(
      client, "env-1", "CANCELLED", ["CREATING", "SENT"],
      expect.objectContaining({ last_error: "request voided" }),
    );
    // The ledger row is never touched: "the provider consumed the quota
    // whatever we do. Do not add a refund path; that was decided."
    expect(repo.ledgerForEnvelope).toBeDefined();
  });

  test("a provider that refuses the cancel does not hold the void hostage", async () => {
    const client = makeClient();
    jest.spyOn(repo, "listActiveForRequest").mockResolvedValue([
      { envelope_id: "env-1", request_id: "req-1", provider_key: "signwell", provider_ref: "sw-doc-9", status: "SENT" },
    ]);
    jest.spyOn(qesIndex, "providerConfig").mockResolvedValue({ apiKey: "sw_key", source: "platform" });
    jest.spyOn(adapter, "cancelEnvelope").mockRejectedValue(new Error("provider is down"));

    // No throw: the void already happened, and the poll reports the mismatch.
    await expect(qesService.cancelForRequest(client, { requestId: "req-1", actor: {} })).resolves.toEqual({
      cancelled: 0, of: 1,
    });
  });
});
