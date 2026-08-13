"use strict";
const service = require("../../src/modules/vault/document_verification/document_verification.service");

describe("public QR scan (MOD-66)", () => {
  const fakeClient = (row) => ({
    query: async () => ({ rows: row ? [row] : [] }),
  });

  test("scan returns only minimal verdict fields", async () => {
    const client = fakeClient({
      content_hash: "abcd1234abcd1234",
      doc_type: "FINAL_INVOICE",
      version_no: 2,
    });
    const r = await service.scan(client, {
      docId: "d1",
      hash: "abcd1234abcd1234",
    });
    expect(r).toEqual({
      verified: true,
      doc_type: "FINAL_INVOICE",
      version_no: 2,
    });
    expect(r.content_hash).toBeUndefined();
    expect(r.entity_ref).toBeUndefined();
  });

  test("scan reports tamper when hash mismatches", async () => {
    const client = fakeClient({
      content_hash: "aaaaaaaaaaaaaaaa",
      doc_type: "FINAL_INVOICE",
      version_no: 1,
    });
    const r = await service.scan(client, {
      docId: "d1",
      hash: "ffffffffffffffff",
    });
    expect(r.verified).toBe(false);
  });
});
