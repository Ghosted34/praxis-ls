"use strict";

/**
 * The seal each costing transition applies (Q22 / Q27).
 *
 * WHAT THIS PINS, and why each matters.
 *
 * 1. THE TRANSITION SIGNS, AND THE BUTTON IS THE DECISION. The legacy sheet
 *    carries three stamped boxes because somebody walked the page round the
 *    office. Ours seals inside the same transaction that moves the status, so
 *    there is no path that records an approval without a seal — and nobody is
 *    asked to confirm the same decision twice.
 *
 * 2. EACH LEVEL SEALS WITH ITS OWN REASON. Three seals that all said the same
 *    thing would be three signatures and no chain: what a reader needs is
 *    raised → validated → approved, in those words.
 *
 * 3. IT SEALS THE SHEET AS THE DECISION LEFT IT. Sealing before the row is
 *    updated would attest to the status the sheet was moving OUT of, so an
 *    approver's seal would read SUBMITTED_FOR_APPROVAL and the verification
 *    portal would show a document whose own seal disagrees with it.
 *
 * 4. A FAILED SEAL DOES NOT UNDO THE APPROVAL. The decision is the business
 *    fact; the seal is its evidence. A tenant that has not seeded
 *    `signature_policy.COSTING` would otherwise find every costing transition
 *    failing with EMPTY_SIGNATURE_MENU on a screen that says nothing about
 *    signatures. It is logged at error level rather than swallowed.
 *
 * 5. REJECT IS NOT SEALED. A refusal is not an attestation to a budget, and a
 *    seal over a rejected sheet would verify as a signature on figures nobody
 *    committed to.
 *
 * DB-free: the service runs against a stub client, and the signature service is
 * mocked at its boundary so what is asserted is the CALL this module makes.
 */

jest.mock("../../src/services/documents/numbering.service", () => ({
  allocate: jest.fn(async () => ({ number: "CST-2026-0043" })),
}));
jest.mock("../../src/services/workflow/executor", () => ({ start: jest.fn() }));
jest.mock("../../src/services/workflow/on-approved", () => ({ register: jest.fn() }));
jest.mock("../../src/services/workflow/pending-guard", () => ({ assertNoPendingChain: jest.fn() }));
jest.mock("../../src/modules/operations/shipment_details/shipment_details.service", () => ({
  snapshotOnto: jest.fn(),
  forDossier: jest.fn(async () => null),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(),
  audit: jest.fn(),
  resolveActorId: jest.fn(async (_c, userId) => userId || null),
}));
jest.mock("../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// The two collaborators the seal reaches. Mocked at the module boundary so the
// assertions are about the call this module makes, not about the engine's own
// behaviour — which `signature-*.test.js` already pins.
jest.mock("../../src/modules/vault/document_signature/document_signature.service", () => ({
  signInternal: jest.fn(async () => ({ signature_id: "sig-1" })),
  supersedeAll: jest.fn(async () => ["old-1", "old-2", "old-3"]),
}));
// Validating and approving need the signer's passkey (or emailed code). Settled
// to AES_PASSKEY here; signing-proof.test.js pins the settling itself.
jest.mock("../../src/modules/vault/document_signature/signing-proof.service", () => ({
  settle: jest.fn(async () => ({ assurance: "AES_PASSKEY", otpChallengeId: null, passkeyCredentialId: "cred-1" })),
}));
jest.mock("../../src/services/signatures/presets", () => ({
  resolveMenu: jest.fn(async () => ({ cards: [{ preset_code: "STAMP" }], default: "STAMP" })),
}));

const service = require("../../src/modules/costing/costing/costing.service");
const signatures = require("../../src/modules/vault/document_signature/document_signature.service");
const presets = require("../../src/services/signatures/presets");
const templateSvc = require("../../src/modules/documents/template/template.service");
const { logger } = require("../../src/config/logger");

const ID = "11111111-1111-1111-1111-111111111111";
const DOSSIER = "22222222-2222-2222-2222-222222222222";
const ACTOR = { user_id: "33333333-3333-3333-3333-333333333333" };

/** A client that answers the reads `setStatus` performs and records the UPDATE. */
function stubClient({ status = "DRAFT", validatorId = "v-1", validatedBy = null, superAdmin = false } = {}) {
  const state = {
    row: {
      costing_id: ID, dossier_id: DOSSIER, status,
      validator_id: validatorId, validated_by: validatedBy, doc_number: "CST-2026-0043",
      currency: "XAF", exchange_rate_to_xaf: 1,
      total_ht: 1000, total_vat: 192.5, total_ttc: 1192.5,
    },
    updates: [],
  };
  state.query = async (text) => {
    if (/^UPDATE costing/i.test(text.trim())) {
      state.updates.push(text);
      return { rows: [{ ...state.row }] };
    }
    if (/r\.code = 'SUPER_ADMIN'/.test(text)) return { rows: superAdmin ? [{ "?column?": 1 }] : [] };
    if (/FROM costing\b/i.test(text)) return { rows: [state.row] };
    if (/FROM costing_line\b/i.test(text) || /costing_line cl/i.test(text)) return { rows: [] };
    if (/FROM dossier_visible\b/i.test(text)) return { rows: [{ entity_id: "e-1" }] };
    return { rows: [] };
  };
  return state;
}

beforeEach(() => {
  jest.clearAllMocks();
  // `sealDoc` builds the payload through the SAME projection the document
  // renders from. Stubbed to a marker so the test can prove it is what gets
  // handed to the signer, without standing up the whole projection's SQL.
  jest.spyOn(templateSvc, "loadRecord").mockResolvedValue({
    entity_id: "e-1",
    data: { number: "CST-2026-0043", status: "SEALED_PAYLOAD_MARKER" },
  });
});
afterEach(() => jest.restoreAllMocks());

describe("every level is sealed", () => {
  test.each([
    ["SUBMIT_VALIDATION", "ACKNOWLEDGED", "DRAFT"],
    ["SUBMIT_APPROVAL", "REVIEWED_ACCEPTED", "SUBMITTED_FOR_VALIDATION"],
    ["APPROVE", "APPROVED_DISPATCH", "SUBMITTED_FOR_APPROVAL"],
  ])("%s seals with %s", async (to, reason, from) => {
    const c = stubClient({ status: from });
    await service.setStatus(c, { id: ID, to, actor: ACTOR });

    expect(signatures.signInternal).toHaveBeenCalledTimes(1);
    const call = signatures.signInternal.mock.calls[0][1];
    expect(call.docType).toBe("COSTING");
    expect(call.entityRef).toBe(`costing:${ID}`);
    expect(call.signReason).toBe(reason);
    // SES: the evidence collected is the session, and no step-up is asked for
    // on an internal budget — nothing here supplies an OTP challenge.
    expect(call.otpChallengeId).toBeUndefined();
    // The card comes from the tenant's resolved menu, never a literal here: a
    // tenant that narrows its policy must narrow this too.
    expect(presets.resolveMenu).toHaveBeenCalledWith(c, { docType: "COSTING" });
    expect(call.presetCode).toBe("STAMP");
  });

  test("it seals the sheet as the decision LEFT it, not as it arrived", async () => {
    const c = stubClient({ status: "SUBMITTED_FOR_APPROVAL" });
    await service.setStatus(c, { id: ID, to: "APPROVE", actor: ACTOR });
    // The payload is the projection built AFTER the update — the same one the
    // document renders from, so the hash covers what is actually on the page.
    expect(signatures.signInternal.mock.calls[0][1].doc).toEqual({
      number: "CST-2026-0043",
      status: "SEALED_PAYLOAD_MARKER",
    });
    expect(templateSvc.loadRecord).toHaveBeenCalledWith(c, "COSTING", ID);
  });

  test("REJECT is not sealed — a refusal is not an attestation", async () => {
    const c = stubClient({ status: "SUBMITTED_FOR_APPROVAL" });
    await service.setStatus(c, { id: ID, to: "REJECT", actor: ACTOR });
    expect(signatures.signInternal).not.toHaveBeenCalled();
  });

  test("an unauthenticated caller seals nothing rather than signing as nobody", async () => {
    const c = stubClient({ status: "DRAFT" });
    await service.setStatus(c, { id: ID, to: "SUBMIT_VALIDATION", actor: {} });
    expect(signatures.signInternal).not.toHaveBeenCalled();
  });
});

describe("a seal that fails does not undo the decision", () => {
  test("the status change stands, and the gap is logged rather than swallowed", async () => {
    presets.resolveMenu.mockRejectedValueOnce(
      Object.assign(new Error("No signature method is available"), { code: "EMPTY_SIGNATURE_MENU" }),
    );
    const c = stubClient({ status: "SUBMITTED_FOR_APPROVAL" });

    // It resolves — a tenant that has not seeded its signature policy must not
    // find every costing approval failing on a settings row nobody knew about.
    const row = await service.setStatus(c, { id: ID, to: "APPROVE", actor: ACTOR });
    expect(row).toBeTruthy();
    expect(c.updates.length).toBeGreaterThan(0);

    // …but an unsealed approval is a real gap in the evidence chain, so it is
    // an ERROR, not a warning and not silence.
    expect(logger.error).toHaveBeenCalled();
    const [, message] = logger.error.mock.calls[0];
    expect(message).toMatch(/could not be sealed/i);
  });
});

/*
 * ONE SEAL PER STEP (14190). SBX-CST-2026-0001 printed six seals: approved,
 * unlocked, re-approved, and the first three were never retired. These pin the
 * two places that now retire them.
 */
describe("one seal per step, never six", () => {
  test("every transition seal supersedes an earlier seal for the same step", async () => {
    const c = stubClient({ status: "SUBMITTED_FOR_APPROVAL" });
    await service.setStatus(c, { id: ID, to: "APPROVE", actor: ACTOR });
    expect(signatures.signInternal.mock.calls[0][1].supersedeStep).toBe(true);
  });

  test("UNLOCK retires every live seal on the costing", async () => {
    const c = stubClient({ status: "UNLOCK_REQUESTED" });
    await service.unlockTransition(c, { id: ID, action: "UNLOCK", actor: ACTOR });
    expect(signatures.supersedeAll).toHaveBeenCalledTimes(1);
    const call = signatures.supersedeAll.mock.calls[0][1];
    expect(call.entityRef).toBe(`costing:${ID}`);
    expect(call.reason).toMatch(/unlocked/i);
  });

  test.each(["REQUEST_UNLOCK", "DENY_UNLOCK"])("%s leaves the seals alone", async (action) => {
    const c = stubClient({ status: action === "REQUEST_UNLOCK" ? "APPROVED_LOCKED" : "UNLOCK_REQUESTED" });
    await service.unlockTransition(c, { id: ID, action, reason: "carrier re-priced", actor: ACTOR });
    expect(signatures.supersedeAll).not.toHaveBeenCalled();
  });
});

describe("the validator never approves their own validation", () => {
  test("refused for an ordinary user", async () => {
    const c = stubClient({ status: "SUBMITTED_FOR_APPROVAL", validatedBy: ACTOR.user_id });
    await expect(service.setStatus(c, { id: ID, to: "APPROVE", actor: ACTOR }))
      .rejects.toMatchObject({ code: "SAME_VALIDATOR_APPROVER" });
    expect(c.updates).toHaveLength(0);
    expect(signatures.signInternal).not.toHaveBeenCalled();
  });

  test("allowed for SUPER_ADMIN — the training account", async () => {
    const c = stubClient({ status: "SUBMITTED_FOR_APPROVAL", validatedBy: ACTOR.user_id, superAdmin: true });
    await expect(service.setStatus(c, { id: ID, to: "APPROVE", actor: ACTOR })).resolves.toBeTruthy();
  });

  test("a different approver is fine", async () => {
    const c = stubClient({ status: "SUBMITTED_FOR_APPROVAL", validatedBy: "someone-else" });
    await expect(service.setStatus(c, { id: ID, to: "APPROVE", actor: ACTOR })).resolves.toBeTruthy();
  });

  test("raising and validating may be the same person", async () => {
    const c = stubClient({ status: "SUBMITTED_FOR_VALIDATION" });
    await expect(service.setStatus(c, { id: ID, to: "SUBMIT_APPROVAL", actor: ACTOR })).resolves.toBeTruthy();
  });
});

describe("the page prints at most one seal per step", () => {
  const row = (reason, at, id) => ({ signature_id: id, sign_reason: reason, signed_at: at });
  // SBX-CST-2026-0001 as it was: three steps, each signed twice.
  const six = [
    row("ACKNOWLEDGED", "2026-09-03T13:54:00Z", "a1"),
    row("REVIEWED_ACCEPTED", "2026-09-03T13:54:10Z", "b1"),
    row("APPROVED_DISPATCH", "2026-09-03T13:54:20Z", "c1"),
    row("ACKNOWLEDGED", "2026-09-03T15:48:00Z", "a2"),
    row("REVIEWED_ACCEPTED", "2026-09-04T15:47:00Z", "b2"),
    row("APPROVED_DISPATCH", "2026-09-04T15:47:10Z", "c2"),
  ];

  test("six live costing seals print as three — the newest of each step", () => {
    const out = templateSvc.onePerStep(`costing:${ID}`, six);
    expect(out.map((r) => r.signature_id).sort()).toEqual(["a2", "b2", "c2"]);
  });

  test("other documents keep every seal — two parties can sign for one reason", () => {
    expect(templateSvc.onePerStep("invoice:1", six)).toHaveLength(6);
  });
});

describe("validating and approving need the signer's own confirmation", () => {
  const signingProof = require("../../src/modules/vault/document_signature/signing-proof.service");

  test.each([["SUBMIT_APPROVAL", "SUBMITTED_FOR_VALIDATION"], ["APPROVE", "SUBMITTED_FOR_APPROVAL"]])(
    "%s settles the proof and seals with it",
    async (to, from) => {
      const c = stubClient({ status: from });
      await service.setStatus(c, { id: ID, to, actor: ACTOR, proof: { otp_code: "123456" } });
      expect(signingProof.settle).toHaveBeenCalledWith(c, expect.objectContaining({
        docType: "COSTING", entityRef: `costing:${ID}`, proof: { otp_code: "123456" },
      }));
      const call = signatures.signInternal.mock.calls[0][1];
      expect(call.settled).toMatchObject({ assurance: "AES_PASSKEY" });
      expect(call.silent).toBe(false);
    },
  );

  test("a refused proof refuses the transition — nothing moves", async () => {
    signingProof.settle.mockRejectedValueOnce(Object.assign(new Error("no"), { code: "SIGNING_PROOF_REQUIRED", status: 428 }));
    const c = stubClient({ status: "SUBMITTED_FOR_APPROVAL" });
    await expect(service.setStatus(c, { id: ID, to: "APPROVE", actor: ACTOR })).rejects.toMatchObject({ code: "SIGNING_PROOF_REQUIRED" });
    expect(c.updates).toHaveLength(0);
  });

  test("submitting is a hand-off: no proof asked, sealed silently", async () => {
    const c = stubClient({ status: "DRAFT" });
    await service.setStatus(c, { id: ID, to: "SUBMIT_VALIDATION", actor: ACTOR });
    expect(signingProof.settle).not.toHaveBeenCalled();
    expect(signatures.signInternal.mock.calls[0][1].silent).toBe(true);
  });
});
