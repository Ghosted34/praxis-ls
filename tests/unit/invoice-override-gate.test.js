"use strict";

/**
 * §2.7 — releasing the pricing guard is a DECISION, not an edit.
 *
 * `pricing_override` lets an invoice bill lines the accepted quotation does not
 * cover. It shipped needing only `edit` — the same grant as fixing a typo — so
 * anyone who could touch a line could release the control standing in front of
 * the client's bill. The route now demands `approve` + APPROVER when, and only
 * when, the field is present.
 */

const {
  requireFieldPermission,
} = require("../../src/shared/http/transition-permission");

jest.mock("../../src/middleware/rbac", () => {
  const { AppError } = require("../../src/utils/errors");
  return {
    requirePermission: jest.fn((moduleKey, action) => (req, _res, next) => {
      req.checked = [...(req.checked || []), `${moduleKey}.${action}`];
      if (req.grants && !req.grants.includes(`${moduleKey}.${action}`)) {
        return next(new AppError("PERMISSION_DENIED", `No permission for ${moduleKey}.${action}`, 403));
      }
      return next();
    }),
    requireCapability: jest.fn((code) => (req, _res, next) => {
      req.checked = [...(req.checked || []), `cap:${code}`];
      if (req.capabilities && !req.capabilities.includes(code)) {
        return next(new AppError("CAPABILITY_REQUIRED", `Requires the ${code} authority`, 403));
      }
      return next();
    }),
  };
});

const gate = requireFieldPermission("MOD-51", "pricing_override", "approve", {
  capability: "APPROVER",
});

/** Run the middleware and report what it checked and how it ended. */
function run(body, { grants, capabilities } = {}) {
  return new Promise((resolve) => {
    const req = { body, grants, capabilities };
    gate(req, {}, (err) => resolve({ err: err || null, checked: req.checked || [] }));
  });
}

describe("requireFieldPermission — presence of a field raises the gate", () => {
  it("does nothing at all on an ordinary edit", async () => {
    const r = await run({ lines: [{ amount: 10 }] }, { grants: [], capabilities: [] });
    expect(r.err).toBeNull();
    // Not merely allowed — never even consulted. A pricer fixing a typo must
    // not be asked for an approver's authority.
    expect(r.checked).toEqual([]);
  });

  it("is inert for null / undefined, not just a missing key", async () => {
    for (const body of [{ pricing_override: null }, { pricing_override: undefined }]) {
      const r = await run(body, { grants: [], capabilities: [] });
      expect(r.err).toBeNull();
      expect(r.checked).toEqual([]);
    }
  });

  it("demands approve AND the APPROVER authority when the field is present", async () => {
    const r = await run(
      { pricing_override: { reason: "Late storage charge, agreed by phone" } },
      { grants: ["MOD-51.approve"], capabilities: ["APPROVER"] },
    );
    expect(r.err).toBeNull();
    expect(r.checked).toEqual(["MOD-51.approve", "cap:APPROVER"]);
  });

  it("refuses someone holding only edit — the hole being closed", async () => {
    const r = await run(
      { pricing_override: { reason: "Late storage charge, agreed by phone" } },
      { grants: ["MOD-51.edit"], capabilities: ["APPROVER"] },
    );
    expect(r.err).toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
  });

  it("refuses an approver-by-module who lacks the authority overlay", async () => {
    // Segregation of duties: the module grant is not the same as being the
    // person who may authorise. Costing applies the same pairing.
    const r = await run(
      { pricing_override: { reason: "Late storage charge, agreed by phone" } },
      { grants: ["MOD-51.approve"], capabilities: [] },
    );
    expect(r.err).toMatchObject({ status: 403, code: "CAPABILITY_REQUIRED" });
  });

  it("does not run the capability check once the permission check failed", async () => {
    const r = await run(
      { pricing_override: { reason: "Late storage charge, agreed by phone" } },
      { grants: [], capabilities: [] },
    );
    expect(r.checked).toEqual(["MOD-51.approve"]);
  });

  it("skips the capability layer when none is configured", async () => {
    const plain = requireFieldPermission("MOD-51", "pricing_override", "approve");
    const req = { body: { pricing_override: { reason: "x".repeat(12) } }, grants: ["MOD-51.approve"] };
    const err = await new Promise((res) => plain(req, {}, res));
    expect(err).toBeUndefined();
    expect(req.checked).toEqual(["MOD-51.approve"]);
  });
});

describe("the assistant cannot release the guard (§2.7)", () => {
  const ai = require("../../src/modules/finance/final_invoice/final_invoice.ai");
  const update = ai.writes.find((w) => w.key === "update_final_invoice");

  it("refuses a pricing_override outright rather than forwarding it", async () => {
    // The AI surface carries one flat permission and no capability layer, so
    // the route's approve+APPROVER pairing cannot be expressed here. Refusing
    // is the honest answer — not quietly accepting on `edit`.
    await expect(
      Promise.resolve().then(() =>
        update.service({}, { invoice_id: "x", pricing_override: { reason: "because" } }, {}),
      ),
    ).rejects.toMatchObject({ code: "OVERRIDE_NOT_VIA_AI", status: 403 });
  });

  it("still carries the ordinary edit through", async () => {
    const svc = require("../../src/modules/finance/final_invoice/final_invoice.service");
    const spy = jest.spyOn(svc, "updateDraft").mockResolvedValue({ ok: true });
    await update.service({}, { invoice_id: "x", lines: [] }, { user_id: "u" });
    expect(spy).toHaveBeenCalled();
    // The dropped field must not reappear under its service-side name.
    expect(spy.mock.calls[0][1]).not.toHaveProperty("pricingOverride");
    spy.mockRestore();
  });
});
