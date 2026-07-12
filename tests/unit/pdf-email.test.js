"use strict";
/** PDF (hash/QR/template/render-store) + email send — Chromium/SMTP isolated. */
jest.mock("../../src/services/storage.service", () => ({
  put: jest
    .fn()
    .mockResolvedValue({
      key: "vault/tenant/inv1.pdf",
      public_url: "/media/vault/tenant/inv1.pdf",
      size: 10,
    }),
}));
jest.mock("../../src/services/documents/document.service", () => ({
  capture: jest.fn().mockResolvedValue({ doc_id: "d1" }),
}));

const pdf = require("../../src/services/pdf.service");
const templates = require("../../src/services/pdf.templates");
const email = require("../../src/services/email.service");
const storage = require("../../src/services/storage.service");
const documents = require("../../src/services/documents/document.service");

describe("pdf content hash + verify token", () => {
  it("sha256 hex is stable for identical bytes", () => {
    const h1 = pdf.contentHash(Buffer.from("hello"));
    const h2 = pdf.contentHash(Buffer.from("hello"));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
  it("verify token embeds entityRef + hash prefix", () => {
    expect(pdf.verifyToken("invoice:1", "abcdef0123456789ff")).toBe(
      "praxis://verify/invoice:1?h=abcdef0123456789",
    );
  });
});

describe("invoice template", () => {
  it("renders number, totals and escapes html", () => {
    const html = templates.buildInvoiceHtml({
      doc_number: "INV-2026-00001",
      client: "<ACME>",
      lines: [{ label: "Transport", line_ht: 1500000 }],
      totals: { service_ht: 2000000, vat_total: 385000, total_ttc: 10385000 },
      verify: "praxis://verify/x",
    });
    expect(html).toContain("INV-2026-00001");
    expect(html).toContain("&lt;ACME&gt;"); // escaped
    expect(html).toContain("385"); // vat figure present
    expect(html).toContain("praxis://verify/x");
  });
});

describe("renderAndStore", () => {
  it("renders (injected), stores, and captures the document with the hash", async () => {
    const client = {};
    const fakeRender = jest
      .fn()
      .mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
    const r = await pdf.renderAndStore(client, {
      html: "<h1>x</h1>",
      key: "vault/tenant/inv1.pdf",
      entityRef: "invoice:inv1",
      docType: "FINAL_INVOICE",
      render: fakeRender,
    });
    expect(fakeRender).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalled();
    expect(documents.capture).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        entityRef: "invoice:inv1",
        docType: "FINAL_INVOICE",
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(r.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.verify).toContain("praxis://verify/invoice:inv1");
  });
});

describe("email send", () => {
  it("sends via an injected transport with a default from", async () => {
    const tx = { sendMail: jest.fn().mockResolvedValue({ messageId: "m1" }) };
    const r = await email.send(
      undefined,
      { to: "a@b.com", subject: "Hi", html: "<p>x</p>" },
      tx,
    );
    expect(tx.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@b.com",
        from: expect.stringContaining("no-reply@"),
      }),
    );
    expect(r.messageId).toBe("m1");
  });
  it("rejects without a recipient", async () => {
    await expect(
      email.send({ subject: "x" }, { sendMail: jest.fn() }),
    ).rejects.toThrow(/to/);
  });
});
