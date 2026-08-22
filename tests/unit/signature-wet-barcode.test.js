"use strict";

const bwipjs = require("bwip-js");
const PDFDocument = require("pdfkit");
const barcode = require("../../src/services/signatures/barcode");

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

jest.setTimeout(30_000);

describe("wet-signature DataMatrix", () => {
  test("print codes use the 18-character Crockford alphabet and group only for display", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = barcode.mintCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{18}$/);
      expect(code).not.toMatch(/[ILOU]/);
      expect(barcode.normaliseCode(barcode.formatCode(code))).toBe(code);
    }
  });

  test("operator input accepts Crockford's ambiguous I/L/O spellings", () => {
    expect(barcode.normaliseCode("O12345-6789AB-CDEFGH")).toBe("0123456789ABCDEFGH");
    expect(barcode.normaliseCode("0I2345-6789AB-CDEFGH")).toBe("0123456789ABCDEFGH");
    expect(barcode.normaliseCode("0L2345-6789AB-CDEFGH")).toBe("0123456789ABCDEFGH");
  });

  test("the generated SVG paints modules as 40 percent grey ink", async () => {
    const svg = await barcode.generateSvg("0123456789ABCDEFGH");
    expect(svg).toContain("#999999");
    expect(svg).not.toContain("opacity");
  });

  test("a generated DataMatrix round-trips through the server-side decoder", async () => {
    const code = "0123456789ABCDEFGH";
    const png = await bwipjs.toBuffer({
      bcid: "datamatrix",
      text: code,
      scale: 8,
      paddingwidth: 40,
      paddingheight: 40,
      backgroundcolor: "FFFFFF",
    });

    await expect(barcode.decode(png)).resolves.toEqual({ status: "DECODED", code });
  });

  test("a scan-to-PDF is rasterised before decoding", async () => {
    const code = "0123456789ABCDEFGH";
    const png = await bwipjs.toBuffer({
      bcid: "datamatrix",
      text: code,
      scale: 10,
      paddingwidth: 40,
      paddingheight: 40,
      backgroundcolor: "FFFFFF",
    });
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    doc.image(png, 36, 680, { width: 80, height: 80 });
    const pdf = await collectPdf(doc);

    await expect(barcode.decode(pdf)).resolves.toEqual({ status: "DECODED", code });
  });

  test("a scan with no DataMatrix queues as NO_BARCODE instead of inventing a match", async () => {
    const png = await require("sharp")({
      create: { width: 240, height: 120, channels: 3, background: "white" },
    }).png().toBuffer();

    await expect(barcode.decode(new Uint8Array(png))).resolves.toEqual({ status: "NO_BARCODE", code: null });
  });

  test("a corrupt PDF reports the PDF opening failure rather than no barcode", async () => {
    const out = await barcode.decode(Buffer.from("%PDF-1.7\nnot a real pdf"));
    expect(out.status).toBe("UNREADABLE");
    expect(out.reason).toBe("PDF_RASTERIZE_FAILED");
  });
});
