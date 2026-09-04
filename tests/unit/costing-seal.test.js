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
function stubClient({ status = "DRAFT", validatorId = "v-1" } = {}) {
  const state = {
    row: {
      costing_id: ID, dossier_id: DOSSIER, status,
      validator_id: validatorId, doc_number: "CST-2026-0043",
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
