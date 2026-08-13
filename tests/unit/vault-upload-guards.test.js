"use strict";
/**
 * What may be attached to an operations file.
 *
 * WHY THE SNIFF. The data URL's declared content type is the UPLOADER's claim,
 * relayed from whatever the operating system guessed off the extension. Legacy
 * checked the actual bytes for exactly this reason (`upload.php:98-105`) and
 * renaming an executable to `.pdf` is the oldest trick there is. The declared
 * type decides the stored extension; the sniffed type decides whether the bytes
 * are stored at all.
 *
 * WHY THE LIMITS ARE PER-CALLER AND NOT GLOBAL. The vault holds HR files,
 * finance scans and signed contracts at 25 MB across a wide type list. Legacy's
 * operations limits — 5 MB, PDF/PNG/JPG — are right for a bill of lading and
 * would be a silent regression everywhere else, so they are passed in by the
 * one caller they belong to rather than tightened for everybody.
 */
const service = require("../../src/modules/vault/document_vault/document_vault.service");

jest.mock("../../src/services/storage.service", () => ({
  put: jest.fn(async () => {}),
  get: jest.fn(async () => Buffer.from("")),
}));

/** Only the two statements this path issues. Anything else is a bug in the test. */
const fakeClient = () => ({
  rows: [],
  async query(sql) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [] };
    if (/^INSERT INTO "?document_vault"?/i.test(s)) return { rows: [{ doc_id: "v1", doc_type: "BL" }] };
    if (/event_log|immutable_ledger|audit|outbox|event_type|app_user/i.test(s)) return { rows: [{ id: 1 }] };
    throw new Error("Unmatched SQL in fakeClient: " + s.slice(0, 160));
  },
});

const dataUrl = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

/** Real magic numbers — the point of the test is that the CONTENTS decide. */
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0)]);

const opsUpload = (overrides = {}) => ({
  dataUrl: dataUrl("application/pdf", PDF),
  dossierId: "d1",
  slug: "acme",
  actor: { user_id: "u1" },
  maxBytes: 5 * 1024 * 1024,
  allowedTypes: ["application/pdf", "image/png", "image/jpeg", "image/jpg"],
  sniff: true,
  ...overrides,
});

describe("uploading to an operations file", () => {
  it("takes a real PDF", async () => {
    const row = await service.createDocument(fakeClient(), opsUpload());
    expect(row.doc_id).toBe("v1");
  });

  it("takes a real PNG", async () => {
    const row = await service.createDocument(fakeClient(), opsUpload({ dataUrl: dataUrl("image/png", PNG) }));
    expect(row.doc_id).toBe("v1");
  });

  it("refuses an executable wearing a .pdf content type", async () => {
    // The whole reason the sniff exists.
    await expect(
      service.createDocument(fakeClient(), opsUpload({ dataUrl: dataUrl("application/pdf", EXE) })),
    ).rejects.toThrow(/not a PDF or an image/);
  });

  it("refuses a file whose contents contradict what it says it is", async () => {
    await expect(
      service.createDocument(fakeClient(), opsUpload({ dataUrl: dataUrl("application/pdf", PNG) })),
    ).rejects.toThrow(/says it is application\/pdf but its contents are image\/png/);
  });

  it("refuses a type that is not on the list, whatever its bytes say", async () => {
    await expect(
      service.createDocument(fakeClient(), opsUpload({ dataUrl: dataUrl("text/csv", "a,b,c") })),
    ).rejects.toThrow(/Only application\/pdf/);
  });

  it("refuses anything over 5 MB", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(6 * 1024 * 1024, 0x20)]);
    await expect(
      service.createDocument(fakeClient(), opsUpload({ dataUrl: dataUrl("application/pdf", big) })),
    ).rejects.toThrow(/exceeds 5 MB/);
  });

  it("still refuses an empty file", async () => {
    await expect(
      service.createDocument(fakeClient(), opsUpload({ dataUrl: "data:application/pdf;base64," })),
    ).rejects.toThrow(/Expected a base64 data URL|empty/i);
  });
});

describe("uploading anywhere else is unchanged", () => {
  it("keeps the vault's 25 MB and wider type list when no caller narrows them", async () => {
    // An HR contract as .docx, 8 MB: refused by the operations rules, accepted
    // here. Tightening the vault globally would have been a silent regression
    // in modules this work has no business touching.
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const row = await service.createDocument(fakeClient(), {
      dataUrl: dataUrl(docx, Buffer.alloc(8 * 1024 * 1024, 0x41)),
      entityRef: "employee:e1",
      slug: "acme",
      actor: { user_id: "u1" },
    });
    expect(row.doc_id).toBe("v1");
  });

  it("does not sniff when it was not asked to", async () => {
    // No `sniff`, so a text file declared as text is stored as one — the
    // pre-existing behaviour every other caller relies on.
    const row = await service.createDocument(fakeClient(), {
      dataUrl: dataUrl("text/plain", "hello"),
      entityRef: "note:1",
      slug: "acme",
      actor: {},
    });
    expect(row.doc_id).toBe("v1");
  });
});
