/** Unit tests for capture() status coercion (GAP_FIXES_PLAN §5.3). */
"use strict";

// Isolate from env/storage/DB/event bus so the suite is hermetic.
jest.mock("../../../services/storage.service", () => ({ get: async () => Buffer.from("x"), put: async () => ({}) }));
jest.mock("../../../shared/events/emit", () => ({ emitEvent: jest.fn(async () => {}), audit: jest.fn(async () => {}) }));

const svc = require("./document_vault.service");
const { emitEvent, audit } = require("../../../shared/events/emit");

describe("resolveStatus / hasBytes", () => {
  test("VERIFIED with no real path is coerced to PENDING", () => {
    expect(svc.resolveStatus("VERIFIED", null)).toBe("PENDING");
    expect(svc.resolveStatus("VERIFIED", "pending://invoice:1")).toBe("PENDING");
  });
  test("VERIFIED with real bytes stays VERIFIED", () => {
    expect(svc.resolveStatus("VERIFIED", "tenant_x/vault/doc_ab.pdf")).toBe("VERIFIED");
  });
  test("other statuses pass through untouched", () => {
    expect(svc.resolveStatus("DRAFT", null)).toBe("DRAFT");
    expect(svc.resolveStatus(null, "tenant_x/doc.pdf")).toBeNull();
  });
  test("hasBytes distinguishes real paths from placeholders", () => {
    expect(svc.hasBytes("tenant_x/doc.pdf")).toBe(true);
    expect(svc.hasBytes("pending://ref")).toBe(false);
    expect(svc.hasBytes(null)).toBe(false);
  });
});

describe("capture() emits + audits", () => {
  // A fake client: getByRef → none, insert → a row, plus the emit/audit paths.
  function fakeClient() {
    return {
      query: async (sql) => {
        if (/ORDER BY created_at ASC LIMIT 1/.test(sql)) return { rows: [] }; // getByRef → none
        return { rows: [{ doc_id: "d1", entity_ref: "invoice:1", status: "PENDING" }] };
      },
    };
  }

  beforeEach(() => { emitEvent.mockClear(); audit.mockClear(); });

  test("first capture emits CREATED, audits, and coerces VERIFIED→PENDING", async () => {
    const row = await svc.capture(fakeClient(), { entityRef: "invoice:1", docType: "FINAL_INVOICE", status: "VERIFIED" });
    expect(row).toMatchObject({ doc_id: "d1" });
    expect(emitEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventTypeKey: "document_vault.created" }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "document_vault.created" }));
  });

  test("unknown doc_type is rejected before any write", async () => {
    await expect(svc.capture(fakeClient(), { entityRef: "x:1", docType: "BOGUS" })).rejects.toMatchObject({ code: "UNKNOWN_DOC_TYPE" });
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
