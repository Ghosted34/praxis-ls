"use strict";

/**
 * Proposals in the client portal: read, decline, and accept by e-signature
 * through the signature programme (doc/SIGNATURE_ENGINEERING_GUIDE.md).
 *
 *   1. A client reads only their own proposals, and only once they are sent.
 *   2. Signing opens a request with THIS portal user as the one ON-FILE
 *      counterparty, on behalf of whoever sent the proposal, and emails the
 *      code — without emailing a link to someone already in the portal.
 *   3. Completing verifies the code BEFORE signing, and signs before accepting.
 *   4. Where the tenant offers no digital card, accepting is a confirmed click;
 *      where it does, a click is refused — accepting IS signing.
 *   5. Declining takes a reason from the controlled list, and sales hears it.
 */

let mockProposal;
let mockMenu;
let mockCalls = [];
let mockEvents = [];
let mockParty = null;

jest.mock("../../src/modules/sales/proposal/proposal.repo", () => ({
  get: async (c, id) => (mockProposal && mockProposal.proposal_id === id ? mockProposal : null),
  listLines: async () => [{ label: "Sea freight 2×40HC", qty: 2, unit_price: 900000 }],
  listNarratives: async () => [],
  stampViewed: async () => ({}),
  stampDownloaded: async () => ({}),
}));
jest.mock("../../src/modules/sales/proposal/proposal.service", () => ({
  accept: async (c, { id }) => {
    mockCalls.push(["accept", id]);
    mockProposal.status = "ACCEPTED";
    return { proposal: mockProposal };
  },
  transition: async (c, { id, to }) => {
    mockCalls.push(["transition", id, to]);
    mockProposal.status = to;
    return mockProposal;
  },
}));
jest.mock("../../src/modules/vault/signature_request/signature_request.service", () => ({
  create: async (c, opts) => {
    mockCalls.push(["create", opts]);
    mockParty = { party_id: "party-1", request_id: "req-1", status: "PENDING" };
    return { request_id: "req-1" };
  },
  dispatch: async (c, opts) => {
    mockCalls.push(["dispatch", opts]);
    mockParty.status = "SENT";
    return { token: "t-dispatch" };
  },
  remintSignToken: async () => ({ token: "t-fresh" }),
}));
jest.mock("../../src/modules/vault/signature_public/signature_public.service", () => ({
  resolve: async () => ({
    signer: { full_name: "Marie Nguema", email_masked: "m••••@acme.cm" },
    menu: { cards: [{ preset_code: "STAMP", label: "Digital stamp" }, { preset_code: "CERTIFIED", label: "Certified" }] },
  }),
  sendOtp: async (c, { token }) => {
    mockCalls.push(["sendOtp", token]);
    return { status: "SENT" };
  },
  verifyOtp: async (c, { token, code }) => {
    mockCalls.push(["verifyOtp", token, code]);
    if (code !== "123456") {
      const e = new Error("wrong code");
      e.code = "OTP_INVALID";
      throw e;
    }
    return { status: "VERIFIED" };
  },
  complete: async (c, opts) => {
    mockCalls.push(["complete", opts.presetCode, opts.fullName]);
    return { signed: true, verify_code: "ABCD-EFGH", completed: true };
  },
  declineSigning: async (c, { reasonCode }) => {
    mockCalls.push(["declineSigning", reasonCode]);
    return { declined: true };
  },
}));
jest.mock("../../src/services/signatures/presets", () => ({
  resolveMenu: async () => mockMenu,
  reasons: async () => [{ reason_code: "PRICE", label_en: "The price", label_fr: "Le prix" }],
}));
jest.mock("../../src/modules/notification/notification.repo", () => ({
  requesterFor: async () => "sales-rep-1",
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  getByRef: async () => null,
  fetchBytes: async () => ({ buffer: Buffer.from("%PDF") }),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async (c, e) => {
    mockEvents.push(e);
  },
  audit: async () => {},
}));

const service = require("../../src/modules/portal/portal_proposal.service");

const client = {
  query: async (sql) => {
    if (/FROM signature_party/.test(sql)) return { rows: mockParty ? [mockParty] : [] };
    if (/FROM document_signature/.test(sql)) {
      return { rows: [{ signer_name: "Marie Nguema", signer_role: "Finance", created_at: "2026-09-28T10:00:00Z", visual_mark: "STAMP", assurance_level: "AES_OTP", verify_code: "ABCDEFGH" }] };
    }
    if (/FROM client_master/.test(sql)) return { rows: [{ name: "Acme Trading" }] };
    return { rows: [] };
  },
};
const ME = { portal_user_id: "pu-1", email: "marie@acme.cm", full_name: "Marie Nguema" };
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mockCalls = [];
  mockEvents = [];
  mockParty = null;
  mockMenu = { cards: [{ preset_code: "STAMP", label: "Digital stamp" }, { preset_code: "DRAWN", label: "Draw" }], blocked: [] };
  mockProposal = {
    proposal_id: ID, client_id: "c1", status: "SENT", title: "Tiles, Shanghai → Douala", doc_number: "PROP-2026-0009",
    currency: "XAF", validity_days: 30, created_at: new Date(), updated_at: new Date(), language: "EN",
  };
});

describe("reading", () => {
  it("shows a sent proposal with its total and the ways to answer it", async () => {
    const out = await service.get(client, { clientId: "c1", proposalId: ID });
    expect(out.proposal).toMatchObject({ status: "SENT", total: 1800000, doc_number: "PROP-2026-0009" });
    expect(out.signing.available).toBe(true);
    expect(out.signing.cards.map((c) => c.preset_code)).toEqual(["STAMP", "DRAWN"]);
    expect(out.decline_reasons).toEqual([{ reason_code: "PRICE", label: "The price" }]);
  });

  it("never shows another company's proposal, nor a draft", async () => {
    await expect(service.get(client, { clientId: "c2", proposalId: ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    mockProposal.status = "DRAFT";
    await expect(service.get(client, { clientId: "c1", proposalId: ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("signing", () => {
  it("opens the request for this portal user, on behalf of the sender, and sends only the code", async () => {
    const out = await service.startSigning(client, { clientId: "c1", proposalId: ID, me: ME, grantId: "grant-1" });
    const create = mockCalls.find((x) => x[0] === "create")[1];
    expect(create).toMatchObject({ entityRef: `proposal:${ID}`, docType: "PROPOSAL", allowPaper: false, actor: { user_id: "sales-rep-1" } });
    expect(create.parties).toEqual([
      expect.objectContaining({ party_kind: "COUNTERPARTY", source: "ON_FILE", source_ref: "portal_access:grant-1", email: "marie@acme.cm" }),
    ]);
    // No link emailed to someone who is already here.
    expect(mockCalls.find((x) => x[0] === "dispatch")[1].sendEmail).toBeNull();
    expect(mockCalls.map((x) => x[0])).toContain("sendOtp");
    expect(out.signer.email_masked).toBe("m••••@acme.cm");
    // Only the cards a signed-in client can complete here.
    expect(out.cards.map((c) => c.preset_code)).toEqual(["STAMP"]);
  });

  it("verifies the code, then signs, then accepts — in that order", async () => {
    await service.startSigning(client, { clientId: "c1", proposalId: ID, me: ME });
    mockCalls = [];
    const out = await service.completeSigning(client, { clientId: "c1", proposalId: ID, me: ME, code: "123456", presetCode: "STAMP", fullName: "Marie Nguema" });
    expect(mockCalls.map((x) => x[0])).toEqual(["verifyOtp", "complete", "accept"]);
    expect(out).toMatchObject({ accepted: true, signature: { signer_name: "Marie Nguema", assurance: "AES_OTP" } });
  });

  it("accepts nothing when the code is wrong", async () => {
    await service.startSigning(client, { clientId: "c1", proposalId: ID, me: ME });
    await expect(service.completeSigning(client, { clientId: "c1", proposalId: ID, me: ME, code: "000000", presetCode: "STAMP" })).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect(mockProposal.status).toBe("SENT");
  });

  it("refuses a proposal past its validity", async () => {
    mockProposal.updated_at = new Date(Date.now() - 40 * 86_400_000);
    await expect(service.startSigning(client, { clientId: "c1", proposalId: ID, me: ME })).rejects.toMatchObject({ code: "PROPOSAL_EXPIRED" });
  });
});

describe("accepting without a signature", () => {
  it("is refused where the tenant offers a signature", async () => {
    await expect(service.accept(client, { clientId: "c1", proposalId: ID, me: ME })).rejects.toMatchObject({ code: "SIGNATURE_REQUIRED" });
  });

  it("is a confirmed click where it does not", async () => {
    mockMenu = { cards: [], blocked: [] };
    const out = await service.accept(client, { clientId: "c1", proposalId: ID, me: ME });
    expect(out).toEqual({ accepted: true, signature: null });
    expect(mockCalls).toContainEqual(["accept", ID]);
  });
});

describe("declining", () => {
  it("takes a reason from the list, and tells sales why", async () => {
    await expect(service.decline(client, { clientId: "c1", proposalId: ID, me: ME, reasonCode: "WHATEVER" })).rejects.toMatchObject({ code: "UNKNOWN_DECLINE_REASON" });
    await service.decline(client, { clientId: "c1", proposalId: ID, me: ME, reasonCode: "PRICE", note: "Too high for Q4" });
    expect(mockCalls).toContainEqual(["transition", ID, "REJECTED"]);
    const e = mockEvents.find((x) => x.eventTypeKey === "proposal.declined_by_client");
    expect(e.payload).toMatchObject({ reason_code: "PRICE", reason: "The price — Too high for Q4" });
  });
});
