"use strict";

/**
 * 14150 — the client portal's own rules (portal_client.service).
 *
 *   1. An invoice's state is read the way a client reads it — due, overdue,
 *      part paid, paid, "we are checking your payment" — from the same
 *      allocations the receivables ledger uses, and balances never add two
 *      currencies together.
 *   2. A payment claim is checked the way a finance clerk would check it, and
 *      is only ever a CLAIM: it notifies finance at HIGH priority and writes
 *      nothing to the ledger.
 *   3. Staff can only accept or reject something a client actually sent, and a
 *      rejection always carries the reason the client will read.
 *   4. Confirming a payment drafts a receipt only when it names invoices, and a
 *      failed draft puts the claim back so it cannot read as done.
 *   5. A client team always keeps an admin, nobody removes themselves, and a
 *      person with another company's access is not silently moved.
 */

let mockRepo;
let mockEvents = [];
let mockAudits = [];
let mockVault = [];
let mockReceipts = [];
let mockReceiptFails = false;

jest.mock("../../src/modules/portal/portal_client.repo", () => new Proxy({}, {
  get: (_t, name) => (...args) => {
    if (!mockRepo[name]) throw new Error(`repo.${String(name)} not mocked`);
    return mockRepo[name](...args);
  },
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  createDocument: async (c, opts) => {
    mockVault.push(opts);
    return { doc_id: `doc-${mockVault.length}` };
  },
  fetchBytes: async () => ({ doc: { original_name: "x.pdf" }, buffer: Buffer.from("x") }),
  hasBytes: (p) => !!p && !String(p).startsWith("pending://"),
}));
jest.mock("../../src/modules/finance/smart_receivables/smart_receivables.service", () => ({
  createDraft: async (c, args) => {
    if (mockReceiptFails) throw new Error("treasury account missing");
    mockReceipts.push(args);
    return { receipt_id: `rc-${mockReceipts.length}` };
  },
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async (c, e) => {
    mockEvents.push(e);
  },
  audit: async (c, a) => {
    mockAudits.push(a);
  },
  resolveActorId: async (c, id) => id || null,
}));
jest.mock("../../src/modules/portal/portal.service", () => ({
  clientChain: async () => ({ milestones: [], assumptions: [] }),
  clientDocuments: async () => [],
  clientInvoice: async () => ({ invoice: {}, lines: [] }),
}));

const svc = require("../../src/modules/portal/portal_client.service");

const c = { query: async () => ({ rows: [] }) };
const file = { buffer: Buffer.from("%PDF-1.4"), mimetype: "application/pdf", originalname: "receipt.pdf" };

async function rejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection, the call resolved");
}

beforeEach(() => {
  mockEvents = [];
  mockAudits = [];
  mockVault = [];
  mockReceipts = [];
  mockReceiptFails = false;
  mockRepo = {};
});

describe("invoice state, as a client reads it", () => {
  const row = (over) => ({
    invoice_id: "i-1", doc_number: "FCT-1", status: "POSTED_LOCKED", currency: "XAF",
    total_ttc: "1000.00", allocated: "0", in_review: "0", payment_due_on: "2026-10-10", ...over,
  });

  it.each([
    ["nothing paid, not yet due", {}, "DUE"],
    ["nothing paid, past due", { payment_due_on: "2026-09-01" }, "OVERDUE"],
    ["part paid", { allocated: "400" }, "PART_PAID"],
    ["paid in full", { allocated: "1000" }, "PAID"],
    ["a claim covers the rest", { allocated: "400", in_review: "600" }, "IN_REVIEW"],
    ["cancelled", { status: "CANCELLED" }, "CANCELLED"],
  ])("%s", (_label, over, state) => {
    expect(svc.invoiceView(row(over), "2026-09-28").state).toBe(state);
  });

  it("what is left to pay never goes negative, and a cancelled invoice owes nothing", () => {
    expect(svc.invoiceView(row({ allocated: "1200" }), "2026-09-28").outstanding).toBe(0);
    expect(svc.invoiceView(row({ status: "REVERSED" }), "2026-09-28").outstanding).toBe(0);
  });

  it("balances are per currency — XAF and EUR are never added", () => {
    const totals = svc.totalsByCurrency([
      { currency: "XAF", state: "DUE", outstanding: 1000 },
      { currency: "XAF", state: "OVERDUE", outstanding: 500 },
      { currency: "EUR", state: "DUE", outstanding: 20 },
      { currency: "XAF", state: "PAID", outstanding: 0 },
    ]);
    expect(totals).toEqual([
      { currency: "XAF", due: 1500, overdue: 500, count: 2 },
      { currency: "EUR", due: 20, overdue: 0, count: 1 },
    ]);
  });

  it("reads a transport mode from the service type key, and falls back rather than guessing", () => {
    expect(svc.modeOf("SEA_FREIGHT_IMPORT")).toBe("SEA");
    expect(svc.modeOf("AIR_EXPORT")).toBe("AIR");
    expect(svc.modeOf("HINTERLAND_TRANSIT")).toBe("ROAD");
    expect(svc.modeOf("WAREHOUSING")).toBe("STORAGE");
    expect(svc.modeOf("SOMETHING_ELSE")).toBe("OTHER");
  });
});

describe("proof of payment — a claim, checked like a finance clerk would", () => {
  const base = { clientId: "cl-1", email: "ada@acme.example", amount: 1000, currency: "XAF", method: "BANK", paidOn: "2026-09-20", file, slug: "acme" };

  beforeEach(() => {
    mockRepo.payableInvoices = async (_c, _cl, ids) => ids.filter((id) => id !== "foreign").map((invoice_id) => ({ invoice_id }));
    mockRepo.ownsDossier = async () => null;
    mockRepo.documentType = async () => ({ ref_id: "ref-pp", code: "PAYMENT_PROOF" });
    mockRepo.insertProof = async (_c, row) => ({ payment_proof_id: row.payment_proof_id, status: "SUBMITTED" });
    mockRepo.insertProofAllocations = async () => {};
    mockRepo.proofById = async (_c, id) => ({ payment_proof_id: id, amount: "1000", currency: "XAF", status: "SUBMITTED", allocations: [], doc_id: "doc-1" });
  });

  it("needs the receipt itself", async () => {
    expect((await rejection(svc.submitProof(c, { ...base, file: null }))).code).toBe("FILE_REQUIRED");
  });

  it("refuses a payment dated in the future", async () => {
    expect((await rejection(svc.submitProof(c, { ...base, paidOn: "2999-01-01" }))).code).toBe("BAD_DATE");
  });

  it("refuses an invoice that is not this client's — as NOT_FOUND, not FORBIDDEN", async () => {
    const err = await rejection(svc.submitProof(c, { ...base, allocations: [{ invoice_id: "foreign", amount: 1000 }] }));
    expect(err.status).toBe(404);
  });

  it("refuses allocations adding up to more than was paid", async () => {
    const err = await rejection(svc.submitProof(c, {
      ...base,
      allocations: [{ invoice_id: "i-1", amount: 700 }, { invoice_id: "i-2", amount: 700 }],
    }));
    expect(err.code).toBe("ALLOCATION_EXCEEDS");
  });

  it("files the receipt as a PENDING vault document and tells finance at HIGH priority", async () => {
    const out = await svc.submitProof(c, { ...base, allocations: [{ invoice_id: "i-1", amount: 1000 }] });
    expect(out.status).toBe("SUBMITTED");
    expect(mockVault[0].status).toBe("PENDING");
    expect(mockVault[0].sniff).toBe(true);
    const ev = mockEvents.find((e) => e.eventTypeKey === "payment_proof.submitted");
    expect(ev.moduleKey).toBe("MOD-52");
    expect(ev.priority).toBe("HIGH");
    expect(mockReceipts).toHaveLength(0);
  });
});

describe("staff review of what a client sent", () => {
  const request = (over) => ({ client_request_id: "rq-1", client_id: "cl-1", status: "SUBMITTED", answer_doc_id: "doc-9", ...over });

  beforeEach(() => {
    mockRepo.reviewRequest = async (_c, { status }) => ({ client_request_id: "rq-1", client_id: "cl-1", status });
    mockRepo.setVaultReview = jest.fn(async () => {});
  });

  it("cannot accept or reject what the client has not sent yet", async () => {
    mockRepo.requestById = async () => request({ status: "OPEN" });
    expect((await rejection(svc.reviewRequest(c, { requestId: "rq-1", decision: "ACCEPT" }))).code).toBe("NOTHING_TO_REVIEW");
  });

  it("a rejection must say what is wrong", async () => {
    mockRepo.requestById = async () => request();
    expect((await rejection(svc.reviewRequest(c, { requestId: "rq-1", decision: "REJECT", note: "  " }))).code).toBe("REASON_REQUIRED");
  });

  it("accepting verifies the vault copy and is audited", async () => {
    mockRepo.requestById = async () => request();
    await svc.reviewRequest(c, { requestId: "rq-1", decision: "ACCEPT", actor: { user_id: "u-1" } });
    expect(mockRepo.setVaultReview).toHaveBeenCalledWith(c, { docId: "doc-9", status: "VERIFIED", verifiedBy: "u-1" });
    expect(mockAudits.map((a) => a.action)).toContain("client_request.accepted");
  });
});

describe("confirming a payment claim", () => {
  const proof = (over) => ({
    payment_proof_id: "pp-1", client_id: "cl-1", amount: "1000", currency: "XAF", method: "MOBILE_MONEY",
    paid_on: "2026-09-20", status: "SUBMITTED", doc_id: "doc-1", allocations: [{ invoice_id: "i-1", amount: "1000" }], ...over,
  });

  beforeEach(() => {
    mockRepo.reviewProof = async () => ({ payment_proof_id: "pp-1", status: "CONFIRMED" });
    mockRepo.setProofReceipt = jest.fn(async () => {});
    mockRepo.reopenProof = jest.fn(async () => {});
    mockRepo.setVaultReview = jest.fn(async () => {});
  });

  it("drafts a receipt through receivables when the claim names invoices", async () => {
    mockRepo.proofById = async () => proof();
    const out = await svc.confirmProof(c, { proofId: "pp-1", actor: { user_id: "u-1" } });
    expect(mockReceipts).toHaveLength(1);
    expect(mockReceipts[0]).toMatchObject({ clientId: "cl-1", method: "MOBILE_MONEY", amount: 1000, receivedOn: "2026-09-20" });
    expect(out.receipt_id).toBe("rc-1");
    expect(mockRepo.setProofReceipt).toHaveBeenCalledWith(c, "pp-1", "rc-1");
  });

  it("an advance with no invoice is confirmed without a receipt", async () => {
    mockRepo.proofById = async () => proof({ allocations: [] });
    const out = await svc.confirmProof(c, { proofId: "pp-1" });
    expect(mockReceipts).toHaveLength(0);
    expect(out.receipt_id).toBeNull();
  });

  it("a receipt that cannot be drafted puts the claim back", async () => {
    mockRepo.proofById = async () => proof();
    mockReceiptFails = true;
    await rejection(svc.confirmProof(c, { proofId: "pp-1" }));
    expect(mockRepo.reopenProof).toHaveBeenCalledWith(c, "pp-1");
  });

  it("cannot be confirmed twice", async () => {
    mockRepo.proofById = async () => proof({ status: "CONFIRMED" });
    expect((await rejection(svc.confirmProof(c, { proofId: "pp-1" }))).code).toBe("ALREADY_REVIEWED");
  });

  it("a rejection must say why", async () => {
    expect((await rejection(svc.rejectProof(c, { proofId: "pp-1", note: "" }))).code).toBe("REASON_REQUIRED");
  });
});

describe("the client's own team", () => {
  it("does not silently move a person who has another company's access", async () => {
    mockRepo.activeClientGrantFor = async () => ({ client_id: "cl-OTHER" });
    const err = await rejection(svc.addTeamMember(c, { clientId: "cl-1", email: "bob@x.example" }));
    expect(err.code).toBe("OTHER_COMPANY");
  });

  it("refuses to add someone twice", async () => {
    mockRepo.activeClientGrantFor = async () => ({ client_id: "cl-1" });
    expect((await rejection(svc.addTeamMember(c, { clientId: "cl-1", email: "bob@x.example" }))).code).toBe("ALREADY_IN_TEAM");
  });

  it("adds a colleague with the scope chosen", async () => {
    mockRepo.activeClientGrantFor = async () => null;
    mockRepo.insertTeamGrant = async (_c, row) => ({ portal_access_id: "g-2", ...row });
    const out = await svc.addTeamMember(c, { clientId: "cl-1", email: "Bob@X.example", scope: "BILLING" });
    expect(out).toMatchObject({ email: "bob@x.example", scope: "BILLING" });
  });

  it("keeps at least one admin", async () => {
    mockRepo.countAdmins = async () => 1;
    mockRepo.teamGrants = async () => [{ portal_access_id: "g-1", is_client_admin: true }];
    const err = await rejection(svc.updateTeamMember(c, { clientId: "cl-1", grantId: "g-1", isAdmin: false, selfGrantId: "g-9" }));
    expect(err.code).toBe("LAST_ADMIN");
  });

  it("nobody removes themselves", async () => {
    const err = await rejection(svc.removeTeamMember(c, { clientId: "cl-1", grantId: "g-1", selfGrantId: "g-1" }));
    expect(err.code).toBe("SELF_REMOVE");
  });
});
