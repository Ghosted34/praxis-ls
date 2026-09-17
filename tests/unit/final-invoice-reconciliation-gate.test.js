"use strict";

/**
 * block_final_invoice — MOD-76/Q18, owner decision: WARN by default.
 *
 * One setting, two behaviours, and the test that pins both reads the setting
 * key the admin page edits — `finance / reconciliation / block_final_invoice`
 * (seeded `false` by 13801):
 *
 *   · seeded/warn (default) — the draft goes through, but LOUDLY: the event
 *     fires at the act of drafting (invoice === null), the audit stamps every
 *     passage, and line edits must NOT re-ping Finance (once=false);
 *   · tenant-flipped block — settled-or-nothing: the draft FAILS with
 *     RECONCILIATION_UNSETTLED carrying the sheet's status, in the same throw
 *     shape as every other 422 out of assertPricedSource;
 *   · a settled file — the gate is silent; no audit, no event.
 */

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

const { audit, emitEvent } = require("../../src/shared/events/emit");
const service = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.service");

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const DOSSIER = UUID(2);

function fakeClient({ header = null, setting = null } = {}) {
  return {
    async query(sql) {
      if (/FROM dossier_reconciliation WHERE dossier_id/.test(sql)) return { rows: header ? [header] : [] };
      if (/FROM setting WHERE section/.test(sql)) return { rows: setting ? [{ value: setting }] : [] };
      return { rows: [] };
    },
  };
}

beforeEach(() => jest.clearAllMocks());

describe("invoiceGateFor — warn by default (Q18)", () => {
  it("warns at the draft: the event fires once, the audit keeps every passage", async () => {
    const c = fakeClient({ header: { reconciliation_id: UUID(90), status: "OPEN" } });
    const out = await service.invoiceGateFor(c, { dossierId: DOSSIER, actor: { user_id: UUID(50) }, once: true });
    expect(out).toEqual({ gated: "warned", status: "OPEN", warned: true });
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent.mock.calls[0][1].eventTypeKey).toBe("reconciliation.settlement_due");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("a line edit on an existing draft audits but does NOT re-notify", async () => {
    const c = fakeClient({ header: { reconciliation_id: UUID(90), status: "SUBMITTED" } });
    const out = await service.invoiceGateFor(c, { dossierId: DOSSIER, actor: { user_id: UUID(50) }, once: false });
    expect(out.gated).toBe("warned");
    expect(emitEvent).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("a file that never opened a reconciliation is read as OPEN, not as an error", async () => {
    const c = fakeClient({ header: null });
    const out = await service.invoiceGateFor(c, { dossierId: DOSSIER, actor: { user_id: UUID(50) }, once: true });
    expect(out).toEqual({ gated: "warned", status: "OPEN", warned: true });
  });

  it("is silent on a settled file — the conversation is closed, no audit litter", async () => {
    const c = fakeClient({ header: { reconciliation_id: UUID(90), status: "SETTLED" } });
    const out = await service.invoiceGateFor(c, { dossierId: DOSSIER, actor: { user_id: UUID(50) }});
    expect(out).toEqual({ gated: false, status: "SETTLED", warned: false });
    expect(emitEvent).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("invoiceGateFor — tenant-flipped hard block", () => {
  const on = { block_final_invoice: true };

  it("throws RECONCILIATION_UNSETTLED with the status a person can read", async () => {
    const c = fakeClient({ header: { reconciliation_id: UUID(90), status: "SUBMITTED" }, setting: on });
    await expect(service.invoiceGateFor(c, { dossierId: DOSSIER, actor: { user_id: UUID(50) } }))
      .rejects.toMatchObject({
        code: "RECONCILIATION_UNSETTLED",
        status: 422,
        details: { status: "SUBMITTED", setting: "finance.reconciliation.block_final_invoice" },
      });
    // A refused draft warns nobody — the hard refusal IS the message.
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("settles the file first and the block stands down", async () => {
    const c = fakeClient({ header: { reconciliation_id: UUID(90), status: "SETTLED" }, setting: on });
    await expect(service.invoiceGateFor(c, { dossierId: DOSSIER })).resolves.toEqual({
      gated: false, status: "SETTLED", warned: false,
    });
  });

  it("a malformed setting is not a block — the seeded default is the generous one", async () => {
    const c = fakeClient({ header: { reconciliation_id: UUID(90), status: "OPEN" }, setting: { block_final_invoice: "true" } });
    // String "true" ≠ boolean true: a value the admin API wouldn't write must
    // not become a policy change on its own.
    await expect(service.invoiceGateFor(c, { dossierId: DOSSIER, actor: { user_id: UUID(50) } }))
      .resolves.toMatchObject({ gated: "warned" });
  });
});
