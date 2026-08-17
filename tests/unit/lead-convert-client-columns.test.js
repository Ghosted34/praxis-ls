"use strict";
/**
 * F6 — a converted lead must produce a client Finance does not have to
 * complete. This suite guards the half of that which a mock cannot see.
 *
 * WHY IT EXISTS. `lead-convert-no-hardcode.test.js` proves the service refuses
 * to invent a client type or payment terms. It mocks `clientMaster.create`, so
 * it says nothing about whether the payload handed over can actually be
 * written — and it could not be. The convert path passed `client_type` and
 * `phone`, `client_master` has neither column (it has `client_type_id`, and no
 * phone at all), and `insertOne` is called with a null allow-list, which puts
 * every key straight into the INSERT column list. Postgres answered 42703 and
 * conversion failed for every lead, with a green test suite.
 *
 * So the column list is read out of the MIGRATIONS rather than hand-copied
 * here. A future field added to the convert payload without a migration fails
 * this test instead of failing in production.
 */
const fs = require("fs");
const path = require("path");

const MIGRATIONS = path.resolve(__dirname, "../../migrations/tenant");

/** Every column `client_master` actually has, per the migration set. */
function clientMasterColumns() {
  const cols = new Set();
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8")
      // Drop commented-out lines so a `-- DOWN` block's DDL is not read as real.
      .split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

    const create = /CREATE TABLE (?:IF NOT EXISTS )?client_master\s*\(([\s\S]*?)\n\);/i.exec(sql);
    if (create) {
      for (const line of create[1].split("\n")) {
        const m = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
        if (m && !/^(constraint|primary|unique|check|foreign)$/i.test(m[1])) cols.add(m[1].toLowerCase());
      }
    }
    const alterRe = /ALTER TABLE\s+client_master\b([\s\S]*?);/gi;
    let a;
    while ((a = alterRe.exec(sql)) !== null) {
      const addRe = /ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi;
      let c;
      while ((c = addRe.exec(a[1])) !== null) cols.add(c[1].toLowerCase());
    }
  }
  return cols;
}

const COLUMNS = clientMasterColumns();

/** Keys the client_master service pulls out before the master insert. */
const CHILD_BLOCKS = new Set(["registrations", "primary_contact", "primary_address"]);

describe("the client_master column list this test reads", () => {
  test("was actually parsed — a broken parser must fail loudly, not pass everything", () => {
    expect(COLUMNS.size).toBeGreaterThan(20);
    for (const known of ["client_id", "name", "client_type_id", "payment_terms_days", "entity_id", "address", "email", "legal_name"]) {
      expect(COLUMNS.has(known)).toBe(true);
    }
  });

  test("the two columns the convert path invented do not exist", () => {
    expect(COLUMNS.has("client_type")).toBe(false);
    expect(COLUMNS.has("phone")).toBe(false);
  });
});

/*
 * The stubs are registered at MODULE level and the service is required once,
 * exactly as tests/unit/lead-convert-no-hardcode.test.js does. Registering them
 * inside `beforeEach` alongside `jest.resetModules()` re-runs each mock factory
 * per test, so the assertions read a different jest.fn instance from the one
 * the service called — which reads as "create was never called" and is a
 * property of the harness, not of the code under test.
 */
const REPO_PATH = require.resolve("../../src/modules/sales/lead/lead.repo");
const CLIENT_MASTER_PATH = require.resolve("../../src/modules/master/client_master/client_master.service");
const EMIT_PATH = require.resolve("../../src/shared/events/emit");

const TYPE_ID = "33333333-3333-4333-8333-333333333333";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "11111111-1111-4111-8111-111111111111";

jest.doMock(REPO_PATH, () => ({
  get: jest.fn(),
  update: jest.fn(),
  insert: jest.fn(),
  list: jest.fn(),
  clientTypeIdByCode: jest.fn(),
  defaultEntityId: jest.fn(),
}));
jest.doMock(CLIENT_MASTER_PATH, () => ({ create: jest.fn() }));
jest.doMock(EMIT_PATH, () => ({
  emitEvent: jest.fn(),
  audit: jest.fn(),
  resolveActorId: async (_c, id) => id || null,
}));

const repo = require(REPO_PATH);
const clientMaster = require(CLIENT_MASTER_PATH);
const emit = require(EMIT_PATH);
const service = require("../../src/modules/sales/lead/lead.service");

describe("lead convert -> client_master payload", () => {
  const client = { query: jest.fn() };
  // `clientMaster.create(client, { data, actor })` — TWO arguments. calls[0][0]
  // is the tenant client; the payload is calls[0][1].data. Reading [0][0].data
  // returns undefined, which fails as "create was never called" and sends you
  // hunting a mock-wiring problem that is not there.
  const payload = () => {
    expect(clientMaster.create).toHaveBeenCalled();
    return clientMaster.create.mock.calls[0][1].data;
  };

  beforeEach(() => {
    client.query.mockImplementation(async (sql) => {
      if (/^\s*SAVEPOINT\b/i.test(String(sql))) throw Object.assign(new Error("no transaction"), { code: "25P01" });
      return { rows: [] };
    });
    emit.emitEvent.mockResolvedValue(undefined);
    emit.audit.mockResolvedValue(undefined);
    clientMaster.create.mockResolvedValue({ client_id: "client-1" });
    repo.update.mockImplementation(async (_c, id, f) => ({ lead_id: id, ...f }));
    repo.clientTypeIdByCode.mockImplementation(async (_c, code) => (code === "BOTH" ? TYPE_ID : null));
    repo.defaultEntityId.mockResolvedValue(ENTITY);
    repo.get.mockResolvedValue({
      lead_id: LEAD_ID, status: "QUALIFIED", company_name: "Sahel Traders",
      contact_name: "A. Njoya", email: "a@sahel.cm", phone: "+237600000000",
      country: "CM", address: "Bonanjo, Douala", niu: "M0123", rccm: "RC/DLA/2020/B/999",
      client_type_hint: "BOTH", payment_terms_days: 45, entity_id: null,
    });
  });

  test("every key handed to client_master is a real column or a child block", async () => {
    await service.convert(client, { id: LEAD_ID, clientData: {}, actor: {} });
    const unknown = Object.keys(payload()).filter((k) => !COLUMNS.has(k) && !CHILD_BLOCKS.has(k));
    expect(unknown).toEqual([]);
  });

  test("the client type arrives as the FK, never as the code", async () => {
    await service.convert(client, { id: LEAD_ID, clientData: {}, actor: {} });
    expect(payload().client_type_id).toBe(TYPE_ID);
    expect(payload()).not.toHaveProperty("client_type");
  });

  test("a code the tenant has not configured is refused, not written as null", async () => {
    await expect(service.convert(client, { id: LEAD_ID, clientData: { client_type: "CARRIER", payment_terms_days: 30 }, actor: {} }))
      .rejects.toMatchObject({ code: "UNKNOWN_CLIENT_TYPE", status: 422 });
    expect(clientMaster.create).not.toHaveBeenCalled();
  });

  test("the phone is kept - on the primary contact, where there IS a column for it", async () => {
    await service.convert(client, { id: LEAD_ID, clientData: {}, actor: {} });
    expect(payload()).not.toHaveProperty("phone");
    expect(payload().primary_contact).toMatchObject({ name: "A. Njoya", phone: "+237600000000" });
  });

  test("the entity is stamped, so the client gets its own reference number", async () => {
    await service.convert(client, { id: LEAD_ID, clientData: {}, actor: {} });
    // client_master.service allocates `ref` only when entity_id is present.
    expect(payload().entity_id).toBe(ENTITY);
  });

  test("a multi-entity tenant is asked which company the client belongs to", async () => {
    repo.defaultEntityId.mockResolvedValue(null);
    await expect(service.convert(client, { id: LEAD_ID, clientData: {}, actor: {} }))
      .rejects.toMatchObject({ code: "ENTITY_REQUIRED", status: 422 });
  });

  test("NIU and RCCM travel as registrations, so Finance does not re-key them", async () => {
    await service.convert(client, { id: LEAD_ID, clientData: {}, actor: {} });
    expect(payload().registrations).toEqual([
      { country_code: "CM", kind: "NIU", number: "M0123" },
      { country_code: "CM", kind: "RCCM", number: "RC/DLA/2020/B/999" },
    ]);
  });

  test("the conversion is one transaction", async () => {
    clientMaster.create.mockRejectedValueOnce(new Error("nope"));
    await expect(service.convert(client, { id: LEAD_ID, clientData: {}, actor: {} })).rejects.toThrow("nope");
    const verbs = client.query.mock.calls.map((c) => String(c[0]).trim().toUpperCase());
    expect(verbs).toContain("BEGIN");
    expect(verbs).toContain("ROLLBACK");
  });
});
