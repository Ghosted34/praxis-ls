/**
 * Transit order (MOD-30) — the defects this module was rebuilt to fix.
 *
 * Every block below pins a specific finding rather than exercising a method for
 * coverage's sake:
 *
 *   G23     free-text cargo lines were silently dropped
 *   10692    a number was burned before anyone committed to anything
 *   10692    nothing recorded the client's signature, and lodging did not need one
 *   10693    a DRAFT order ticked a client-visible "declaration lodged" milestone
 *   legacy  the Certificate of Origin box could be printed but never ticked
 *   legacy  a declared value carried no currency
 *
 * The repo and the shared services are mocked: these are decisions, and a
 * decision should be testable without a Postgres.
 */
"use strict";

const mockEmit = jest.fn();
const mockAudit = jest.fn();
const mockAllocate = jest.fn();
const mockCapture = jest.fn();
const mockSnapshotOnto = jest.fn();
const mockForDossier = jest.fn();

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: (...a) => mockEmit(...a),
  audit: (...a) => mockAudit(...a),
  resolveActorId: jest.fn(),
}));
jest.mock("../../src/services/documents/numbering.service", () => ({
  allocate: (...a) => mockAllocate(...a),
}));
jest.mock("../../src/services/documents/document.service", () => ({
  capture: (...a) => mockCapture(...a),
}));
jest.mock(
  "../../src/modules/operations/shipment_details/shipment_details.service",
  () => ({
    snapshotOnto: (...a) => mockSnapshotOnto(...a),
    forDossier: (...a) => mockForDossier(...a),
  }),
);

const repo = require("../../src/modules/operations/transit_order/transit_order.repo");
const service = require("../../src/modules/operations/transit_order/transit_order.service");
const rules = require("../../src/modules/operations/transit_order/transit_order.rules");

/** A client whose only job is to swallow BEGIN/COMMIT/ROLLBACK. */
const fakeClient = () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) });

const ORDER = {
  transit_order_id: "to-1",
  dossier_id: "d-1",
  entity_id: "e-1",
  status: "DRAFT",
  ot_number: null,
  customs_regime: "IM4",
  service_direction: "IMPORT",
  declared_value: 47250,
  declared_currency: "EUR",
  declared_fx_to_xaf: 655.957,
  insurance_type: "CLIENT",
  surveyor_party: "CLIENT",
  signature_vault_id: null,
  submitted_docs: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAllocate.mockResolvedValue({ number: "SLAS-TRO-2026-0019" });
  mockForDossier.mockResolvedValue({ facets: {} });
  jest.spyOn(repo, "getFull").mockImplementation(async (_c, id) => ({ ...ORDER, transit_order_id: id }));
  jest.spyOn(repo, "listLines").mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

/* ── G23 ─────────────────────────────────────────────────────────────────── */

describe("G23 — a free-text cargo line survives the round trip", () => {
  /**
   * The regression, precisely: the service did
   *
   *     if (!l || !l.inventory_item_id) continue;
   *
   * while the validator marked `inventory_item_id` OPTIONAL. So the commonest
   * payload a forwarding order carries returned 201 with an allocated number, a
   * captured document, and zero lines — no error, no warning. The table's
   * `label` is NOT NULL and (until 0477) had no `inventory_item_id` at all, so
   * the filter guarded a column the table did not carry.
   */
  it("stores a line that has a description and no catalogue item", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "dossierBrief").mockResolvedValue({ dossier_id: "d-1", ref: "SL67", entity_id: "e-1" });
    jest.spyOn(repo, "liveForDossier").mockResolvedValue([]);
    jest.spyOn(repo, "insertTO").mockResolvedValue({ ...ORDER });
    jest.spyOn(repo, "deleteLines").mockResolvedValue({});
    const insertLine = jest.spyOn(repo, "insertLine").mockImplementation(async (_c, d) => d);

    await service.create(c, {
      dossierId: "d-1",
      lines: [{ label: "30 sacs ciment", packages: 30, value_amount: 450000 }],
    });

    expect(insertLine).toHaveBeenCalledTimes(1);
    expect(insertLine.mock.calls[0][1]).toMatchObject({
      label: "30 sacs ciment",
      packages: 30,
      value_amount: 450000,
      inventory_item_id: null,
      line_no: 1,
    });
  });

  it("rejects a line with no description instead of silently dropping it", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "dossierBrief").mockResolvedValue({ dossier_id: "d-1", ref: "SL67", entity_id: "e-1" });
    jest.spyOn(repo, "liveForDossier").mockResolvedValue([]);
    jest.spyOn(repo, "insertTO").mockResolvedValue({ ...ORDER });
    jest.spyOn(repo, "deleteLines").mockResolvedValue({});
    jest.spyOn(repo, "insertLine").mockResolvedValue({});

    await expect(service.create(c, {
      dossierId: "d-1",
      lines: [{ label: "   ", packages: 1 }],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Silence was the bug; a rollback with a named field is the fix.
    expect(c.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

/* ── numbering ───────────────────────────────────────────────────────────── */

describe("10692 — a number is burned at issue, never at draft", () => {
  /**
   * Legacy rendered `$nextOtNumber` into the form on page load and re-derived it
   * with `MAX(ot_number_sequence) + 1` on save. Abandoning the form left a hole
   * in a sequence customs officers read; two operators printed the same number.
   */
  it("creating a draft allocates nothing", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "dossierBrief").mockResolvedValue({ dossier_id: "d-1", ref: "SL67", entity_id: "e-1" });
    jest.spyOn(repo, "liveForDossier").mockResolvedValue([]);
    jest.spyOn(repo, "insertTO").mockResolvedValue({ ...ORDER });
    jest.spyOn(repo, "deleteLines").mockResolvedValue({});

    await service.create(c, { dossierId: "d-1" });

    expect(mockAllocate).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(repo.insertTO.mock.calls[0][1]).toMatchObject({ status: "DRAFT", ot_number: null });
  });

  it("an incomplete order cannot be issued, and burns no number when refused", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, service_direction: null, declared_value: null });

    await expect(service.issue(c, { id: "to-1" })).rejects.toMatchObject({ code: "INCOMPLETE" });
    // Asserted BEFORE allocation, which is the ordering that matters.
    expect(mockAllocate).not.toHaveBeenCalled();
  });

  it("issuing allocates the number, freezes the shipment facts and captures the document", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER });
    const update = jest.spyOn(repo, "update").mockResolvedValue({ ...ORDER, status: "ISSUED" });

    await service.issue(c, { id: "to-1", actor: { user_id: "u-1" } });

    expect(update.mock.calls[0][2]).toMatchObject({ status: "ISSUED", ot_number: "SLAS-TRO-2026-0019" });
    // 0661 — the reprint must match the copy the client signed.
    expect(mockSnapshotOnto).toHaveBeenCalledWith(c, { table: "transit_order", id: "to-1", dossierId: "d-1" });
    expect(mockCapture).toHaveBeenCalled();
  });
});

/* ── the signature ───────────────────────────────────────────────────────── */

describe("10692 — the client's signature is the authorisation to declare", () => {
  it("refuses to lodge a declaration with no signed copy attached", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, status: "SIGNED", signature_vault_id: null });

    await expect(service.lodge(c, { id: "to-1", declarationRef: "D-4471" }))
      .rejects.toMatchObject({ code: "NO_SIGNED_COPY" });
  });

  it("refuses to mark an order signed without the scan", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, status: "ISSUED" });

    await expect(service.sign(c, { id: "to-1" })).rejects.toMatchObject({ code: "NO_SIGNED_COPY" });
  });

  it("lodges with the declaration reference once a signed copy exists", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, status: "SIGNED", signature_vault_id: "v-1" });
    const update = jest.spyOn(repo, "update").mockResolvedValue({ ...ORDER, status: "LODGED" });

    await service.lodge(c, { id: "to-1", declarationRef: "D-4471" });

    expect(update.mock.calls[0][2]).toMatchObject({ status: "LODGED", declaration_ref: "D-4471" });
    expect(mockEmit).toHaveBeenCalledWith(c, expect.objectContaining({ eventTypeKey: "transit_order.lodged" }));
  });

  it("requires a declaration reference — an empty lodging records nothing", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, status: "SIGNED", signature_vault_id: "v-1" });

    await expect(service.lodge(c, { id: "to-1" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

/* ── lifecycle ───────────────────────────────────────────────────────────── */

describe("lifecycle", () => {
  it("a LODGED order is final — it cannot be cancelled by editing a row", () => {
    // Withdrawing a filed declaration is a customs act with its own paperwork.
    expect(() => rules.assertTransition("LODGED", "CANCELLED")).toThrow(/final/i);
  });

  it("an order cannot skip from DRAFT straight to SIGNED", () => {
    expect(() => rules.assertTransition("DRAFT", "SIGNED")).toThrow(/DRAFT/);
  });

  it("cancelling requires a reason, so a gap in the number sequence explains itself", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, status: "ISSUED", ot_number: "SLAS-TRO-2026-0019" });

    await expect(service.cancel(c, { id: "to-1" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("a cancelled order keeps its number — customs sequences are not re-used", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, status: "ISSUED", ot_number: "SLAS-TRO-2026-0019" });
    const update = jest.spyOn(repo, "update").mockResolvedValue({ ...ORDER, status: "CANCELLED" });

    await service.cancel(c, { id: "to-1", reason: "Client withdrew the booking" });

    expect(update.mock.calls[0][2]).not.toHaveProperty("ot_number");
  });

  it("an issued order will not let its declared value be rewritten", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, status: "ISSUED" });

    await expect(service.update(c, { id: "to-1", patch: { declared_value: 1 } }))
      .rejects.toMatchObject({ code: "LOCKED" });
  });

  it("but a departure date may still move on an issued order", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getTO").mockResolvedValue({ ...ORDER, status: "ISSUED" });
    const update = jest.spyOn(repo, "update").mockResolvedValue({ ...ORDER });

    await service.update(c, { id: "to-1", patch: { departure_date: "2026-08-01" } });

    expect(update.mock.calls[0][2]).toEqual({ departure_date: "2026-08-01" });
  });
});

/* ── duplicate guard ─────────────────────────────────────────────────────── */

describe("duplicate orders on one file", () => {
  it("is reported, not silently allowed", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "dossierBrief").mockResolvedValue({ dossier_id: "d-1", ref: "SL67", entity_id: "e-1" });
    jest.spyOn(repo, "liveForDossier").mockResolvedValue([{ ot_number: "SLAS-TRO-2026-0018", status: "ISSUED" }]);

    await expect(service.create(c, { dossierId: "d-1" })).rejects.toMatchObject({ code: "DUPLICATE_ORDER" });
  });

  it("is allowed when the caller says so — a consolidation needs several", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "dossierBrief").mockResolvedValue({ dossier_id: "d-1", ref: "SL67", entity_id: "e-1" });
    jest.spyOn(repo, "liveForDossier").mockResolvedValue([{ ot_number: "X", status: "ISSUED" }]);
    jest.spyOn(repo, "insertTO").mockResolvedValue({ ...ORDER });
    jest.spyOn(repo, "deleteLines").mockResolvedValue({});

    await expect(service.create(c, { dossierId: "d-1", allowDuplicate: true })).resolves.toBeTruthy();
  });
});

/* ── the checklist ───────────────────────────────────────────────────────── */

describe("submitted documents", () => {
  /**
   * The legacy print template rendered a Certificat d'Origine box
   * (transit-order.php:737) that the form never offered, so it could be printed
   * but never ticked.
   */
  it("offers the certificate of origin the legacy form could print but never tick", () => {
    expect(rules.SUBMITTED_DOC_CODES.has("CERTIFICATE_OF_ORIGIN")).toBe(true);
  });

  it("accepts the legacy short codes so a mid-flight caller is not broken", () => {
    expect(rules.normaliseDocs(["BL", "PACKING"])).toEqual([
      { code: "BL_AWB" }, { code: "PACKING_LIST" },
    ]);
  });

  it("rejects an unknown code instead of storing a typo", () => {
    expect(() => rules.normaliseDocs(["NOT_A_DOC"])).toThrow(/not a known document type/i);
  });

  it("de-duplicates", () => {
    expect(rules.normaliseDocs(["INVOICE", "INVOICE"])).toEqual([{ code: "INVOICE" }]);
  });
});

/* ── declared value ──────────────────────────────────────────────────────── */

describe("the declared value carries its currency", () => {
  /**
   * Legacy's cargo-value box was FREE TEXT with the placeholder
   * "e.g. 50.000 EUR" — the currency lived inside the string. The rebuild had a
   * bare numeric, which looks precise and is not: duty is assessed in XAF.
   */
  it("converts to XAF at the stated rate", () => {
    const v = rules.computeValues({ declared_value: 47250, declared_fx_to_xaf: 655.957 }, []);
    expect(v.declared_value_xaf).toBeCloseTo(30993968.25, 1);
  });

  it("reports when the cargo lines do not sum to the declared value", () => {
    const v = rules.computeValues({ declared_value: 1000, declared_fx_to_xaf: 1 }, [
      { value_amount: 400 }, { value_amount: 300 },
    ]);
    expect(v.lines_total).toBe(700);
    expect(v.reconciles).toBe(false);
  });

  it("does not complain when no line values were entered at all", () => {
    const v = rules.computeValues({ declared_value: 1000, declared_fx_to_xaf: 1 }, [{ label: "x" }]);
    expect(v.reconciles).toBe(true);
  });
});

/* ── the milestone wiring ────────────────────────────────────────────────── */

describe("10693 — the T1_LODGED milestone fires on lodging, not on drafting", () => {
  /**
   * 9091 seeded the Hinterland chain's "Transit declaration lodged" stage with
   * `auto_event = 'transit_order.created'`. That stage is client-visible, so a
   * DRAFT order would have told the client a declaration had been filed. 10693
   * re-points both the template and the live instances.
   */
  const fs = require("fs");
  const path = require("path");
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "..", "migrations", "tenant", "10693_transit_order_events.sql"),
    "utf8",
  );

  it("re-points the template stage", () => {
    expect(sql).toMatch(/UPDATE milestone_template_stage[\s\S]*?auto_advance_on_event = 'transit_order\.lodged'/);
  });

  it("re-points milestones already instantiated on open files", () => {
    expect(sql).toMatch(/UPDATE milestone_instance[\s\S]*?auto_advance_on_event = 'transit_order\.lodged'/);
  });

  it("leaves already-completed stages alone", () => {
    expect(sql).toMatch(/status <> 'DONE'/);
  });

  it("catalogues every new event the service emits", () => {
    const events = require("../../src/modules/operations/transit_order/transit_order.events");
    for (const key of [events.ISSUED, events.SIGNED, events.LODGED, events.CANCELLED]) {
      expect(sql).toContain(`'${key}'`);
    }
  });
});

/* ── the read model ──────────────────────────────────────────────────────── */

describe("get() says which shipment facts it used", () => {
  /**
   * A document that cannot tell you whether it is showing current or historic
   * facts is how the legacy reprint problem went unnoticed for years.
   */
  it("reports SNAPSHOT when the order has been frozen", async () => {
    const c = fakeClient();
    jest.spyOn(repo, "getFull").mockResolvedValue({
      ...ORDER, status: "ISSUED", shipment_details_snapshot: { facets: { ORIGIN: { value: "Anvers" } } },
    });

    const out = await service.get(c, "to-1");

    expect(out.shipment_details_source).toBe("SNAPSHOT");
    expect(mockForDossier).not.toHaveBeenCalled();
  });

  it("reports LIVE for a draft, which has nothing frozen yet", async () => {
    const c = fakeClient();
    const out = await service.get(c, "to-1");

    expect(out.shipment_details_source).toBe("LIVE");
    expect(out.allowed_transitions).toEqual(["ISSUED", "CANCELLED"]);
  });

  it("stays readable when the file's service type has lost its field set", async () => {
    const c = fakeClient();
    mockForDossier.mockRejectedValue(new Error("no field set"));

    const out = await service.get(c, "to-1");

    expect(out.transit_order_id).toBe("to-1");
    expect(out.shipment_details).toBeNull();
  });
});

describe("CodeQL — transition() cannot be steered onto Object.prototype", () => {
  /**
   * `TRANSITIONS` is an object literal, so it inherits from Object.prototype.
   * A bare `TRANSITIONS[to]` lookup therefore returns a *callable* for keys
   * like "constructor" or "toString", which then sailed past the `if (!fn)`
   * guard and got invoked with a db client. The HTTP validator pins `to` to an
   * enum so this was never reachable over the wire, but the service is
   * exported and must refuse the input on its own.
   */
  const INHERITED = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"];

  it.each(INHERITED)("rejects %s with BAD_STATE instead of calling it", async (to) => {
    const c = fakeClient();
    await expect(service.transition(c, { id: "to-1", to })).rejects.toMatchObject({
      code: "BAD_STATE",
      status: 422,
    });
    // and nothing was executed against the database on the way out
    expect(c.query).not.toHaveBeenCalled();
  });

  it.each(["ISSUED", "SIGNED", "LODGED", "CANCELLED"])(
    "still dispatches the real state %s rather than rejecting it",
    async (to) => {
      // The four real states must get past the guard and reach their handler.
      // We only care that the rejection is NOT the guard's BAD_STATE — the
      // handlers themselves are covered by the lifecycle blocks above.
      const err = await service.transition(fakeClient(), { id: "missing", to }).catch((e) => e);
      expect(err.code).not.toBe("BAD_STATE");
    },
  );
});
