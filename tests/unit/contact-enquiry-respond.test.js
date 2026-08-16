"use strict";
/**
 * F9 — replying to an enquiry, and what happens when the send fails.
 *
 * THE INVARIANT UNDER TEST: an enquiry is RESPONDED only if an email actually
 * left. That is the whole reason the RESPONDED state was added — "replying to
 * an enquiry is distinguishable from having merely read it" is F9's definition
 * of done, and it is worth nothing if a bounced reply still flips the tile.
 *
 * The second invariant: the attempt survives its own failure. A PENDING row is
 * written BEFORE the mail engine is called, so a reply that dies mid-send
 * leaves a visible "we tried" row rather than nothing at all. The ordering
 * assertion below is the only thing that keeps that true — swap the two lines
 * in the service and every other test here still passes.
 */

jest.mock("../../src/modules/sales/inbound_intake/inbound_intake.repo");
jest.mock("../../src/services/email.service");
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
  audit: jest.fn().mockResolvedValue(undefined),
}));

const repo = require("../../src/modules/sales/inbound_intake/inbound_intake.repo");
const emailService = require("../../src/services/email.service");
const emit = require("../../src/shared/events/emit");
const service = require("../../src/modules/sales/inbound_intake/inbound_intake.service");

const ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
const actor = { user_id: "33333333-3333-4333-8333-333333333333" };

const enquiry = (over = {}) => ({
  contact_enquiry_id: ID,
  status: "READ",
  email: "visitor@example.com",
  subject: "Rates to Douala",
  ...over,
});

function wireRepo(row) {
  repo.getEnquiry.mockResolvedValue(row);
  repo.insertResponse.mockResolvedValue({ contact_enquiry_response_id: ATTEMPT_ID });
  repo.settleResponse.mockImplementation((_c, id, fields) => Promise.resolve({ contact_enquiry_response_id: id, ...fields }));
  repo.updEnquiry.mockImplementation((_c, id, fields) => Promise.resolve({ ...row, ...fields }));
}

describe("F9 respond — a successful send", () => {
  beforeEach(() => {
    wireRepo(enquiry());
    emailService.send.mockResolvedValue({ messageId: "<abc@mail>" });
  });

  test("writes the attempt PENDING before calling the mail engine", async () => {
    const order = [];
    repo.insertResponse.mockImplementation(() => { order.push("insert"); return Promise.resolve({ contact_enquiry_response_id: ATTEMPT_ID }); });
    emailService.send.mockImplementation(() => { order.push("send"); return Promise.resolve({ messageId: "<abc@mail>" }); });

    await service.respond(client, { id: ID, body: "Here are our rates.", actor });

    expect(order).toEqual(["insert", "send"]);
    expect(repo.insertResponse).toHaveBeenCalledWith(client, expect.objectContaining({
      contact_enquiry_id: ID,
      to_address: "visitor@example.com",
      body: "Here are our rates.",
    }));
  });

  test("settles the attempt SENT with the provider message id", async () => {
    await service.respond(client, { id: ID, body: "Here are our rates.", actor });
    expect(repo.settleResponse).toHaveBeenCalledWith(client, ATTEMPT_ID, expect.objectContaining({
      send_status: "SENT",
      provider_message_id: "<abc@mail>",
    }));
  });

  test("moves the enquiry to RESPONDED and stamps who answered it", async () => {
    const out = await service.respond(client, { id: ID, body: "Here are our rates.", actor });
    expect(repo.updEnquiry).toHaveBeenCalledWith(client, ID, expect.objectContaining({
      status: "RESPONDED",
      responded_by_user_id: actor.user_id,
    }));
    expect(out.enquiry.status).toBe("RESPONDED");
  });

  test("sends under the SUPPORT identity, not the no-reply notifications one", async () => {
    // A person wrote to us first. Answering from no-reply@ ends the conversation.
    await service.respond(client, { id: ID, body: "Hi.", actor });
    expect(emailService.send).toHaveBeenCalledWith(client, expect.objectContaining({ purpose: "SUPPORT" }));
  });

  test("defaults the subject to Re: the original", async () => {
    await service.respond(client, { id: ID, body: "Hi.", actor });
    expect(emailService.send).toHaveBeenCalledWith(client, expect.objectContaining({ subject: "Re: Rates to Douala" }));
  });
});

describe("F9 respond — a failed send", () => {
  beforeEach(() => {
    wireRepo(enquiry());
    emailService.send.mockRejectedValue(new Error("Invalid login: 535 authentication failed"));
  });

  test("THE STATUS DOES NOT MOVE", async () => {
    await expect(service.respond(client, { id: ID, body: "Hi.", actor })).rejects.toThrow();
    // Not "was not called with RESPONDED" — not called at all. An operator
    // whose reply bounced must still see the enquiry as unanswered.
    expect(repo.updEnquiry).not.toHaveBeenCalled();
  });

  test("settles the attempt FAILED, carrying the transport's own words", async () => {
    await expect(service.respond(client, { id: ID, body: "Hi.", actor })).rejects.toThrow();
    expect(repo.settleResponse).toHaveBeenCalledWith(client, ATTEMPT_ID, expect.objectContaining({
      send_status: "FAILED",
      error: expect.stringContaining("535"),
    }));
  });

  test("emits the failure so a tenant can alert on it", async () => {
    await expect(service.respond(client, { id: ID, body: "Hi.", actor })).rejects.toThrow();
    expect(emit.emitEvent).toHaveBeenCalledWith(client, expect.objectContaining({
      eventTypeKey: "contact_enquiry.response_failed",
    }));
    expect(emit.emitEvent).not.toHaveBeenCalledWith(client, expect.objectContaining({
      eventTypeKey: "contact_enquiry.responded",
    }));
  });
});

describe("F9 respond — refusals that happen before anything is sent", () => {
  test("an enquiry with no email address cannot be 'responded' to", async () => {
    wireRepo(enquiry({ email: null }));
    await expect(service.respond(client, { id: ID, body: "Hi.", actor }))
      .rejects.toMatchObject({ code: "NO_REPLY_ADDRESS" });
    expect(repo.insertResponse).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  test("a CLOSED enquiry must be reopened first", async () => {
    wireRepo(enquiry({ status: "CLOSED" }));
    await expect(service.respond(client, { id: ID, body: "Hi.", actor }))
      .rejects.toMatchObject({ code: "LOCKED" });
    expect(emailService.send).not.toHaveBeenCalled();
  });

  test("a missing enquiry is a 404, not a send", async () => {
    repo.getEnquiry.mockResolvedValue(null);
    await expect(service.respond(client, { id: ID, body: "Hi.", actor }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(emailService.send).not.toHaveBeenCalled();
  });
});

describe("F9 triage does not answer anybody", () => {
  test("raising a lead leaves the correspondence status exactly where it was", async () => {
    const row = enquiry({ status: "NEW", lead_id: null, partnership_request_id: null });
    repo.getEnquiry.mockResolvedValue(row);
    repo.updEnquiry.mockImplementation((_c, id, fields) => Promise.resolve({ ...row, ...fields }));
    const leadRepo = require("../../src/modules/sales/lead/lead.repo");
    jest.spyOn(leadRepo, "insert").mockResolvedValue({ lead_id: "44444444-4444-4444-8444-444444444444" });

    const out = await service.triageEnquiry(client, { id: ID, toLead: true, actor });

    // The lead FK is written; `status` is not among the fields touched.
    const fields = repo.updEnquiry.mock.calls[0][2];
    expect(fields).toHaveProperty("lead_id");
    expect(fields).not.toHaveProperty("status");
    expect(out.enquiry.status).toBe("NEW");
  });
});
