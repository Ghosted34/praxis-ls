/**
 * Delivery note (MOD-32) — the G23 defects, mirrored from the transit order.
 *
 * GAP_REVIEW G23 names both modules together because they carried the same two
 * bugs. The transit-order half is pinned in transit-order-lifecycle.test.js;
 * this is the other half:
 *
 *   G23   a free-text line (no `inventory_item_id`) was silently dropped —
 *         201 Created, note printed, line gone
 *   G23   no `address`, `phone` or `delivery_date` on a document whose entire
 *         purpose is to prove where goods went, and when
 *
 * The repo and the shared services are mocked: these are decisions about what
 * the module refuses and what it persists, and neither needs a Postgres.
 */
"use strict";

const mockEmit = jest.fn();
const mockAudit = jest.fn();
const mockAllocate = jest.fn();
const mockCapture = jest.fn();

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

const repo = require("../../src/modules/operations/delivery_note/delivery_note.repo");
const service = require("../../src/modules/operations/delivery_note/delivery_note.service");
const { schemas } = require("../../src/modules/operations/delivery_note/delivery_note.validator");

const DN_ID = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

/** Swallows the transaction verbs so a test only sees the real calls. */
function fakeClient() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }) };
}

beforeEach(() => {
  mockAllocate.mockResolvedValue({ number: "DN-2026-0001" });
  jest.spyOn(repo, "insertDN").mockImplementation(async (_c, data) => ({
    delivery_note_id: DN_ID, ...data,
  }));
  jest.spyOn(repo, "insertLine").mockImplementation(async (_c, data) => data);
});

afterEach(() => jest.restoreAllMocks());

describe("G23 — a hand-typed line survives the round trip", () => {
  it("persists a line that has a label but no stock item", async () => {
    const client = fakeClient();

    await service.create(client, {
      entityId: ENTITY,
      lines: [
        { inventory_item_id: ITEM, label: "Catalogued pump", qty: 1 },
        { label: "2 pallets, unlisted spares", qty: 2 },
      ],
    });

    const written = repo.insertLine.mock.calls.map(([, d]) => d);
    expect(written).toHaveLength(2);

    // THE regression: this row used to never reach the database.
    const freeText = written.find((l) => l.label === "2 pallets, unlisted spares");
    expect(freeText).toBeDefined();
    expect(freeText.inventory_item_id).toBeNull();
    expect(freeText.qty).toBe(2);
  });

  it("refuses a line with neither a label nor a stock item, naming the row", async () => {
    const client = fakeClient();

    await expect(service.create(client, {
      entityId: ENTITY,
      lines: [{ label: "Catalogued pump", qty: 1 }, { qty: 3 }],
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      // 1-based, so the message matches the row the operator is looking at.
      message: expect.stringContaining("Line 2"),
      details: { "lines.1.label": ["a line needs a description (or a stock item)"] },
    });
  });

  it("rolls the whole note back rather than saving a shortened one", async () => {
    const client = fakeClient();

    await expect(service.create(client, {
      entityId: ENTITY,
      lines: [{ label: "Good line" }, { label: "   " }],
    })).rejects.toThrow();

    const verbs = client.query.mock.calls.map(([sql]) => sql);
    expect(verbs).toContain("ROLLBACK");
    expect(verbs).not.toContain("COMMIT");
  });

  it("treats a whitespace-only label as blank", () => {
    // Refused at the edge too, so the service check is a backstop and not the
    // only thing standing between a blank line and the document.
    const parsed = schemas.create.safeParse({
      entity_id: ENTITY, lines: [{ label: "" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("G23 — where the goods went, and when", () => {
  it("persists address, phone and delivery_date", async () => {
    const client = fakeClient();

    await service.create(client, {
      entityId: ENTITY,
      consignee: "Bolloré Cameroun",
      cityZone: "Bonabéri",
      address: "Zone Industrielle, Rue 4321, Douala",
      phone: "+237 6 99 00 11 22",
      deliveryDate: "2026-08-14",
    });

    const [, row] = repo.insertDN.mock.calls[0];
    expect(row).toMatchObject({
      address: "Zone Industrielle, Rue 4321, Douala",
      phone: "+237 6 99 00 11 22",
      delivery_date: "2026-08-14",
      // `city_zone` is a routing bucket and does NOT stand in for an address.
      city_zone: "Bonabéri",
    });
  });

  it("records delivery_date as null when it is not known, never as today", async () => {
    const client = fakeClient();

    await service.create(client, { entityId: ENTITY, date: "2026-08-16" });

    const [, row] = repo.insertDN.mock.calls[0];
    // `date` drives NUMBERING (the sequence year), not the arrival. Letting it
    // leak into delivery_date would fabricate an arrival for every note.
    expect(row.delivery_date).toBeNull();
  });

  it("accepts the three new fields on the create schema", () => {
    const parsed = schemas.create.safeParse({
      entity_id: ENTITY,
      address: "Zone Industrielle, Douala",
      phone: "+237 699001122",
      delivery_date: "2026-08-14",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a delivery_date that is not a plain date", () => {
    const parsed = schemas.create.safeParse({
      entity_id: ENTITY, delivery_date: "14/08/2026",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("migration 0694", () => {
  const fs = require("fs");
  const path = require("path");
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "..", "migrations", "tenant", "0694_delivery_note_completion.sql"),
    "utf8",
  );

  it("adds the three columns", () => {
    for (const col of ["address", "phone", "delivery_date"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`));
    }
  });

  it("does NOT backfill delivery_date from created_at", () => {
    // A fabricated arrival date is indistinguishable from a real one, which is
    // precisely why this must stay absent.
    expect(sql).not.toMatch(/SET\s+delivery_date\s*=\s*created_at/i);
  });

  it("stops a blank line label at the database too", () => {
    expect(sql).toMatch(/chk_delivery_note_line_label/);
  });
});
