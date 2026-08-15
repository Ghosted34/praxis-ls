"use strict";

const {
  fileMeta,
} = require("../../src/modules/vault/document_vault/document_vault.controller");

describe("document vault download metadata", () => {
  it("serves a PNG as an image instead of pretending it is a PDF", () => {
    expect(
      fileMeta({
        doc_id: "d1",
        doc_type: "ENTITY_DOCUMENT",
        storage_path: "tenant_demo/vault/doc_abc.png",
      }),
    ).toEqual({
      contentType: "image/png",
      extension: "png",
      filename: "ENTITY_DOCUMENT-d1.png",
    });
  });

  it("normalizes JPEG files to the browser-safe jpg extension", () => {
    expect(
      fileMeta({
        doc_id: "d2",
        doc_type: "CLIENT_DOCUMENT",
        storage_path: "tenant_demo/vault/doc_def.jpg",
      }),
    ).toMatchObject({
      contentType: "image/jpeg",
      extension: "jpg",
      filename: "CLIENT_DOCUMENT-d2.jpg",
    });
  });

  it("keeps PDFs inline", () => {
    expect(
      fileMeta({
        doc_id: "d3",
        doc_type: "FINAL_INVOICE",
        storage_path: "tenant_demo/vault/doc_ghi.pdf",
      }),
    ).toMatchObject({
      contentType: "application/pdf",
      extension: "pdf",
    });
  });
});
