/**
 * Delivery note (MOD-32) — the defects this module was rebuilt to fix.
 *
 * Each block pins a specific finding rather than exercising a method:
 *
 *   legacy  every "update" burned a NEW number (create.php ignores the
 *           dn_number the client sends back and always INSERTs)
 *   legacy  the container list was a free-text paste box, unreconciled with
 *           the containers the file already holds
 *   legacy  the print had a "Received By (Client)" box and nothing ever
 *           captured what was written in it
 *   legacy  the manifest grid truncated at 18 containers
 *   10695   a note could claim DELIVERED with nobody named
 *
 * The repo and shared services are mocked: these are decisions, and a decision
 * should be testable without a Postgres.
 */
"use strict";

const mockEmit = jest.fn();
const mockAudit = jest.fn();
const mockAllocate = jest.fn();
const mockCapture = jest.fn();
const mockSnapshotOnto = jest.fn();

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: (...a) => mockEmit(...a),
  audit: (...a) => mockAudit(...a),
  resolveActorId: jest.fn(async (_c, id) => id || null),
}));
jest.mock("../../src/services/documents/numbering.service", () => ({
  allocate: (...a) => mockAllocate(...a),
}));
jest.mock("../../src/services/documents/document.service", () => ({
  capture: (...a) => mockCapture(...a),
}));
jest.mock("../../src/modules/operations/shipment_details/shipment_details.service", () => ({
  snapshotOnto: (...a) => mockSnapshotOnto(...a),
  forDossier: jest.fn(),
}));

const repo = require("../../src/modules/operations/delivery_note/delivery_note.repo");
const rules = require("../../src/modules/operations/delivery_note/delivery_note.rules");
const service = require("../../src/modules/operations/delivery_note/delivery_note.service");

const DN = "11111111-1111-4111-8111-111111111111";
const DOSSIER = "22222222-2222-4222-8222-222222222222";
const ENTITY = "33333333-3333-4333-8333-333333333333";
const UNIT_A = "44444444-4444-4444-8444-444444444444";
const UNIT_B = "55555555-5555-4555-8555-555555555555";

function fakeClient() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }) };
}

/** A note in a given state, with the repo wired to round-trip updates. */
function stubNote(over = {}) {
  const row = {
    delivery_note_id: DN, dossier_id: DOSSIER, entity_id: ENTITY,
    status: "DRAFT", doc_number: null, consignee: "CIMENCAM SA",
    address: "Zone Industrielle, Douala", delivery_date: null,
    received_by_name: null, ...over,
  };
  jest.spyOn(repo, "getDN").mockResolvedValue(row);
  jest.spyOn(repo, "getFull").mockResolvedValue(row);
  jest.spyOn(repo, "update").mockImplementation(async (_c, _id, f) => ({ ...row, ...f }));
  return row;
}

beforeEach(() => {
  mockAllocate.mockResolvedValue({ number: "DN-2026-0001" });
  jest.spyOn(repo, "listLines").mockResolvedValue([{ label: "Palettes", qty: 24 }]);
  jest.spyOn(repo, "listContainers").mockResolvedValue([]);
  jest.spyOn(repo, "deleteLines").mockResolvedValue({});
  jest.spyOn(repo, "deleteContainers").mockResolvedValue({});
  jest.spyOn(repo, "insertLine").mockImplementation(async (_c, d) => d);
  jest.spyOn(repo, "insertContainer").mockImplementation(async (_c, d) => d);
  jest.spyOn(repo, "insertDN").mockImplementation(async (_c, d) => ({ delivery_note_id: DN, ...d }));
  jest.spyOn(repo, "dossierBrief").mockResolvedValue({
    dossier_id: DOSSIER, ref: "SBX-2026-0001", entity_id: ENTITY, client_name: "CIMENCAM SA",
  });
});

afterEach(() => jest.restoreAllMocks());

describe("legacy — a number is burned once, at issue", () => {
  it("does not allocate a number when the note is drafted", async () => {
    jest.spyOn(repo, "getFull").mockResolvedValue({ delivery_note_id: DN, status: "DRAFT" });
    await service.create(fakeClient(), { dossierId: DOSSIER, lines: [{ label: "Palettes" }] });

    // Legacy took MAX(dn_sequence)+1 on the very first save.
    expect(mockAllocate).not.toHaveBeenCalled();
    const [, row] = repo.insertDN.mock.calls[0];
    expect(row.status).toBe("DRAFT");
    expect(row.doc_number).toBeUndefined();
  });

  it("allocates exactly one number on issue", async () => {
    stubNote({ status: "DRAFT" });
    await service.issue(fakeClient(), { id: DN, actor: {} });

    expect(mockAllocate).toHaveBeenCalledTimes(1);
    const patch = repo.update.mock.calls[0][2];
    expect(patch).toMatchObject({ status: "ISSUED", doc_number: "DN-2026-0001" });
  });

  it("refuses to re-issue, so a second number can never be burned", async () => {
    // THE legacy bug: create.php ignores the dn_number the client sends back,
    // so every subsequent save INSERTed a new row with a new number and
    // orphaned the first.
    stubNote({ status: "ISSUED", doc_number: "DN-2026-0001" });
    await expect(service.issue(fakeClient(), { id: DN })).rejects.toMatchObject({
      code: "BAD_STATE",
    });
    expect(mockAllocate).not.toHaveBeenCalled();
  });

  it("asserts completeness BEFORE burning the number", async () => {
    // Otherwise an incomplete note eats a sequence number on its way to a 422
    // and leaves an unexplained gap in the series.
    stubNote({ status: "DRAFT", address: null });
    await expect(service.issue(fakeClient(), { id: DN })).rejects.toMatchObject({
      code: "INCOMPLETE",
      details: { missing: expect.arrayContaining(["delivery address"]) },
    });
    expect(mockAllocate).not.toHaveBeenCalled();
  });
});

describe("legacy — the container paste box becomes a pick from the file", () => {
  it("snapshots the file's own number and seal onto the note", async () => {
    jest.spyOn(repo, "unitsOnDossier").mockResolvedValue(new Map([
      [UNIT_A, { dossier_container_unit_id: UNIT_A, container_no: "TCLU1234567", seal_no: "SL889231", gross_weight_kg: 21000 }],
    ]));
    jest.spyOn(repo, "getFull").mockResolvedValue({ delivery_note_id: DN, status: "DRAFT" });

    await service.create(fakeClient(), {
      dossierId: DOSSIER, lines: [{ label: "x" }],
      containers: [{ dossier_container_unit_id: UNIT_A }],
    });

    const [, row] = repo.insertContainer.mock.calls[0];
    // Copied, not merely referenced: correcting the file later must not rewrite
    // what was signed for.
    expect(row).toMatchObject({
      dossier_container_unit_id: UNIT_A,
      container_no: "TCLU1234567",
      seal_no: "SL889231",
      gross_weight_kg: 21000,
    });
  });

  it("refuses a container that belongs to another file", async () => {
    jest.spyOn(repo, "unitsOnDossier").mockResolvedValue(new Map());
    await expect(service.create(fakeClient(), {
      dossierId: DOSSIER, lines: [{ label: "x" }],
      containers: [{ dossier_container_unit_id: UNIT_B }],
    })).rejects.toMatchObject({ code: "UNKNOWN_CONTAINER", status: 422 });
  });

  it("still accepts a hand-typed box that never made it onto the file", async () => {
    jest.spyOn(repo, "unitsOnDossier").mockResolvedValue(new Map());
    jest.spyOn(repo, "getFull").mockResolvedValue({ delivery_note_id: DN, status: "DRAFT" });

    await service.create(fakeClient(), {
      dossierId: DOSSIER, lines: [{ label: "x" }],
      containers: [{ container_no: "tclu999888 " }],
    });

    const [, row] = repo.insertContainer.mock.calls[0];
    expect(row.container_no).toBe("TCLU999888");
    expect(row.dossier_container_unit_id).toBeNull();
  });
});

describe("normaliseContainers", () => {
  it("de-duplicates a box picked twice", () => {
    const out = rules.normaliseContainers([
      { dossier_container_unit_id: UNIT_A },
      { dossier_container_unit_id: UNIT_A },
      { container_no: "ABCD1" }, { container_no: "abcd1" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("names the row when a container identifies nothing", () => {
    expect(() => rules.normaliseContainers([{ seal_no: "S1" }])).toThrow(/Container 1/);
  });

  it("numbers the rows so print order is stable", () => {
    const out = rules.normaliseContainers([{ container_no: "A" }, { container_no: "B" }]);
    expect(out.map((r) => r.seq)).toEqual([0, 1]);
  });
});

describe("10695 — DELIVERED means somebody signed for it", () => {
  it("records the name, the time and the client's reservations", async () => {
    stubNote({ status: "ISSUED", doc_number: "DN-2026-0001" });

    await service.confirmDelivery(fakeClient(), {
      id: DN, receivedByName: " Jean Mballa ",
      reservations: "Carton 3 écrasé.",
    });

    const patch = repo.update.mock.calls[0][2];
    expect(patch).toMatchObject({
      status: "DELIVERED",
      received_by_name: "Jean Mballa",
      reservations: "Carton 3 écrasé.",
    });
    expect(patch.received_at).toBeTruthy();
  });

  it("refuses to confirm a delivery with nobody named", async () => {
    stubNote({ status: "ISSUED" });
    await expect(service.confirmDelivery(fakeClient(), { id: DN, receivedByName: "   " }))
      .rejects.toMatchObject({ code: "NO_RECIPIENT", status: 422 });
  });

  it("backfills delivery_date from the signature when none was planned", async () => {
    stubNote({ status: "ISSUED", delivery_date: null });
    await service.confirmDelivery(fakeClient(), {
      id: DN, receivedByName: "Jean", receivedAt: "2026-08-14T10:00:00.000Z",
    });
    expect(repo.update.mock.calls[0][2].delivery_date).toBe("2026-08-14");
  });

  it("does not overwrite a delivery_date that was already set", async () => {
    stubNote({ status: "ISSUED", delivery_date: "2026-08-01" });
    await service.confirmDelivery(fakeClient(), { id: DN, receivedByName: "Jean" });
    expect(repo.update.mock.calls[0][2].delivery_date).toBeUndefined();
  });

  it("emits delivered, so a milestone can hang off the real event", async () => {
    stubNote({ status: "ISSUED" });
    await service.confirmDelivery(fakeClient(), { id: DN, receivedByName: "Jean" });
    expect(mockEmit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventTypeKey: "delivery_note.delivered",
    }));
  });
});

describe("lifecycle", () => {
  it("DELIVERED is terminal — what a client signed is not edited afterwards", () => {
    expect(rules.NEXT.DELIVERED).toEqual([]);
    expect(() => rules.assertTransition("DELIVERED", "ISSUED")).toThrow(/final/);
  });

  it("locks the consignee once the note is with the driver", () => {
    expect(() => rules.assertEditable({ status: "ISSUED" }, { consignee: "Someone else" }))
      .toThrow(/only/);
  });

  it("still allows the address to be corrected mid-run", () => {
    expect(rules.assertEditable({ status: "ISSUED" }, { address: "Gate 4" })).toBe(true);
  });

  it("requires a reason to cancel", async () => {
    stubNote({ status: "ISSUED" });
    await expect(service.cancel(fakeClient(), { id: DN, reason: "  " }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("keeps the number when cancelling — a gap in the series is a question", async () => {
    stubNote({ status: "ISSUED", doc_number: "DN-2026-0001" });
    await service.cancel(fakeClient(), { id: DN, reason: "Client refused delivery" });
    const patch = repo.update.mock.calls[0][2];
    expect(patch.status).toBe("CANCELLED");
    expect(patch.doc_number).toBeUndefined();
  });

  it("rolls back a failed issue rather than leaving a half-issued note", async () => {
    stubNote({ status: "DRAFT" });
    mockAllocate.mockRejectedValue(new Error("sequence locked"));
    const client = fakeClient();
    await expect(service.issue(client, { id: DN })).rejects.toThrow();
    const verbs = client.query.mock.calls.map(([s]) => s);
    expect(verbs).toContain("ROLLBACK");
    expect(verbs).not.toContain("COMMIT");
  });
});

describe("G23 — a hand-typed cargo line survives", () => {
  it("keeps a line that has a label but no stock item", async () => {
    jest.spyOn(repo, "getFull").mockResolvedValue({ delivery_note_id: DN, status: "DRAFT" });
    await service.create(fakeClient(), {
      dossierId: DOSSIER,
      lines: [{ label: "2 pallets, unlisted spares", qty: 2 }],
    });
    const [, row] = repo.insertLine.mock.calls[0];
    expect(row).toMatchObject({ label: "2 pallets, unlisted spares", inventory_item_id: null });
  });

  it("refuses a line that says nothing, naming the row", async () => {
    await expect(service.create(fakeClient(), {
      dossierId: DOSSIER, lines: [{ label: "ok" }, { qty: 1 }],
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Line 2"),
    });
  });
});

describe("the printed manifest", () => {
  const { TEMPLATES } = require("../../src/services/documents/templates/registry");
  const kit = require("../../src/services/documents/templates/kit");
  const cfg = kit.mergeCfg({ language: "en" });
  const render = (data) =>
    TEMPLATES.DELIVERY_NOTE.build({ ...TEMPLATES.DELIVERY_NOTE.sampleData, ...data }, cfg, { legal_name: "X" }, null);

  /*
   * The manifest's shape is pinned in full by delivery-note-document.test.js,
   * alongside the one-page fit and the monolingual rendering it is part of.
   * What stays here is the pair of claims that belong to the LIFECYCLE: a form
   * somebody can write on at the gate, and a manifest that never truncates.
   */
  it("pads to a ruled minimum so a box added at the gate can be written in", () => {
    // Twelve, in four rows of three — the instrument sheet's manifest grid.
    // (Legacy's eighteen was a single column and cost a third of the page.)
    const html = render({ containers: [{ container_no: "TCLU1" }] });
    expect((html.match(/______________/g) || [])).toHaveLength(11);
  });

  it("prints ALL containers when there are more than the minimum", () => {
    // Legacy hard-coded 18 slots and silently dropped the rest — data loss on
    // a document whose whole job is to say what was handed over.
    const many = Array.from({ length: 22 }, (_, i) => ({ container_no: `TCLU${i}` }));
    const html = render({ containers: many });
    expect(html).toContain("TCLU21");
    // 22 boxes fill eight rows of three; the two spare cells stay ruled rather
    // than leaving the last row two-thirds blank.
    expect((html.match(/______________/g) || [])).toHaveLength(2);
  });

  it("prints an empty reservations box when the client wrote nothing", () => {
    const html = render({ reservations: null });
    expect(html).toMatch(/Comments \/ reservations \(client\)/);
  });

  it("names who signed, rather than an anonymous line", () => {
    const html = render({ received_by_name: "Jean Mballa" });
    expect(html).toContain("Jean Mballa");
  });
});

describe("migration 10695", () => {
  const fs = require("fs");
  const path = require("path");
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "..", "migrations", "tenant", "10695_delivery_note_lifecycle.sql"),
    "utf8",
  );

  it("does not add a free-text container column", () => {
    // The containers are structured, on the file. A `tc_list text` here would
    // be a second unreconciled copy of a fact the system already holds.
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS\s+(tc_list|container_manifest)\b/);
  });

  it("backfills historic rows to ISSUED, never to DELIVERED", () => {
    expect(sql).toMatch(/SET status = 'ISSUED'/);
    expect(sql).not.toMatch(/SET status = 'DELIVERED'/);
  });

  it("stops a DELIVERED row that names nobody", () => {
    expect(sql).toMatch(/chk_delivery_note_received/);
  });

  it("keeps a signed note intact when the file's container is deleted", () => {
    expect(sql).toMatch(/ON DELETE SET NULL/);
  });
});
