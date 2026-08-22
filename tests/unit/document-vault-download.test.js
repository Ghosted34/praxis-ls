"use strict";

/**
 * Two jobs here, and they are separate on purpose.
 *
 * CONTENT TYPE is the security-adjacent one: a stored PNG must not be served as
 * `application/pdf`. That is what the first two cases exist for, and it is
 * unchanged.
 *
 * FILENAME changed (22 Aug 2026). It used to be `${DOC_TYPE}-${doc_id}` — so a
 * download landed as `EMPLOYMENT_CONTRACT-3fa85f64-5717-4562-b3fc-2c963f66afa6.pdf`,
 * a UUID nobody recognises on a document that has a reference printed inside
 * it. It now prefers the allocated `doc_number`, then an upload's own
 * `original_name`, and falls back to a short id fragment. The expectations
 * below moved with it; the describe block at the bottom pins the new rule
 * deliberately rather than leaving it as a side effect of these two.
 */

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
      filename: "Entity document d1.png",
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
      filename: "Client document d2.jpg",
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

describe("download filename — a name a person can file (22 Aug 2026)", () => {
  const pdf = (doc) => fileMeta({ storage_path: "t/vault/x.pdf", ...doc }).filename;

  it("prefers the document's allocated number", () => {
    expect(pdf({ doc_type: "EMPLOYMENT_CONTRACT", doc_number: "CTR-2026-0007", doc_id: "3fa85f64-5717-4562" }))
      .toBe("Employment contract CTR-2026-0007.pdf");
  });

  it("gives an uploaded file its own name back, without doubling the extension", () => {
    expect(pdf({ doc_type: "SCAN", original_name: "Passport Amina.pdf", doc_id: "3fa85f64-5717" }))
      .toBe("Scan Passport Amina.pdf");
  });

  it("falls back to a SHORT id fragment, never the whole UUID", () => {
    const name = pdf({ doc_type: "FINAL_INVOICE", doc_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" });
    expect(name).toBe("Final invoice 3fa85f64.pdf");
    expect(name).not.toContain("2c963f66afa6");
  });

  it("cannot forge response headers through a stored name", () => {
    // This value goes into Content-Disposition. A quote or a CRLF in a
    // doc_number or an uploaded filename would otherwise let stored data
    // invent header structure.
    const name = pdf({ doc_type: "SCAN", doc_number: 'a"\r\nX-Evil: 1' });
    expect(name).not.toMatch(/[\r\n"]/);
    expect(name).toBe("Scan a X-Evil 1.pdf");
  });
});
