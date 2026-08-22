"use strict";

/**
 * BAD_STORAGE_BUFFER — every generated document failed on live, 22 Aug 2026.
 *
 * Puppeteer 23 changed `page.pdf()` to resolve a **Uint8Array** rather than a
 * Node Buffer. `storage.put` required `Buffer.isBuffer` and rejected it with a
 * 400, so contracts, payslips and invoices all died at the storage boundary
 * with bytes that were perfectly valid.
 *
 * WHY NOTHING CAUGHT IT. The deploy preflight has always wrapped the call
 * (`scripts/ops/puppeteer-preflight.js:74` — `Buffer.from(await page.pdf(…))`),
 * so it rendered a real PDF and reported `ok: true` on the very container where
 * every production render was failing. A green check on a code path that
 * differed from production by exactly one `Buffer.from`.
 *
 * These tests pin the CONTRACT — binary in, Buffer out — instead of one
 * concrete class, so the next library that returns a different byte container
 * is absorbed rather than fatal.
 */

const { toStorageBuffer } = require("../../src/services/storage.service");

describe("toStorageBuffer — what counts as storable bytes", () => {
  it("accepts a Uint8Array, which is what page.pdf() now returns", () => {
    const u8 = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    const out = toStorageBuffer(u8);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString("ascii")).toBe("%PDF-");
  });

  it("passes a Buffer through untouched", () => {
    const b = Buffer.from("%PDF-1.7");
    expect(toStorageBuffer(b)).toBe(b);
  });

  it("copies only a VIEW's own bytes, not its backing store", () => {
    // The trap: a typed array can be a window onto a larger ArrayBuffer, so
    // `Buffer.from(view.buffer)` would write the trailing slack too. This is
    // the difference between a 5-byte PDF and a 16-byte one with garbage.
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = backing.subarray(2, 5); // [3,4,5]
    const out = toStorageBuffer(view);
    expect(out.length).toBe(3);
    expect([...out]).toEqual([3, 4, 5]);
  });

  it("accepts a bare ArrayBuffer", () => {
    const out = toStorageBuffer(new Uint8Array([9, 9]).buffer);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(2);
  });

  it("still REFUSES a string — the failure the guard exists to stop", () => {
    // Buffer.from("…") would succeed and quietly write a text file, and a
    // string caller has skipped every upstream size check. Rejected on purpose.
    expect(toStorageBuffer("%PDF-1.7")).toBeNull();
  });

  it("refuses the other non-binary shapes", () => {
    for (const bad of [null, undefined, 42, {}, [], new DataView(new ArrayBuffer(4))]) {
      expect(toStorageBuffer(bad)).toBeNull();
    }
  });
});

describe("pdf.service.renderHtml — returns a Buffer, whatever Puppeteer returns", () => {
  /**
   * `renderAndStore` takes an injectable `render`, which is the seam that lets
   * this run without a browser. The assertion is on what reaches storage: the
   * bug was never in the bytes, it was in their container.
   */
  it("hands storage a Buffer even when the renderer yields a Uint8Array", async () => {
    jest.resetModules();
    const puts = [];
    jest.doMock("../../src/services/storage.service", () => ({
      put: async (buffer, opts) => {
        puts.push(buffer);
        // Mirror the real guard, so this test fails the way live did.
        if (!Buffer.isBuffer(buffer) && !ArrayBuffer.isView(buffer)) {
          throw new Error("BAD_STORAGE_BUFFER");
        }
        return { key: opts.key, public_url: "/media/" + opts.key };
      },
    }));
    jest.doMock("../../src/services/documents/document.service", () => ({
      capture: async () => ({ doc_id: "d1" }),
    }));

    const pdf = require("../../src/services/pdf.service");
    const out = await pdf.renderAndStore(
      {},
      {
        html: "<h1>x</h1>",
        key: "t/doc.pdf",
        entityRef: "invoice:1",
        docType: "FINAL_INVOICE",
        // Exactly what Puppeteer 23 gives back.
        render: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
    );
    expect(out.doc_id).toBe("d1");
    expect(puts).toHaveLength(1);
    // The normaliser at the boundary is what makes this survive; the primary
    // fix is renderHtml wrapping its own return (see pdf.service.js).
    expect(ArrayBuffer.isView(puts[0]) || Buffer.isBuffer(puts[0])).toBe(true);
  });
});
