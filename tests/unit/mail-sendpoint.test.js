/**
 * Send-point routing (PR-0) — which sender each part of the product mails from.
 *
 * The resolution ORDER is the thing under test. Getting it wrong sends a client
 * an invoice from the wrong company, which is the failure this registry exists
 * to make impossible to arrive at by accident.
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

const mockEmit = jest.fn(async () => {});
const mockAudit = jest.fn(async () => {});

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: (...a) => mockEmit(...a),
  audit: (...a) => mockAudit(...a),
  resolveActorId: async (_c, id) => id || null,
}));
jest.mock("../../src/modules/mail/mail/sendpoint.repo", () => ({
  NO_ENTITY: "00000000-0000-0000-0000-000000000000",
  getSendPoint: jest.fn(),
  bindingFor: jest.fn(async () => null),
  legacyIdentityFor: jest.fn(async () => null),
  upsertBinding: jest.fn(async (_c, d) => ({ ...d })),
  deleteBinding: jest.fn(async () => null),
  listWithBindings: jest.fn(async () => []),
}));

const repo = require("../../src/modules/mail/mail/sendpoint.repo");
const sp = require("../../src/modules/mail/mail/sendpoint.service");

const C = {};
const POINT = {
  send_point_key: "invoice.issued",
  legacy_purpose: "BILLING",
  is_wired: false,
  group_key: "FINANCE",
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.getSendPoint.mockResolvedValue(POINT);
  repo.bindingFor.mockResolvedValue(null);
  repo.legacyIdentityFor.mockResolvedValue(null);
});

describe("resolve — the order is the contract", () => {
  test("an entity binding is reported as such and names the company", async () => {
    repo.bindingFor.mockResolvedValue({
      entity_id: "e1",
      entity_name: "Smart Logistics SARL",
      email_identity_id: "i1",
      from_address: "billing@sl.cm",
      from_name: "SL Billing",
    });
    const r = await sp.resolve(C, {
      sendPointKey: "invoice.issued",
      entityId: "e1",
    });
    expect(r.source).toBe("ENTITY_BINDING");
    expect(r.why).toContain("Smart Logistics SARL");
    expect(r.identity.from_address).toBe("billing@sl.cm");
  });

  test("a tenant-wide binding is used when there is no entity override", async () => {
    repo.bindingFor.mockResolvedValue({
      entity_id: null,
      email_identity_id: "i1",
      from_address: "billing@t.cm",
    });
    const r = await sp.resolve(C, { sendPointKey: "invoice.issued" });
    expect(r.source).toBe("TENANT_BINDING");
    expect(r.why).toBe("Bound to billing@t.cm.");
  });

  test("with no binding it falls back to the legacy section sender, and says so", async () => {
    repo.legacyIdentityFor.mockResolvedValue({
      email_identity_id: "old",
      from_address: "old@t.cm",
    });
    const r = await sp.resolve(C, { sendPointKey: "invoice.issued" });
    expect(r.source).toBe("LEGACY_SECTION");
    expect(r.why).toContain("BILLING");
    expect(r.why).toContain("old@t.cm");
    expect(repo.legacyIdentityFor).toHaveBeenCalledWith(C, "BILLING");
  });

  test("with nothing configured it says nothing is configured", async () => {
    const r = await sp.resolve(C, { sendPointKey: "invoice.issued" });
    expect(r.source).toBe("FALLBACK");
    expect(r.identity).toBeNull();
    expect(r.why).toMatch(/falls back/i);
  });

  test("an unknown send point still resolves rather than throwing", async () => {
    // A caller bug must not stop mail going out — the fallback chain below still
    // produces a working sender.
    repo.getSendPoint.mockResolvedValue(null);
    const r = await sp.resolve(C, { sendPointKey: "nope.nope" });
    expect(r.source).toBe("FALLBACK");
    expect(r.send_point).toBeNull();
  });

  test("a send point with no legacy purpose does not look one up", async () => {
    repo.getSendPoint.mockResolvedValue({ ...POINT, legacy_purpose: null });
    await sp.resolve(C, { sendPointKey: "invoice.issued" });
    expect(repo.legacyIdentityFor).not.toHaveBeenCalled();
  });

  test("a binding to a mailbox rather than an identity is carried through", async () => {
    repo.bindingFor.mockResolvedValue({
      entity_id: null,
      email_connection_id: "c1",
      connection_address: "ops@t.cm",
      connection_status: "CONNECTED",
    });
    const r = await sp.resolve(C, { sendPointKey: "invoice.issued" });
    expect(r.identity).toBeNull();
    expect(r.connection.email_address).toBe("ops@t.cm");
  });
});

describe("bind", () => {
  test("refuses a binding with no target", async () => {
    await expect(
      sp.bind(C, { sendPointKey: "invoice.issued", actor: {} }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("refuses a binding with two targets — a send point sends from one place", async () => {
    await expect(
      sp.bind(C, {
        sendPointKey: "invoice.issued",
        identityId: "i1",
        connectionId: "c1",
        actor: {},
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("refuses an unknown send point", async () => {
    repo.getSendPoint.mockResolvedValue(null);
    await expect(
      sp.bind(C, { sendPointKey: "nope", identityId: "i1", actor: {} }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a rebind is security-critical and records what it replaced", async () => {
    repo.bindingFor.mockResolvedValue({
      email_identity_id: "old",
      email_connection_id: null,
    });
    await sp.bind(C, {
      sendPointKey: "invoice.issued",
      identityId: "new",
      actor: { user_id: "u1" },
    });
    expect(mockEmit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ eventTypeKey: "mail.send_point.bound" }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({
        isSensitive: true,
        before: expect.objectContaining({ email_identity_id: "old" }),
        after: expect.objectContaining({ email_identity_id: "new" }),
      }),
    );
  });
});

describe("unbind", () => {
  test("removing nothing is not an error", async () => {
    expect(
      await sp.unbind(C, { sendPointKey: "invoice.issued", actor: {} }),
    ).toEqual({ removed: false });
  });

  test("removing a binding is audited as sensitive", async () => {
    repo.deleteBinding.mockResolvedValue({
      email_identity_id: "i1",
      email_connection_id: null,
      entity_id: null,
    });
    expect(
      await sp.unbind(C, {
        sendPointKey: "invoice.issued",
        actor: { user_id: "u1" },
      }),
    ).toEqual({ removed: true });
    expect(mockAudit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ isSensitive: true }),
    );
  });
});

describe("listResolved", () => {
  test("carries is_wired through, so the screen can admit what nothing sends yet", async () => {
    repo.listWithBindings.mockResolvedValue([
      { ...POINT, is_wired: false, bindings: [] },
      {
        send_point_key: "auth.otp",
        legacy_purpose: "NOTIFICATIONS",
        is_wired: true,
        group_key: "SECURITY",
        bindings: [],
      },
    ]);
    const rows = await sp.listResolved(C);
    expect(rows.map((r) => r.is_wired)).toEqual([false, true]);
    expect(rows[0].resolved.source).toBe("FALLBACK");
    expect(rows[0].resolved.why).toBeTruthy();
  });
});
