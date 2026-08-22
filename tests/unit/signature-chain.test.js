"use strict";

/**
 * The signing chain — doc/SIGNATURE_ENGINEERING_GUIDE.md §6, and §6.9's
 * criteria 3, 7, 8 and 10.
 *
 * The chain is where the programme's most expensive failure lives: party A
 * signs one set of figures, somebody edits the document, and party B
 * countersigns a different set believing they agreed to the same thing. Both
 * signatures would verify against their own moment and the chain would be a
 * lie. §1.3(a) is the rule; this is the test that it holds.
 */

const canonical = require("../../src/services/signatures/canonical");
const fixtures = require("../fixtures/signature-canonical.fixtures");

const service = require("../../src/modules/vault/signature_request/signature_request.service");
const publicService = require("../../src/modules/vault/signature_public/signature_public.service");
const sigService = require("../../src/modules/vault/document_signature/document_signature.service");
const repo = require("../../src/modules/vault/signature_request/signature_request.repo");
const sigRepo = require("../../src/modules/vault/document_signature/document_signature.repo");

const HASH = canonical.hash("FINAL_INVOICE", fixtures.FINAL_INVOICE);

const request = (over = {}) => ({
  request_id: "req-1",
  entity_ref: "final_invoice:abc",
  doc_type: "FINAL_INVOICE",
  document_vault_id: null,
  payload_version: 1,
  content_hash: HASH,
  allowed_presets: ["STAMP", "DRAWN"],
  status: "PARTIALLY_SIGNED",
  message: null,
  expires_at: null,
  completed_at: null,
  certificate_doc_id: null,
  reminder_count: 0,
  created_by: "user-1",
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
  allowed_presets: ["STAMP", "DRAWN"],
  status: "SENT",
  sign_token_hmac: "hmac-2",
  sign_expires_at: new Date(Date.now() + 86_400_000),
  ...over,
});

const codeOf = async (p) => {
  try { await p; return null; } catch (e) { return e.code || e.message; }
};

afterEach(() => jest.restoreAllMocks());

/** A tenant connection that answers the few queries these paths make. */
const makeClient = () => {
  const emitted = [];
  return {
    emitted,
    query: async (sql, params = []) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/INSERT INTO event_log/.test(sql)) { emitted.push(params[0]); return { rows: [] }; }
      if (/FROM event_type/.test(sql)) return { rows: [{ is_security_critical: false, is_approvable: false }] };
      if (/INSERT INTO immutable_ledger/.test(sql)) return { rows: [] };
      if (/compliance_flag/.test(sql)) return { rows: [] };
      if (/FROM setting/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
};

describe("§6.9 criterion 7 — the amendment guard", () => {
  test("an unchanged document passes and returns the live record", async () => {
    jest.spyOn(sigService, "loadDoc").mockResolvedValue(fixtures.FINAL_INVOICE);
    const doc = await service.assertUnamended(makeClient(), request());
    expect(doc.number).toBe(fixtures.FINAL_INVOICE.number);
  });

  test("an edited document returns 409 DOCUMENT_AMENDED", async () => {
    // Party A signed 1 608 800.75. Somebody edits a line. Party B must not be
    // able to countersign a different payload believing it is the same one.
    jest.spyOn(sigService, "loadDoc").mockResolvedValue({
      ...fixtures.FINAL_INVOICE, totals: { ...fixtures.FINAL_INVOICE.totals, total_ttc: 1_812_400 },
    });
    jest.spyOn(sigRepo, "listByRef").mockResolvedValue([]);
    jest.spyOn(sigRepo, "amendmentFlagExists").mockResolvedValue(false);
    const raise = jest.spyOn(sigRepo, "raiseAmendmentFlag").mockResolvedValue(undefined);
    const transition = jest.spyOn(repo, "transitionRequest").mockResolvedValue(request({ status: "AMENDED" }));

    const client = makeClient();
    expect(await codeOf(service.assertUnamended(client, request()))).toBe("DOCUMENT_AMENDED");

    // The chain must LEAVE the signable set, not merely refuse this one call.
    expect(transition).toHaveBeenCalledWith(client, "req-1", "AMENDED", ["DRAFT", "SENT", "PARTIALLY_SIGNED"]);
    // And it must be loud: Q5 = C.
    expect(raise).toHaveBeenCalled();
    expect(client.emitted).toContain("document_signature.amended");
  });

  test("an unreadable document refuses to sign rather than accusing anybody", async () => {
    // "We cannot check" and "it changed" are different claims, and only one of
    // them says somebody edited a signed document.
    jest.spyOn(sigService, "loadDoc").mockRejectedValue(new Error("no loader"));
    const transition = jest.spyOn(repo, "transitionRequest").mockResolvedValue(null);
    expect(await codeOf(service.assertUnamended(makeClient(), request()))).toBe("DOCUMENT_UNREADABLE");
    expect(transition).not.toHaveBeenCalled();
  });
});

describe("§6.6 — the issuer signs before dispatch", () => {
  test("dispatch refuses while an unsigned ISSUER sits at sequence 1", async () => {
    // A counterparty must never receive a link to countersign a document the
    // issuing company has not signed — that is how a document goes out
    // attested by nobody.
    jest.spyOn(repo, "getRequest").mockResolvedValue(request({ status: "DRAFT" }));
    jest.spyOn(repo, "listParties").mockResolvedValue([
      party({ party_id: "p1", sequence_no: 1, party_kind: "ISSUER", status: "PENDING" }),
      party({ party_id: "p2", sequence_no: 2, status: "PENDING" }),
    ]);
    expect(await codeOf(service.dispatch(makeClient(), { id: "req-1" }))).toBe("ISSUER_NOT_SIGNED");
  });

  test("once the issuer has signed, the next party gets a link", async () => {
    jest.spyOn(repo, "getRequest").mockResolvedValue(request({ status: "DRAFT" }));
    jest.spyOn(repo, "listParties").mockResolvedValue([
      party({ party_id: "p1", sequence_no: 1, party_kind: "ISSUER", status: "SIGNED" }),
      party({ party_id: "p2", sequence_no: 2, status: "PENDING" }),
    ]);
    const update = jest.spyOn(repo, "updateParty").mockImplementation(async (_c, id, patch) => party({ party_id: id, ...patch }));
    jest.spyOn(repo, "transitionRequest").mockResolvedValue(request({ status: "SENT" }));

    process.env.SIGNATURE_TOKEN_PEPPER = "x".repeat(48);
    const out = await service.dispatch(makeClient(), { id: "req-1" });

    // The plaintext is returned ONCE, for the email. What is STORED is the
    // HMAC — a leaked sign token is a forged signature, which is why this one
    // is peppered where the verify code is not (§3.7).
    expect(out.token).toBeTruthy();
    const [, , patch] = update.mock.calls[0];
    expect(patch.sign_token_hmac).toBeTruthy();
    expect(patch.sign_token_hmac).not.toBe(out.token);
    expect(patch.status).toBe("SENT");
  });
});

describe("§6.9 criterion 8 — a decline stops the chain and keeps the record", () => {
  test("the request goes DECLINED with the reason, and the creator is told", async () => {
    const settle = jest.spyOn(repo, "settleParty").mockResolvedValue(party({ status: "DECLINED", decline_reason: "Figures wrong" }));
    const transition = jest.spyOn(repo, "transitionRequest").mockResolvedValue(request({ status: "DECLINED" }));
    const client = makeClient();

    await service.decline(client, { request: request(), party: party(), reason: "Figures wrong" });

    expect(settle).toHaveBeenCalledWith(expect.anything(), "party-2", "DECLINED", { decline_reason: "Figures wrong" });
    expect(transition).toHaveBeenCalledWith(client, "req-1", "DECLINED", ["DRAFT", "SENT", "PARTIALLY_SIGNED"]);
    expect(client.emitted).toContain("document_signature.declined");
  });

  test("a decline needs a reason", async () => {
    expect(await codeOf(service.decline(makeClient(), { request: request(), party: party(), reason: "" })))
      .toBe("NO_REASON");
  });

  test("a party that already responded cannot decline again", async () => {
    jest.spyOn(repo, "settleParty").mockResolvedValue(null);
    expect(await codeOf(service.decline(makeClient(), { request: request(), party: party(), reason: "x" })))
      .toBe("ALREADY_SETTLED");
  });
});

describe("chain advance", () => {
  test("with a party still pending, the request is PARTIALLY_SIGNED", async () => {
    jest.spyOn(repo, "nextPendingParty").mockResolvedValue(party({ party_id: "p3", status: "SENT" }));
    const transition = jest.spyOn(repo, "transitionRequest").mockResolvedValue(request());
    const client = makeClient();
    const out = await service.advance(client, { request: request(), party: party() });
    expect(out.completed).toBe(false);
    expect(transition).toHaveBeenCalledWith(client, "req-1", "PARTIALLY_SIGNED", ["DRAFT", "SENT", "PARTIALLY_SIGNED"]);
  });

  test("with nobody left, the request COMPLETES exactly once", async () => {
    jest.spyOn(repo, "nextPendingParty").mockResolvedValue(null);
    const transition = jest.spyOn(repo, "transitionRequest").mockResolvedValue(request({ status: "COMPLETED" }));
    const client = makeClient();
    const out = await service.advance(client, { request: request(), party: party() });
    expect(out.completed).toBe(true);
    expect(client.emitted).toContain("document_signature.completed");
    // The expected-state guard is what makes a concurrent second completion a
    // no-op rather than a second certificate.
    expect(transition.mock.calls[0][3]).toEqual(["DRAFT", "SENT", "PARTIALLY_SIGNED"]);
  });

  test("a second completion is not an error and emits nothing", async () => {
    jest.spyOn(repo, "nextPendingParty").mockResolvedValue(null);
    jest.spyOn(repo, "transitionRequest").mockResolvedValue(null); // somebody got there first
    const client = makeClient();
    const out = await service.advance(client, { request: request(), party: party() });
    expect(out).toEqual({ completed: true, already: true });
    expect(client.emitted).not.toContain("document_signature.completed");
  });
});

describe("§6.9 criterion 3 — the signer never supplies an address", () => {
  const validator = require("../../src/modules/vault/signature_public/signature_public.validator");

  test("no schema on the public signing side has an email field", () => {
    const shapes = ["completeBody", "declineBody", "verifyBody", "otpBody"];
    for (const name of shapes) {
      expect(Object.keys(validator.schemas[name].shape)).not.toContain("email");
    }
  });

  test("a body carrying an email is REJECTED, not ignored", () => {
    // Rejected rather than stripped, for the same reason document_signature's
    // validator rejects `signer_name`: a permissive schema that quietly drops
    // it lets a caller believe it was honoured.
    const parsed = validator.schemas.completeBody.safeParse({
      preset_code: "STAMP", email: "attacker@evil.cm",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
  });

  test("the page's own payload masks the address", async () => {
    const otp = require("../../src/services/signatures/otp");
    expect(otp.maskEmail("aissatou@cimencam.cm")).toBe("a••••@cimencam.cm");
  });
});

describe("§6.9 criterion 10 — the internal step-up", () => {
  const settings = (rows) => ({
    query: async (sql, params = []) => {
      if (/FROM setting/.test(sql)) {
        const key = params[1];
        return Object.prototype.hasOwnProperty.call(rows, key) ? { rows: [{ value: rows[key] }] } : { rows: [] };
      }
      return { rows: [] };
    },
  });

  test("off by default — a dispatcher signing forty waybills does forty sessions, not forty OTPs", async () => {
    expect(await sigService.stepUpNeeded(settings({}), {
      docType: "FINAL_INVOICE", doc: fixtures.FINAL_INVOICE,
    })).toBe(false);
  });

  test("enabled with a threshold below the total: required", async () => {
    expect(await sigService.stepUpNeeded(
      settings({ stepup_enabled: true, stepup_threshold_xaf: 1_000_000 }),
      { docType: "FINAL_INVOICE", doc: fixtures.FINAL_INVOICE },
    )).toBe(true);
  });

  test("enabled with a threshold above the total: not required", async () => {
    expect(await sigService.stepUpNeeded(
      settings({ stepup_enabled: true, stepup_threshold_xaf: 50_000_000 }),
      { docType: "FINAL_INVOICE", doc: fixtures.FINAL_INVOICE },
    )).toBe(false);
  });

  test("a threshold of zero makes the product universal-OTP, in one setting", async () => {
    // §1.5(b): "If you want internal OTP unconditionally, it is one line."
    expect(await sigService.stepUpNeeded(
      settings({ stepup_enabled: true, stepup_threshold_xaf: 0 }),
      { docType: "FINAL_INVOICE", doc: fixtures.FINAL_INVOICE },
    )).toBe(true);
  });

  test("a doc type with no money on its face never steps up", async () => {
    // The threshold is about value at risk, and a waybill carries none.
    expect(sigService.documentTotalXaf("DELIVERY_NOTE", fixtures.DELIVERY_NOTE)).toBeNull();
    expect(await sigService.stepUpNeeded(
      settings({ stepup_enabled: true, stepup_threshold_xaf: 0 }),
      { docType: "DELIVERY_NOTE", doc: fixtures.DELIVERY_NOTE },
    )).toBe(false);
  });

  test("the total is DERIVED from the canonical payload, rounding included", () => {
    // PR-1's version took a `totalXaf` argument, so every caller had to compute
    // the same figure the same way — and one that computed it wrong, or passed
    // zero, silently skipped the control.
    expect(sigService.documentTotalXaf("FINAL_INVOICE", fixtures.FINAL_INVOICE))
      .toBe(fixtures.FINAL_INVOICE.totals.total_ttc);

    // And it is the CANONICAL figure, not the raw column: the fixture's salary
    // is 1 250 000.004 and the builder rounds money to 2dp (§3.6). The
    // threshold therefore compares against the number the signature actually
    // attests to, which is the whole reason it is read from here.
    expect(fixtures.EMPLOYMENT_CONTRACT.gross_salary).toBe(1_250_000.004);
    expect(sigService.documentTotalXaf("EMPLOYMENT_CONTRACT", fixtures.EMPLOYMENT_CONTRACT))
      .toBe(1_250_000);
  });
});

describe("funnel level 3 — the sender gets two booleans, not a menu", () => {
  const presets = require("../../src/services/signatures/presets");

  test("by default the sender narrows nothing", async () => {
    jest.spyOn(presets, "resolveMenu").mockResolvedValue({
      cards: [{ preset_code: "STAMP" }, { preset_code: "DRAWN" }], blocked: [], default: "STAMP",
    });
    expect(await service.resolveAllowedPresets({}, { docType: "FINAL_INVOICE" }))
      .toEqual(["STAMP", "DRAWN"]);
  });

  test("`allowPaper: false` drops PRINT_SIGN and nothing else", async () => {
    jest.spyOn(presets, "resolveMenu").mockResolvedValue({
      cards: [{ preset_code: "STAMP" }, { preset_code: "PRINT_SIGN" }], blocked: [], default: "STAMP",
    });
    expect(await service.resolveAllowedPresets({}, { docType: "FINAL_INVOICE", allowPaper: false }))
      .toEqual(["STAMP"]);
  });

  test("`requireCertified` collapses the menu to CERTIFIED alone", async () => {
    jest.spyOn(presets, "resolveMenu").mockResolvedValue({
      cards: [{ preset_code: "STAMP" }, { preset_code: "CERTIFIED" }], blocked: [], default: "STAMP",
    });
    expect(await service.resolveAllowedPresets({}, { docType: "FINAL_INVOICE", requireCertified: true }))
      .toEqual(["CERTIFIED"]);
  });

  test("requiring certification where it is unavailable fails at CREATE, not at signing", async () => {
    // The sender finds out; the counterparty does not open a page with no
    // options on it.
    jest.spyOn(presets, "resolveMenu").mockResolvedValue({
      cards: [{ preset_code: "STAMP" }], blocked: [{ preset_code: "CERTIFIED", reason: "FEATURE_OFF" }], default: "STAMP",
    });
    expect(await codeOf(service.resolveAllowedPresets({}, { docType: "DELIVERY_NOTE", requireCertified: true })))
      .toBe("CERTIFIED_NOT_AVAILABLE");
  });
});

describe("the public signing surface refuses what it should", () => {
  test("a settled party is told plainly rather than shown the form again", () => {
    expect(() => publicService.assertSignable(party({ status: "SIGNED" }), request()))
      .toThrow(/already signed/i);
    expect(() => publicService.assertSignable(party({ status: "DECLINED" }), request()))
      .toThrow(/already declined/i);
  });

  test("an amended request is refused with its own code, not a generic 404", () => {
    // The counterparty needs to know the sender has to reissue — "not found"
    // would send them chasing a broken link that is not broken.
    expect(() => publicService.assertSignable(party(), request({ status: "AMENDED" })))
      .toThrow(/changed after the request was created/i);
  });

  test("a closed request is closed", () => {
    for (const status of ["COMPLETED", "DECLINED", "VOIDED", "EXPIRED"]) {
      expect(() => publicService.assertSignable(party(), request({ status }))).toThrow();
    }
  });
});
