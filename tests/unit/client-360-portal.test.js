"use strict";

/**
 * A client's portal, managed from the client's own record (Client 360 →
 * Portal), and the portal settings every client shares (the Clients screen's ⚙).
 *
 *   1. Who manages it: the client portal's grant (MOD-29), on routes that exist
 *      only while the client portal is switched on — never the IAM grant the
 *      investor and auditor portals keep.
 *   2. What a new person gets: the tenant's invite defaults (scope, and whether
 *      the first person becomes the client's admin), unless staff choose.
 *   3. Nobody is silently moved between companies, and the refusal says which.
 *   4. A person is only ever changed, resent or removed through the client it
 *      belongs to.
 *   5. The onboarding template names its own keys and keeps its order.
 *   6. The sign-in state staff read on each row.
 */

jest.mock("../../src/middleware/rbac", () => {
  const actual = jest.requireActual("../../src/middleware/rbac");
  const tagged = (gate) => Object.assign((_req, _res, next) => next(), { gate });
  return {
    ...actual,
    requirePermission: (module, action) => tagged([[module, action]]),
    requireAnyPermission: (pairs) => tagged(pairs),
  };
});
jest.mock("../../src/middleware/feature-gate", () => ({
  requireFeature: (key) => Object.assign((_req, _res, next) => next(), { feature: key }),
}));
jest.mock("rate-limit-redis", () => {
  const { MemoryStore } = jest.requireActual("express-rate-limit");
  return {
    RedisStore: class {
      constructor() { this.m = new MemoryStore(); }
      init(o) { this.m.init(o); }
      increment(k) { return this.m.increment(k); }
      decrement(k) { return this.m.decrement(k); }
      resetKey(k) { return this.m.resetKey(k); }
    },
  };
});
jest.mock("../../src/config/redis", () => ({ getClient: () => ({ call: jest.fn() }) }));

let mockRepo;
let mockEvents = [];
let mockAudits = [];
jest.mock("../../src/modules/portal/portal.repo", () => new Proxy({}, {
  get: (_t, name) => (...args) => {
    if (!mockRepo[name]) throw new Error(`repo.${String(name)} not mocked`);
    return mockRepo[name](...args);
  },
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async (c, e) => { mockEvents.push(e); },
  audit: async (c, a) => { mockAudits.push(a); },
  resolveActorId: async (c, id) => id || null,
}));

const rules = require("../../src/modules/portal/portal.rules");
const admin = require("../../src/modules/portal/portal_admin.service");

const c = {};
const CLIENT = "0b8a3f4e-5d6c-4b7a-8e9f-102132435465";
const OTHER = "1c9b4a5f-6e7d-4c8b-9f0a-213243546576";
const GRANT = "2d0c5b6a-7f8e-4d9c-8a1b-324354657687";
const actor = { user_id: "u-1" };

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
  mockRepo = {};
});

describe("who manages a client's portal", () => {
  const router = require("../../src/modules/portal_auth/portal_auth.routes").router;
  const layerOf = (method, path) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    if (!layer) throw new Error(`no ${method.toUpperCase()} ${path}`);
    return layer.route.stack.map((s) => s.handle);
  };

  test.each([
    ["get", "/clients/:clientId/people", "view"],
    ["post", "/clients/:clientId/people", "create"],
    ["post", "/clients/:clientId/people/:id", "edit"],
    ["post", "/clients/:clientId/people/:id/invite", "edit"],
    ["post", "/clients/:clientId/people/:id/revoke", "edit"],
    ["get", "/clients/:clientId/onboarding", "view"],
    ["post", "/clients/:clientId/onboarding/:stepKey", "edit"],
    ["get", "/settings", "view"],
    ["post", "/settings/invite-defaults", "edit"],
    ["post", "/settings/onboarding-steps", "edit"],
    ["post", "/settings/onboarding-steps/:stepKey", "edit"],
    ["post", "/settings/onboarding-steps/:stepKey/move", "edit"],
  ])("%s %s needs the client portal's grant (%s), with the client portal switched on", (method, path, action) => {
    const handles = layerOf(method, path);
    expect(handles.map((h) => h.gate).filter(Boolean)).toEqual([[["MOD-29", action]]]);
    expect(handles.map((h) => h.feature).filter(Boolean)).toEqual(["portal.client"]);
  });

  it("leaves the investor and auditor portals on the IAM grant", () => {
    const portals = require("../../src/modules/portal/portal.routes").router;
    const grant = portals.stack.find((l) => l.route && l.route.path === "/access" && l.route.methods.post);
    expect(grant.route.stack.map((s) => s.handle.gate).filter(Boolean)).toEqual([[["MOD-67", "edit"]]]);
  });
});

describe("the tenant's invite defaults", () => {
  it("read anything missing as the portal's behaviour before the setting existed", () => {
    expect(rules.normalizeInviteDefaults(null)).toEqual({ access_scope: "ALL", first_is_admin: true });
    expect(rules.normalizeInviteDefaults({ access_scope: "NOPE", first_is_admin: "yes" })).toEqual({ access_scope: "ALL", first_is_admin: true });
    expect(rules.normalizeInviteDefaults({ access_scope: "BILLING", first_is_admin: false })).toEqual({ access_scope: "BILLING", first_is_admin: false });
  });

  it("make the first person the admin only while the tenant wants that — and staff can always choose", () => {
    const on = { first_is_admin: true };
    const off = { first_is_admin: false };
    expect(rules.resolveClientAdmin({ explicit: null, existingGrants: 0, defaults: on })).toBe(true);
    expect(rules.resolveClientAdmin({ explicit: null, existingGrants: 1, defaults: on })).toBe(false);
    expect(rules.resolveClientAdmin({ explicit: null, existingGrants: 0, defaults: off })).toBe(false);
    expect(rules.resolveClientAdmin({ explicit: true, existingGrants: 3, defaults: off })).toBe(true);
    expect(rules.resolveClientAdmin({ explicit: false, existingGrants: 0, defaults: on })).toBe(false);
  });

  it("are saved normalised and audited with what they replaced", async () => {
    let saved;
    mockRepo.portalSetting = async () => ({ access_scope: "ALL", first_is_admin: true });
    mockRepo.savePortalSetting = async (_c, key, value) => { saved = { key, value }; };
    const out = await admin.saveInviteDefaults(c, { accessScope: "OPERATIONS", firstIsAdmin: false, actor });
    expect(out).toEqual({ access_scope: "OPERATIONS", first_is_admin: false });
    expect(saved).toEqual({ key: "client_invite_defaults", value: out });
    expect(mockAudits[0]).toMatchObject({ action: "portal.invite_defaults_changed", before: { access_scope: "ALL" }, after: out });
  });
});

describe("giving someone at a client access", () => {
  let inserted;
  beforeEach(() => {
    inserted = null;
    mockRepo.liveClientGrantFor = async () => null;
    mockRepo.portalSetting = async () => ({ access_scope: "OPERATIONS", first_is_admin: true });
    mockRepo.clientGrants = async () => [];
    mockRepo.insertAccess = async (_c, row) => { inserted = row; return { portal_access_id: GRANT, ...row }; };
    mockRepo.clientGrant = async () => ({ portal_access_id: GRANT, email: inserted.subject_email, client_id: CLIENT });
  });

  it("takes the tenant's defaults: their scope, and admin for the client's first person", async () => {
    await admin.addPerson(c, { clientId: CLIENT, email: " Ama@Client.CM ", actor });
    expect(inserted).toMatchObject({
      portal: "CLIENT", subject_email: "ama@client.cm", client_id: CLIENT, access_scope: "OPERATIONS", is_client_admin: true,
    });
    expect(mockEvents[0]).toMatchObject({ eventTypeKey: "portal.access_granted", entityRef: "portal_access:" + GRANT });
    expect(mockAudits[0]).toMatchObject({ action: "portal.access_granted" });
  });

  it("the second person is not made admin unless staff say so", async () => {
    mockRepo.clientGrants = async () => [{ portal_access_id: "g-0" }];
    await admin.addPerson(c, { clientId: CLIENT, email: "kofi@client.cm", accessScope: "BILLING", actor });
    expect(inserted).toMatchObject({ access_scope: "BILLING", is_client_admin: false });
    await admin.addPerson(c, { clientId: CLIENT, email: "esi@client.cm", isClientAdmin: true, actor });
    expect(inserted).toMatchObject({ is_client_admin: true });
  });

  it("refuses someone already on this client", async () => {
    mockRepo.liveClientGrantFor = async () => ({ client_id: CLIENT, client_name: "Acme" });
    const e = await rejection(admin.addPerson(c, { clientId: CLIENT, email: "ama@client.cm", actor }));
    expect(e).toMatchObject({ code: "ALREADY_HAS_ACCESS", status: 409 });
  });

  it("never silently moves a person from another company, and names it", async () => {
    mockRepo.liveClientGrantFor = async () => ({ client_id: OTHER, client_name: "Globex Sarl" });
    const e = await rejection(admin.addPerson(c, { clientId: CLIENT, email: "ama@client.cm", actor }));
    expect(e).toMatchObject({ code: "OTHER_COMPANY", status: 409 });
    expect(e.message).toMatch(/Globex Sarl/);
    expect(inserted).toBeNull();
  });
});

describe("changing, resending or removing a person — only through their own client", () => {
  it("a grant of another client is NOT_FOUND, not changed", async () => {
    mockRepo.clientGrant = async (_c, clientId) => (clientId === OTHER ? { portal_access_id: GRANT } : null);
    const e = await rejection(admin.updatePerson(c, { clientId: CLIENT, grantId: GRANT, accessScope: "BILLING", actor }));
    expect(e).toMatchObject({ code: "NOT_FOUND", status: 404 });
    const r = await rejection(admin.personFor(c, { clientId: CLIENT, grantId: GRANT }));
    expect(r).toMatchObject({ status: 404 });
  });

  it("the last day of access is only touched when it is sent — null clears it", async () => {
    const calls = [];
    mockRepo.clientGrant = async () => ({ portal_access_id: GRANT });
    mockRepo.updateClientGrant = async (_c, args) => { calls.push(args); return { portal_access_id: GRANT }; };
    await admin.updatePerson(c, { clientId: CLIENT, grantId: GRANT, accessScope: "ALL", actor });
    await admin.updatePerson(c, { clientId: CLIENT, grantId: GRANT, expiresAt: null, actor });
    expect(calls[0]).toMatchObject({ setExpiry: false });
    expect(calls[1]).toMatchObject({ setExpiry: true, expiresAt: null });
  });

  it("removing access is an event and an audit, with the address it was for", async () => {
    mockRepo.revokeClientGrant = async () => ({ portal_access_id: GRANT, email: "ama@client.cm" });
    expect(await admin.revokePerson(c, { clientId: CLIENT, grantId: GRANT, actor })).toEqual({ revoked: true, email: "ama@client.cm" });
    expect(mockEvents[0]).toMatchObject({ eventTypeKey: "portal.access_revoked" });
  });
});

describe("the onboarding checklist every client starts from", () => {
  it("names a new step's key from its wording — accents and punctuation included", () => {
    expect(admin.keyFrom("Customs mandate signed")).toBe("CUSTOMS_MANDATE_SIGNED");
    expect(admin.keyFrom("Données bancaires reçues !")).toBe("DONNEES_BANCAIRES_RECUES");
    expect(admin.keyFrom("2nd visit")).toBe("ND_VISIT");
  });

  it("a second step with the same name gets its own key rather than a refusal", async () => {
    const taken = new Set(["INSURANCE"]);
    mockRepo.nextTemplateSort = async () => 50;
    mockRepo.insertTemplateStep = async (_c, row) => {
      if (taken.has(row.stepKey)) return null;
      return { step_key: row.stepKey, label_en: row.labelEn, label_fr: row.labelFr, sort_order: row.sortOrder };
    };
    const row = await admin.createOnboardingStep(c, { labelEn: "Insurance", actor });
    expect(row).toMatchObject({ step_key: "INSURANCE_2", label_fr: "Insurance", sort_order: 50 });
  });

  it("refuses a name with nothing to key it by", async () => {
    const e = await rejection(admin.createOnboardingStep(c, { labelEn: "!!", actor }));
    expect(e).toMatchObject({ code: "BAD_STEP", status: 422 });
  });

  it("moving a step swaps it with its neighbour and renumbers the list", async () => {
    let rows = [
      { step_key: "A", sort_order: 10, is_active: true },
      { step_key: "B", sort_order: 10, is_active: true },
      { step_key: "C", sort_order: 30, is_active: true },
      { step_key: "OFF", sort_order: 5, is_active: false },
    ];
    mockRepo.onboardingTemplate = async () => [...rows].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.sort_order - b.sort_order);
    mockRepo.updateTemplateStep = async (_c, key, { sortOrder }) => {
      rows = rows.map((r) => (r.step_key === key ? { ...r, sort_order: sortOrder } : r));
    };
    await admin.moveOnboardingStep(c, { stepKey: "C", direction: "up", actor });
    const order = rows.filter((r) => r.is_active).sort((a, b) => a.sort_order - b.sort_order).map((r) => r.step_key);
    expect(order).toEqual(["A", "C", "B"]);
    expect(rows.find((r) => r.step_key === "OFF").sort_order).toBe(5);
  });
});

describe("where a person stands on signing in", () => {
  const { signInState } = require("../../src/modules/portal/portal_client.controller");
  const now = Date.parse("2026-09-29T10:00:00Z");

  it("reads the login and its newest link", () => {
    expect(signInState(null, null, now)).toBe("NOT_INVITED");
    expect(signInState({ status: "DISABLED", last_login_at: "2026-09-01" }, null, now)).toBe("DISABLED");
    expect(signInState({ status: "ACTIVE", last_login_at: "2026-09-01" }, null, now)).toBe("ACTIVE");
    expect(signInState({ status: "ACTIVE" }, { used_at: "2026-09-20", expires_at: "2026-09-27" }, now)).toBe("ACTIVE");
    expect(signInState({ status: "ACTIVE" }, { expires_at: "2026-10-03T00:00:00Z" }, now)).toBe("INVITED");
    expect(signInState({ status: "ACTIVE" }, { expires_at: "2026-09-22T00:00:00Z" }, now)).toBe("INVITE_EXPIRED");
  });
});
