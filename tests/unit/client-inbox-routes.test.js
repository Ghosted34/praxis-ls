"use strict";

/**
 * Who may reach the Client inbox and a client's account manager (client portal
 * PR 3, seeds 90997/9136, 14200) — read off the live Express stacks, so a
 * route re-gated by accident fails here rather than in a client's inbox.
 *
 *   · The team's side of the chat is MOD-64C, the Client inbox — the people
 *     who answer clients. It was MOD-67, the IAM engine, whose grants are an
 *     administrator's: the people a client was writing to could not read it.
 *   · The account manager is part of the client record (MOD-03) AND of the
 *     inbox's work: either grant reads it, either `edit` names one.
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

const portal = require("../../src/modules/portal_auth/portal_auth.routes").router;
const clients = require("../../src/modules/master/client_master/client_master.routes").router;

/** The permission gate on one route, as [[module, action], …] (any of them opens it). */
function gateOn(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method.toUpperCase()} ${path}`);
  const gates = layer.route.stack.map((s) => s.handle.gate).filter(Boolean);
  expect(gates).toHaveLength(1);
  return gates[0];
}

describe("the team's side of the client chat", () => {
  test.each([
    ["get", "/chat/inbox", "view"],
    ["get", "/chat/threads", "view"],
    ["get", "/chat/messages", "view"],
    ["post", "/chat/messages", "edit"],
    ["post", "/chat/read", "view"],
    ["get", "/chat/attachments/:attachmentId", "view"],
  ])("%s %s needs the Client inbox (%s)", (method, path, action) => {
    expect(gateOn(portal, method, path)).toEqual([["MOD-64C", action]]);
  });

  it("leaves the rest of client support where it was", () => {
    expect(gateOn(portal, "get", "/messages")).toEqual([["MOD-67", "view"]]);
  });

  it("moved the onboarding checklist to the client's record, under the client portal's grant", () => {
    // Settings → Client support was retired; the checklist lives in the
    // Client 360's Portal tab (client-360-portal-routes.test.js has the rest).
    expect(gateOn(portal, "get", "/clients/:clientId/onboarding")).toEqual([["MOD-29", "view"]]);
    // The old address stays, deprecated, for a tab on an older bundle.
    expect(gateOn(portal, "get", "/onboarding")).toEqual([["MOD-67", "view"]]);
  });
});

describe("what the team may send", () => {
  const v = require("../../src/modules/portal_auth/portal_auth.validator");
  const run = (body) =>
    new Promise((resolve) => {
      const req = { body };
      v.staffChatSend(req, {}, (err) => resolve({ err, body: req.body }));
    });
  const CLIENT = "0b8a3f4e-5d6c-4b7a-8e9f-102132435465";

  it("a location, as a multipart form sends it — strings, both coordinates", async () => {
    const { err, body } = await run({ client_id: CLIENT, thread: "general", lat: "4.0435", lng: "9.6966", location_label: "Warehouse B" });
    expect(err).toBeUndefined();
    expect(body).toMatchObject({ lat: 4.0435, lng: 9.6966, location_label: "Warehouse B" });
  });

  it("never half a pin", async () => {
    const { err } = await run({ client_id: CLIENT, thread: "general", lat: "4.0435" });
    expect(err).toMatchObject({ status: 422 });
  });
});

describe("a client's account manager", () => {
  it("is read with the client record or the Client inbox", () => {
    expect(gateOn(clients, "get", "/:id/account-manager")).toEqual([["MOD-03", "view"], ["MOD-64C", "view"]]);
  });

  it("is named by whoever may edit either", () => {
    expect(gateOn(clients, "put", "/:id/account-manager")).toEqual([["MOD-03", "edit"], ["MOD-64C", "edit"]]);
  });

  it("is chosen from a list gated like naming one, and reachable before /:id swallows it", () => {
    expect(gateOn(clients, "get", "/account-manager-candidates")).toEqual([["MOD-03", "edit"], ["MOD-64C", "edit"]]);
    const at = (path) => clients.stack.findIndex((l) => l.route && l.route.path === path && l.route.methods.get);
    expect(at("/account-manager-candidates")).toBeLessThan(at("/:id"));
  });
});
