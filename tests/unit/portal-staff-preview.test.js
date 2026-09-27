"use strict";
/**
 * GET /api/tenant/portals/client?client_id=… is the STAFF preview of a client's
 * portal. It runs under the staff session, where `req.portal` never exists, so
 * reading the client from the grant refused every preview with CLIENT_REQUIRED.
 * These pin the fix AND the rule it must not weaken: the portal-user handler
 * still ignores any client_id in the query.
 */
jest.mock("../../src/modules/portal/portal.service", () => ({
  clientView: jest.fn(async (_c, { clientId }) => ({ client_id: clientId })),
  clientChain: jest.fn(async (_c, { clientId, dossierId }) => ({ client_id: clientId, dossier_id: dossierId })),
}));
const service = require("../../src/modules/portal/portal.service");
const controller = require("../../src/modules/portal/portal.controller");

const CLIENT = "8f1aa20c-bb78-4fc3-89b7-569333c0059e";
const OTHER = "11111111-2222-4333-8444-555555555555";

async function call(handler, req) {
  const res = { json: jest.fn(), status: jest.fn(() => res) };
  const next = jest.fn();
  await handler({ tenantDb: (fn) => fn({}), params: {}, query: {}, ...req }, res, next);
  return { res, err: next.mock.calls[0] && next.mock.calls[0][0] };
}

beforeEach(() => jest.clearAllMocks());

describe("staff preview", () => {
  test("uses the client_id the staff member chose", async () => {
    const { res, err } = await call(controller.staffClient, { query: { client_id: CLIENT } });
    expect(err).toBeUndefined();
    expect(service.clientView.mock.calls[0][1]).toEqual({ clientId: CLIENT });
    expect(res.json).toHaveBeenCalledWith({ data: { client_id: CLIENT } });
  });

  test("dossier chain preview too", async () => {
    const { err } = await call(controller.staffClientChain, { query: { client_id: CLIENT }, params: { dossierId: "d-1" } });
    expect(err).toBeUndefined();
    expect(service.clientChain.mock.calls[0][1]).toEqual({ clientId: CLIENT, dossierId: "d-1" });
  });

  test.each([undefined, "", "not-a-uuid", "1; drop table x"])("client_id %p is a clear 422, not a DB error", async (id) => {
    const { err } = await call(controller.staffClient, { query: { client_id: id } });
    expect(err).toMatchObject({ code: "CLIENT_REQUIRED", status: 422 });
    expect(service.clientView).not.toHaveBeenCalled();
  });
});

describe("portal user (unchanged)", () => {
  test("scope comes from the grant; a client_id in the query is ignored", async () => {
    const { err } = await call(controller.client, { portal: { clientId: CLIENT }, query: { client_id: OTHER } });
    expect(err).toBeUndefined();
    expect(service.clientView.mock.calls[0][1]).toEqual({ clientId: CLIENT });
  });

  test("no grant scope is still refused, even with a client_id in the query", async () => {
    const { err } = await call(controller.client, { query: { client_id: OTHER } });
    expect(err).toMatchObject({ code: "CLIENT_REQUIRED" });
    expect(service.clientView).not.toHaveBeenCalled();
  });
});
