"use strict";
const { restore, termsIn } = require("../../src/modules/mail/assist/assist.glossary");

describe("protected terms", () => {
  test("FOB, 40HC, SLAS-2026-0042 and compte 411 survive translation", () => {
    const original = "FOB Douala, 40HC, SLAS-2026-0042, compte 411";
    const rewritten = "Franco à bord à Douala, conteneur haut, le dossier, le compte client.";
    const r = restore(original, rewritten);
    expect(termsIn(original)).toEqual(expect.arrayContaining(["FOB", "40HC", "SLAS-2026-0042", "compte 411"]));
    expect(r.text).toMatch(/\bFOB\b/);
    expect(r.text).toMatch(/40HC/);
    expect(r.text).toMatch(/SLAS-2026-0042/);
    expect(r.text).toMatch(/compte 411/);
  });
});
