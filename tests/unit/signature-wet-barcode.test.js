"use strict";

const bwipjs = require("bwip-js");
const kit = require("../../src/services/documents/templates/kit");
const barcode = require("../../src/services/signatures/barcode");

describe("wet-signature DataMatrix", () => {
  test("print codes use the 18-character Crockford alphabet and group only for display", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = barcode.mintCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{18}$/);
      expect(code).not.toMatch(/[ILOU]/);
      expect(barcode.normaliseCode(barcode.formatCode(code))).toBe(code);
    }
  });

  test("the renderer keeps the DataMatrix discreet and labels reprints", async () => {
    const code = "0123456789ABCDEFGH";
    const svg = await barcode.generateSvg(code);
    const html = kit.shell("wet", kit.printBarcode({ code, svg, reprintNo: 1 }), kit.defaults());

    expect(html).toContain(".wet-code .dm { width: 12mm; height: 12mm; padding: 2mm;");
    expect(html).toContain("opacity: 0.4");
    expect(html).toContain("font-size: 5pt");
    expect(html).toContain("012345-6789AB-CDEFGH");
    expect(html).toContain("Copy 1");
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

  test("a scan with no DataMatrix queues as NO_BARCODE instead of inventing a match", async () => {
    const png = await require("sharp")({
      create: { width: 240, height: 120, channels: 3, background: "white" },
    }).png().toBuffer();

    await expect(barcode.decode(png)).resolves.toEqual({ status: "NO_BARCODE", code: null });
  });
});
