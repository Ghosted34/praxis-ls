"use strict";

/**
 * A client's account manager (client portal PR 3, 14200).
 *
 *   1. Read: who looks after the client, named as the team knows them (the
 *      employee's name before the login's), and whether a message can still
 *      reach them.
 *   2. Named: only an ACTIVE login — anyone else is a message that goes
 *      nowhere while the screen says the client is looked after.
 *   3. Audited, and the new manager told — unless they named themselves, and
 *      never at the cost of the assignment.
 *
 * The SQL itself runs against a real schema in
 * tests/integration/client-inbox.test.js.
 */

let mockNotified = [];
let mockNotifyFails = false;
let mockAudits = [];
let mockWarned = [];

jest.mock("../../src/modules/notification/notification.service", () => ({
  notify: async (c, n) => {
    if (mockNotifyFails) throw new Error("push service down");
    mockNotified.push(n);
    return { notification_id: "n1" };
  },
}));
jest.mock("../../src/shared/events/emit", () => ({
  audit: async (c, a) => {
    mockAudits.push(a);
  },
  resolveActorId: async (c, id) => id || null,
}));
jest.mock("../../src/config/logger", () => ({
  logger: { warn: (o, m) => mockWarned.push(m), info: () => {}, error: () => {}, debug: () => {} },
}));

const accountManager = require("../../src/modules/master/client_master/account_manager.service");

const USERS = {
  awa: { user_id: "awa", full_name: "awa.login", email: "awa@praxis.test", status: "ACTIVE", employee_id: "e-awa", employee_name: "Awa Ndiaye", job_title: "Key account manager" },
  paul: { user_id: "paul", full_name: "Paul Mbida", email: "paul@praxis.test", status: "ACTIVE", employee_id: null, employee_name: null, job_title: null },
  gone: { user_id: "gone", full_name: "Left Last Year", email: "gone@praxis.test", status: "SUSPENDED", employee_id: null, employee_name: null, job_title: null },
};

let clients;
let updates;

/** A client that answers the service's three statements from `clients` and `USERS`. */
const db = {
  query: async (text, params) => {
    // The transaction's own statements (shared/db/tx): nothing to answer.
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(text)) return { rows: [] };
    if (/FROM client_master cm/.test(text)) {
      const row = clients[params[0]];
      if (!row) return { rows: [] };
      const m = row.manager ? USERS[row.manager] : null;
      return {
        rows: [{
          client_id: params[0], client_name: row.name, user_id: row.manager || null,
          user_name: m && m.full_name, email: m && m.email, status: m && m.status,
          employee_id: m && m.employee_id, employee_name: m && m.employee_name, job_title: m && m.job_title,
        }],
      };
    }
    if (/FROM app_user WHERE user_id/.test(text)) {
      const m = USERS[params[0]];
      return { rows: m ? [{ user_id: m.user_id, full_name: m.full_name, status: m.status }] : [] };
    }
    if (/UPDATE client_master SET relationship_manager_user_id/.test(text)) {
      updates.push(params);
      clients[params[0]].manager = params[1];
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  },
};

beforeEach(() => {
  mockNotified = [];
  mockNotifyFails = false;
  mockAudits = [];
  mockWarned = [];
  updates = [];
  clients = {
    acme: { name: "Acme Trading", manager: "awa" },
    bois: { name: "Bois du Sud", manager: null },
    cacao: { name: "Cacao Export", manager: "gone" },
  };
});

describe("reading", () => {
  it("names the manager as the team knows them, with their job", async () => {
    expect(await accountManager.get(db, { clientId: "acme" })).toEqual({
      client_id: "acme",
      manager: { user_id: "awa", name: "Awa Ndiaye", job_title: "Key account manager", email: "awa@praxis.test", employee_id: "e-awa", reachable: true },
    });
  });

  it("falls back to the login's name, and says when they can no longer be reached", async () => {
    clients.acme.manager = "paul";
    expect((await accountManager.get(db, { clientId: "acme" })).manager).toMatchObject({ name: "Paul Mbida", reachable: true });
    expect((await accountManager.get(db, { clientId: "cacao" })).manager).toMatchObject({ user_id: "gone", reachable: false });
  });

  it("says nobody when nobody is named, and not found for a client that is not there", async () => {
    expect(await accountManager.get(db, { clientId: "bois" })).toEqual({ client_id: "bois", manager: null });
    await expect(accountManager.get(db, { clientId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("naming one", () => {
  it("refuses a login that is not active, or not there", async () => {
    for (const userId of ["gone", "ghost"]) {
      await expect(accountManager.set(db, { clientId: "bois", userId, actor: { user_id: "paul" } }))
        .rejects.toMatchObject({ code: "ACCOUNT_MANAGER_INACTIVE", status: 422 });
    }
    expect(updates).toEqual([]);
    expect(mockAudits).toEqual([]);
  });

  it("writes it, audits who named whom, and tells them where the client's messages are", async () => {
    const out = await accountManager.set(db, { clientId: "bois", userId: "awa", actor: { user_id: "paul" } });
    expect(updates).toEqual([["bois", "awa"]]);
    expect(mockAudits).toEqual([expect.objectContaining({
      actorUserId: "paul", action: "client.account_manager_set", moduleKey: "MOD-03", entityRef: "client:bois",
      before: { user_id: null }, after: { user_id: "awa" },
    })]);
    expect(mockNotified).toEqual([expect.objectContaining({
      userId: "awa", category: "comms", eventTypeKey: "client.account_manager_assigned",
      title: "You look after Bois du Sud", url: "/comms/clients?client=bois",
    })]);
    expect(out.manager).toMatchObject({ user_id: "awa", name: "Awa Ndiaye", reachable: true });
  });

  it("does nothing at all when nothing changes", async () => {
    await accountManager.set(db, { clientId: "acme", userId: "awa", actor: { user_id: "paul" } });
    expect(updates).toEqual([]);
    expect(mockAudits).toEqual([]);
    expect(mockNotified).toEqual([]);
  });

  it("does not tell someone who named themselves", async () => {
    await accountManager.set(db, { clientId: "bois", userId: "paul", actor: { user_id: "paul" } });
    expect(updates).toEqual([["bois", "paul"]]);
    expect(mockNotified).toEqual([]);
  });

  it("keeps the assignment when the notice cannot be sent", async () => {
    mockNotifyFails = true;
    const out = await accountManager.set(db, { clientId: "bois", userId: "awa", actor: { user_id: "paul" } });
    expect(out.manager).toMatchObject({ user_id: "awa" });
    expect(mockAudits).toHaveLength(1);
    expect(mockWarned).toEqual(["account manager: assignment notice not sent"]);
  });

  it("clears it with null — audited, and nobody to tell", async () => {
    const out = await accountManager.set(db, { clientId: "cacao", userId: null, actor: { user_id: "paul" } });
    expect(out).toEqual({ client_id: "cacao", manager: null });
    expect(updates).toEqual([["cacao", null]]);
    expect(mockAudits[0]).toMatchObject({ before: { user_id: "gone" }, after: { user_id: null } });
    expect(mockNotified).toEqual([]);
  });
});
