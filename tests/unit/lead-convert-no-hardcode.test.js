"use strict";
/**
 * F6 anti-hardcode proof — the lead convert path must NEVER silently default
 * client_type or payment_terms_days. The legacy hard-coded 'BOTH' / 30 days
 * regardless of input; F6 rejects the call instead.
 *
 * This test mocks the `clientMaster.create` dependency and exercises the
 * service's branching. It does NOT need a real database.
 */

const path = require("path");

// Resolve the lead service with a stubbed clientMaster dependency.
const TYPE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SERVICE_PATH = path.resolve(__dirname, "../../src/modules/sales/lead/lead.service.js");
const REPO_PATH = path.resolve(__dirname, "../../src/modules/sales/lead/lead.repo.js");
const EVENTS_PATH = path.resolve(__dirname, "../../src/modules/sales/lead/lead.events.js");
const CLIENT_MASTER_PATH = path.resolve(__dirname, "../../src/modules/master/client_master/client_master.service.js");
const EMIT_PATH = path.resolve(__dirname, "../../src/shared/events/emit.js");

// Build a fake repository + events + emit module, then require the service
// fresh with all stubs in place. We do this through jest.doMock so the module
// graph is wired by the same loader jest uses for the rest of the suite.
jest.doMock(REPO_PATH, () => ({
  get: jest.fn(),
  update: jest.fn(),
  // Added with the column fix: the convert path resolves the client_type CODE
  // to its FK and stamps the corporate entity, because `client_master` has
  // `client_type_id` and no `client_type`, and allocates the client's own
  // reference only when `entity_id` is present. Both are repo reads, so the
  // stub has to answer them or this suite tests a path that no longer exists.
  clientTypeIdByCode: jest.fn(async () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  defaultEntityId: jest.fn(async () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
}));
jest.doMock(EVENTS_PATH, () => ({
  MODULE: "MOD-20",
  CREATED: "lead.created",
  UPDATED: "lead.updated",
  CONVERTED: "lead.converted",
  transition: (s) => "lead." + String(s).toLowerCase(),
}));
jest.doMock(CLIENT_MASTER_PATH, () => ({
  create: jest.fn(),
}));
jest.doMock(EMIT_PATH, () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
  audit: jest.fn().mockResolvedValue(undefined),
}));

const repo = require(REPO_PATH);
const clientMaster = require(CLIENT_MASTER_PATH);
const service = require(SERVICE_PATH);

function makeClient() {
  return {
    query: jest.fn().mockImplementation(async (sql) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe("lead.service.convert — F6 anti-hardcode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects when client_type is missing and lead has no hint", async () => {
    repo.get.mockResolvedValue({
      lead_id: "L1", status: "QUALIFIED", company_name: "Acme",
      contact_name: null, email: null, phone: null, country: "CM",
      address: null, niu: null, rccm: null, client_type_hint: null, payment_terms_days: null,
    });
    const c = makeClient();
    await expect(service.convert(c, { id: "L1", clientData: { payment_terms_days: 30 } }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(clientMaster.create).not.toHaveBeenCalled();
  });

  test("rejects when payment_terms_days is missing and lead has no hint", async () => {
    repo.get.mockResolvedValue({
      lead_id: "L1", status: "QUALIFIED", company_name: "Acme",
      contact_name: null, email: null, phone: null, country: "CM",
      address: null, niu: null, rccm: null, client_type_hint: "BOTH", payment_terms_days: null,
    });
    const c = makeClient();
    await expect(service.convert(c, { id: "L1", clientData: { client_type: "BOTH" } }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(clientMaster.create).not.toHaveBeenCalled();
  });

  test("passes staff-supplied client_type and payment_terms_days through to clientMaster.create", async () => {
    repo.get.mockResolvedValue({
      lead_id: "L1", status: "QUALIFIED", company_name: "Acme",
      contact_name: "Jane", email: "j@acme.cm", phone: "+237650000000",
      country: "CM", address: "Akwa", niu: "M12345", rccm: "RC12345",
      client_type_hint: null, payment_terms_days: null,
    });
    clientMaster.create.mockResolvedValue({ client_id: "C1" });
    repo.update.mockResolvedValue({ lead_id: "L1", status: "CONVERTED", client_id: "C1" });
    const c = makeClient();
    const out = await service.convert(c, {
      id: "L1",
      clientData: { client_type: "SHIPPER", payment_terms_days: 45, name: "Acme SARL" },
    });
    expect(out.client_id).toBe("C1");
    expect(out.client_type).toBe("SHIPPER");
    expect(out.payment_terms_days).toBe(45);
    expect(clientMaster.create).toHaveBeenCalledTimes(1);
    const arg = clientMaster.create.mock.calls[0][1].data;
    // The CODE is what the caller supplies and what the service reports back;
    // what reaches client_master is the FK, because that table has
    // `client_type_id` and no `client_type` column. Asserting the code here
    // would re-assert the 42703 this suite's sibling
    // (lead-convert-client-columns.test.js) exists to prevent.
    expect(arg).not.toHaveProperty("client_type");
    expect(arg.client_type_id).toBe(TYPE_ID);
    expect(arg.payment_terms_days).toBe(45);
    // Registrations built from lead NIU/RCCM.
    expect(arg.registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "NIU", number: "M12345" }),
      expect.objectContaining({ kind: "RCCM", number: "RC12345" }),
    ]));
  });

  test("falls back to the lead's hint columns when the request omits the field", async () => {
    repo.get.mockResolvedValue({
      lead_id: "L1", status: "QUALIFIED", company_name: "Acme",
      contact_name: null, email: null, phone: null, country: "CM",
      address: null, niu: null, rccm: null,
      client_type_hint: "CONSIGNEE", payment_terms_days: 60,
    });
    clientMaster.create.mockResolvedValue({ client_id: "C2" });
    repo.update.mockResolvedValue({ lead_id: "L1", status: "CONVERTED", client_id: "C2" });
    const c = makeClient();
    const out = await service.convert(c, { id: "L1", clientData: { client_type: "CONSIGNEE", payment_terms_days: 60 } });
    expect(out.client_type).toBe("CONSIGNEE");
    expect(out.payment_terms_days).toBe(60);
  });

  test("request wins over the lead's hint (the explicit UI choice is the source of truth)", async () => {
    repo.get.mockResolvedValue({
      lead_id: "L1", status: "QUALIFIED", company_name: "Acme",
      contact_name: null, email: null, phone: null, country: "CM",
      address: null, niu: null, rccm: null,
      client_type_hint: "BOTH", payment_terms_days: 30,
    });
    clientMaster.create.mockResolvedValue({ client_id: "C3" });
    repo.update.mockResolvedValue({ lead_id: "L1", status: "CONVERTED", client_id: "C3" });
    const c = makeClient();
    const out = await service.convert(c, { id: "L1", clientData: { client_type: "SHIPPER", payment_terms_days: 14 } });
    expect(out.client_type).toBe("SHIPPER");
    expect(out.payment_terms_days).toBe(14);
  });

  test("refuses to convert a non-QUALIFIED lead", async () => {
    repo.get.mockResolvedValue({
      lead_id: "L1", status: "NEW", company_name: "Acme",
      client_type_hint: "BOTH", payment_terms_days: 30,
    });
    const c = makeClient();
    await expect(service.convert(c, { id: "L1", clientData: { client_type: "BOTH", payment_terms_days: 30 } }))
      .rejects.toMatchObject({ code: "NOT_QUALIFIED" });
    expect(clientMaster.create).not.toHaveBeenCalled();
  });
});
