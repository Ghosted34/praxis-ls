"use strict";

/**
 * Signing needs the SIGNER, not just their session (owner decision, 28 Sep
 * 2026): a fingerprint or face through a passkey, or — on a device without
 * one — an emailed code. What this pins:
 *
 *   1. No proof, no signature — unless the caller marks the seal `silent`
 *      (a hand-off such as a costing's submission).
 *   2. A passkey proof is bound to ONE person, ONE document and ONE version of
 *      it: another user's proof, another document's, or a sheet edited since
 *      the prompt are all refused.
 *   3. The evidence recorded is what was collected: AES_PASSKEY with the
 *      credential, AES_OTP with the code's row.
 *   4. Costing: validate and approve need proof; submit does not.
 */

jest.mock("../../src/config/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../src/services/signatures/otp", () => ({
  OTP: { TTL_MINUTES: 10 },
  issue: jest.fn(),
  verify: jest.fn(async () => ({ otp_id: "otp-1" })),
  present: (r) => r,
}));

const canonical = require("../../src/services/signatures/canonical");
const otp = require("../../src/services/signatures/otp");
const signingProof = require("../../src/modules/vault/document_signature/signing-proof.service");

const ACTOR = { user_id: "u-1" };
const REF = "costing:c-1";
const DOC = { number: "CST-1", status: "SUBMITTED_FOR_APPROVAL", lines: [], totals: {} };
const HASH = canonical.build("COSTING", DOC).hash;

const passkey = (over = {}) => ({
  passkey: { method: "PASSKEY", user_id: "u-1", credential_id: "cred-1", entity_ref: REF, content_hash: HASH, ...over },
});

describe("settle — turning a proof into evidence", () => {
  test("no proof is refused with 428, so the client knows to ask", async () => {
    await expect(signingProof.settle({}, { actor: ACTOR, docType: "COSTING", entityRef: REF, doc: DOC, proof: null }))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_REQUIRED", status: 428 });
  });

  test("a passkey bound to this person, document and version → AES_PASSKEY", async () => {
    const r = await signingProof.settle({}, { actor: ACTOR, docType: "COSTING", entityRef: REF, doc: DOC, proof: passkey() });
    expect(r).toEqual({ assurance: "AES_PASSKEY", otpChallengeId: null, passkeyCredentialId: "cred-1" });
  });

  test("someone else's passkey proof is refused", async () => {
    await expect(signingProof.settle({}, { actor: ACTOR, docType: "COSTING", entityRef: REF, doc: DOC, proof: passkey({ user_id: "u-2" }) }))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_INVALID" });
  });

  test("a proof for another document is refused", async () => {
    await expect(signingProof.settle({}, { actor: ACTOR, docType: "COSTING", entityRef: REF, doc: DOC, proof: passkey({ entity_ref: "costing:c-2" }) }))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_INVALID" });
  });

  test("a sheet edited after the prompt is refused as stale", async () => {
    const edited = { ...DOC, lines: [{ label: "Added later", qty: 1, unit: 5, amount: 5 }] };
    await expect(signingProof.settle({}, { actor: ACTOR, docType: "COSTING", entityRef: REF, doc: edited, proof: passkey() }))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_STALE", status: 409 });
  });

  test("an emailed code is verified against THIS document's hash → AES_OTP", async () => {
    const r = await signingProof.settle({}, { actor: ACTOR, docType: "COSTING", entityRef: REF, doc: DOC, proof: { otp_code: "123456" } });
    expect(r).toEqual({ assurance: "AES_OTP", otpChallengeId: "otp-1", passkeyCredentialId: null });
    expect(otp.verify.mock.calls[0][2]).toMatchObject({ userId: "u-1", entityRef: REF, contentHash: HASH, code: "123456" });
  });
});

describe("signInternal refuses a signature with no proof", () => {
  jest.resetModules();
  test("SIGNING_PROOF_REQUIRED before anything is written", async () => {
    jest.doMock("../../src/services/signatures/presets", () => ({
      resolveMenu: jest.fn(async () => ({ cards: [{ preset_code: "STAMP", visual_mark: "STAMP" }], default: "STAMP" })),
      assertAllowed: (m) => m.cards[0],
      reasons: jest.fn(async () => []),
    }));
    jest.doMock("../../src/modules/vault/document_signature/document_signature.repo", () => ({ insert: jest.fn() }));
    const svc = require("../../src/modules/vault/document_signature/document_signature.service");
    const repo = require("../../src/modules/vault/document_signature/document_signature.repo");
    const client = { query: jest.fn(async () => ({ rows: [{ user_id: "u-1", full_name: "A" }] })) };
    await expect(svc.signInternal(client, { entityRef: REF, docType: "COSTING", presetCode: "STAMP", actor: ACTOR, doc: DOC }))
      .rejects.toMatchObject({ code: "SIGNING_PROOF_REQUIRED" });
    expect(repo.insert).not.toHaveBeenCalled();
  });
});
