"use strict";

jest.mock("../../src/modules/sales/lead/lead.service", () => ({ create: jest.fn() }));
jest.mock("../../src/modules/sales/quote_request/quote_request.service", () => ({
  resolveEntityId: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../../src/modules/sales/inbound_intake/inbound_intake.repo", () => ({
  insertEnquiry: jest.fn(),
  listEnquiries: jest.fn(),
  getEnquiry: jest.fn(),
  updateEnquiry: jest.fn(),
  kpis: jest.fn(),
}));
jest.mock("../../src/modules/sales/marketing_campaign/marketing_campaign.repo", () => ({
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));

const lead = require("../../src/modules/sales/lead/lead.service");
const quote = require("../../src/modules/sales/quote_request/quote_request.service");
const inboundRepo = require("../../src/modules/sales/inbound_intake/inbound_intake.repo");
const campaignRepo = require("../../src/modules/sales/marketing_campaign/marketing_campaign.repo");
const emit = require("../../src/shared/events/emit");
const publicIntake = require("../../src/modules/sales/public_intake/public_intake.service");
const inbound = require("../../src/modules/sales/inbound_intake/inbound_intake.service");
const campaign = require("../../src/modules/sales/marketing_campaign/marketing_campaign.service");

function client() {
  return {
    query: jest.fn(async (sql) => {
      if (String(sql).startsWith("SAVEPOINT")) {
        const error = new Error("not in transaction");
        error.code = "25P01";
        throw error;
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}
const verbs = (c) => c.query.mock.calls.map(([sql]) => String(sql).trim().toUpperCase());

beforeEach(() => {
  jest.clearAllMocks();
  quote.resolveEntityId.mockResolvedValue("entity-1");
  lead.create.mockResolvedValue({ lead_id: "lead-1" });
  quote.create.mockResolvedValue({ quote_request_id: "quote-1", public_ref: "QR-1" });
  emit.emitEvent.mockResolvedValue(undefined);
  emit.audit.mockResolvedValue(undefined);
});

describe("F13 public quote composition", () => {
  const body = {
    requester_name: "Ada N.",
    requester_company: "Ada Trading",
    requester_email: "ada@example.com",
    requester_phone: "+2348000000000",
    service_category: "SEA",
    origin_location: "Lagos",
    destination_location: "Douala",
    cargo_description: "Machinery",
    incoterm: "CIF",
  };

  test("creates a WEBSITE lead and linked quote under the same resolved entity", async () => {
    const c = client();
    await expect(publicIntake.submitQuote(c, body)).resolves.toEqual({ received: true, reference: "QR-1" });
    expect(quote.resolveEntityId).toHaveBeenCalledTimes(1);
    expect(lead.create).toHaveBeenCalledWith(c, expect.objectContaining({
      data: expect.objectContaining({
        entity_id: "entity-1",
        company_name: "Ada Trading",
        contact_name: "Ada N.",
        source: "WEBSITE",
        intake_channel: "WEBSITE",
      }),
    }));
    expect(quote.create).toHaveBeenCalledWith(c, expect.objectContaining({
      data: expect.objectContaining({
        entity_id: "entity-1",
        lead_id: "lead-1",
        intake_channel: "WEBSITE",
      }),
    }));
    expect(verbs(c)).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
    expect(verbs(c)).not.toContain("ROLLBACK");
  });

  test("rolls the lead back when linked quote creation fails", async () => {
    quote.create.mockRejectedValueOnce(new Error("quote insert failed"));
    const c = client();
    await expect(publicIntake.submitQuote(c, body)).rejects.toThrow("quote insert failed");
    expect(lead.create).toHaveBeenCalledTimes(1);
    expect(verbs(c)).toContain("ROLLBACK");
    expect(verbs(c)).not.toContain("COMMIT");
  });
});

describe("F13 intake persistence and event atomicity", () => {
  test("contact enquiry rolls back when event emission fails", async () => {
    inboundRepo.insertEnquiry.mockResolvedValue({ contact_enquiry_id: "enquiry-1" });
    emit.emitEvent.mockRejectedValueOnce(new Error("event failed"));
    const c = client();
    await expect(inbound.submitEnquiry(c, { data: { message: "Hello" }, actor: {} }))
      .rejects.toThrow("event failed");
    expect(inboundRepo.insertEnquiry).toHaveBeenCalledTimes(1);
    expect(verbs(c)).toContain("ROLLBACK");
    expect(verbs(c)).not.toContain("COMMIT");
  });

  test("newsletter upsert rolls back when event emission fails", async () => {
    campaignRepo.subscribe.mockResolvedValue({ email: "ada@example.com" });
    emit.emitEvent.mockRejectedValueOnce(new Error("event failed"));
    const c = client();
    await expect(campaign.subscribe(c, { email: "ada@example.com", actor: {} }))
      .rejects.toThrow("event failed");
    expect(campaignRepo.subscribe).toHaveBeenCalledTimes(1);
    expect(verbs(c)).toContain("ROLLBACK");
    expect(verbs(c)).not.toContain("COMMIT");
  });
});
