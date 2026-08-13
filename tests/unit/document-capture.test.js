"use strict";
/** document.service capture: create-once, then update-in-sync (BUILD_CONVENTIONS §3). */
const { capture } = require("../../src/services/documents/document.service");

function fakeClient(existing) {
  const state = { row: existing || null, ops: [] };
  return {
    state,
    query: async (sql, params) => {
      if (/SELECT \* FROM document_vault WHERE entity_ref/.test(sql)) {
        return { rows: state.row ? [state.row] : [] };
      }
      if (/^INSERT INTO document_vault/.test(sql.trim())) {
        state.ops.push("insert");
        state.row = {
          doc_id: "d1",
          version_no: 1,
          entity_ref: params[0],
          storage_path: "x",
        };
        return { rows: [state.row] };
      }
      if (/^UPDATE document_vault/.test(sql.trim())) {
        state.ops.push("update");
        state.row = {
          ...state.row,
          version_no: state.row.version_no + 1,
          storage_path: params[1],
          content_hash: params[2] || state.row.content_hash,
        };
        return { rows: [state.row] };
      }
      return { rows: [] };
    },
  };
}

describe("document capture", () => {
  it("inserts once when none exists", async () => {
    const c = fakeClient(null);
    const row = await capture(c, {
      entityRef: "invoice:1",
      docType: "FINAL_INVOICE",
    });
    expect(c.state.ops).toEqual(["insert"]);
    expect(row.version_no).toBe(1);
  });
  it("updates the same row (version bumps) on re-capture", async () => {
    const c = fakeClient({
      doc_id: "d1",
      version_no: 1,
      entity_ref: "invoice:1",
    });
    const row = await capture(c, {
      entityRef: "invoice:1",
      storagePath: "vault/invoice-1.pdf",
      contentHash: "abc",
    });
    expect(c.state.ops).toEqual(["update"]);
    expect(row.version_no).toBe(2);
    expect(row.storage_path).toBe("vault/invoice-1.pdf");
  });
  it("requires entityRef", async () => {
    const c = fakeClient(null);
    await expect(capture(c, {})).rejects.toThrow(/entityRef/i);
  });
});
