/**
 * Embedded document fonts (src/services/pdf.fonts.js).
 *
 * These assertions exist because the failure they guard is invisible: a PDF
 * whose font never loaded still renders, just in something else. Every invoice
 * this system has produced came out in FreeSans while the template said
 * 'Noto Sans' — nothing errored, nothing logged, and the only way to notice was
 * to look at a document and know what it should have looked like.
 */
"use strict";

const { fontFaceCss, PDF_FONT_BODY, PDF_FONT_MONO, __reset } = require("../../src/services/pdf.fonts");
const { buildInvoiceHtml } = require("../../src/services/pdf.templates");

beforeEach(() => __reset());

describe("embedded PDF fonts", () => {
  it("embeds the font binary, not just the name", () => {
    const css = fontFaceCss();
    const faces = css.match(/@font-face/g) || [];
    expect(faces.length).toBeGreaterThanOrEqual(4); // latin + latin-ext, two families

    // A data URI with real payload. A @font-face pointing at a path the renderer
    // cannot reach is the same silent substitution, dressed up.
    const uris = css.match(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g) || [];
    expect(uris.length).toBe(faces.length);
    for (const uri of uris) expect(uri.length).toBeGreaterThan(1000);
  });

  it("declares only families from the shipped library", () => {
    const families = [...new Set([...fontFaceCss().matchAll(/font-family:'([^']+)'/g)].map((m) => m[1]))];
    expect(families.sort()).toEqual(["JetBrains Mono", "Noto Sans"]);
  });

  /** Variable fonts carry the whole weight range in one file — a template asking
   *  for bold must get the real bold, not a synthesised smear. */
  it("covers the full weight range from a single face", () => {
    expect(fontFaceCss()).toMatch(/font-weight:100 900/);
  });

  it("names no font outside the library in the stacks templates use", () => {
    for (const stack of [PDF_FONT_BODY, PDF_FONT_MONO]) {
      for (const part of stack.split(",")) {
        const family = part.trim().replace(/^'|'$/g, "");
        expect(["Noto Sans", "JetBrains Mono", "sans-serif", "monospace"]).toContain(family);
      }
    }
  });

  it("memoises — the files are read once, not once per document", () => {
    expect(fontFaceCss()).toBe(fontFaceCss());
  });

  /** The reason it never throws: these run on the invoice path. A document that
   *  falls back is cosmetic; a document that fails to generate is an outage. */
  it("survives a missing font file rather than failing the document", () => {
    const fs = require("fs");
    const spy = jest.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => fontFaceCss()).not.toThrow();
    expect(fontFaceCss()).toBe("");
    spy.mockRestore();
  });
});

describe("generated documents carry the faces", () => {
  it("puts the @font-face rules in the invoice HTML itself", () => {
    const html = buildInvoiceHtml({
      doc_number: "SLAS-2026-0142",
      entity: "Smart Logistics",
      client: "ACME",
      lines: [{ label: "Freight", line_ht: 100 }],
      totals: { service_ht: 100, debours_total: 0, vat_total: 19.25 },
    });
    expect(html).toContain("@font-face");
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).toContain("font-family:'Noto Sans', sans-serif");
    // The pre-library names must be gone: neither was ever present in the
    // rendering container, and Noto Sans Mono is not one of the fifteen.
    expect(html).not.toContain("Noto Sans Mono");
    expect(html).not.toContain("Arial");
  });
});
