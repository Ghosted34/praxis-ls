"use strict";

const k = require("../../src/services/documents/templates/kit");
const qr = require("../../src/services/signatures/qr");

const SIG = {
  forParty: "SMART LOGISTICS SARL",
  position: { n: 1, of: 2 },
  reason: "Approved for dispatch",
  signerName: "Jean Mbarga",
  signerRole: "Commercial Director",
  signedAt: "20 Aug 2026 14:35 WAT",
  method: "Verified by email code",
  docRef: "WAYBILL-8842-A",
  contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  code: "A4B7K92MXQ1P",
  qrSvg: '<svg viewBox="0 0 41 41"></svg>',
};

describe("the seal — what it MUST NOT print (§3.12)", () => {
  const html = k.sealBlock(SIG, { language: "en" });

  test("no verdict word, in any form", () => {
    // A static PDF cannot know it is valid: validity depends on amendment and
    // revocation, both of which happen AFTER printing. A revoked signature
    // would otherwise carry a green VALID badge on every copy in existence,
    // forever. The seal states what it IS; the portal states what it
    // EVALUATES TO. This test is what stops a well-meaning "let's add a tick".
    for (const word of ["VALID", "Valid", "VERIFIED", "AUTHENTIC", "✓", "✔"]) {
      expect(html).not.toContain(word);
    }
  });

  test("no IP address — §3.13", () => {
    // The function has no parameter for one, so the only way an IP could reach
    // the page is via another field. Assert the shape, not the absence of a key.
    expect(html).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    const leaky = k.sealBlock({ ...SIG, signerRole: "Director 197.210.44.12" }, { language: "en" });
    // If somebody smuggles one through a text field it is at least escaped and
    // visible in review rather than silently formatted as evidence.
    expect(leaky).toContain("197.210.44.12");
    expect(Object.keys(SIG)).not.toContain("ip");
  });

  test("no vendor name — the product is white-label", () => {
    expect(html.toLowerCase()).not.toContain("praxis");
  });

  test("no engineering vocabulary — a court should not need a glossary", () => {
    for (const token of ["AES_OTP", "SES", "QES_", "content_hash", "sha256", "STAMP", "DRAWN"]) {
      expect(html).not.toContain(token);
    }
  });

  test("the hash is truncated to 16 and labelled", () => {
    expect(html).toContain("content e3b0c44298fc1c14");
    expect(html).not.toContain(SIG.contentHash); // never the full digest
  });
});

describe("the seal — what it must say", () => {
  const en = k.sealBlock(SIG, { language: "en" });
  const fr = k.sealBlock(SIG, { language: "fr" });

  test("declares whose side it speaks for", () => {
    // A countersigned document carries two seals; without this line they are
    // indistinguishable on the page.
    expect(en).toContain("For SMART LOGISTICS SARL");
    expect(fr).toContain("Pour SMART LOGISTICS SARL");
  });

  test("states the position in the chain", () => {
    expect(en).toContain("1 of 2");
    expect(fr).toContain("1 sur 2");
  });

  test("omits the position for a lone signature", () => {
    const lone = k.sealBlock({ ...SIG, position: { n: 1, of: 1 } }, { language: "en" });
    expect(lone).not.toContain("1 of 1");
    expect(k.sealBlock({ ...SIG, position: null }, { language: "en" })).not.toContain('class="pos"');
  });

  test("leads with the attestation, then the signer", () => {
    expect(en.indexOf("Approved for dispatch")).toBeLessThan(en.indexOf("Jean Mbarga"));
    expect(en).toMatch(/class="reason">Approved for dispatch/);
  });

  test("carries the verification code inside the seal border, grouped for reading", () => {
    expect(en).toContain("A4B7-K92M-XQ1P");
    const sealOnly = en.slice(en.indexOf('<div class="seal">'), en.lastIndexOf("</div>"));
    expect(sealOnly).toContain("A4B7-K92M-XQ1P");
    expect(sealOnly).toContain("<svg");
  });
});

describe("the seal — the DRAWN variant", () => {
  const drawn = k.sealBlock(
    { ...SIG, markImageB64: "data:image/png;base64,iVBORw0KGgo=" },
    { language: "en" },
  );

  test("puts the drawn mark in the attestation slot, with the name under it", () => {
    expect(drawn).toContain('class="drawn"');
    expect(drawn.indexOf('class="drawn"')).toBeLessThan(drawn.indexOf("Jean Mbarga"));
  });

  test("keeps the same evidence rows, so the block holds one shape and one height", () => {
    expect(drawn).toContain("20 Aug 2026 14:35 WAT · Verified by email code");
    expect(drawn).toContain("content e3b0c44298fc1c14");
  });
});

describe("the seal — escaping", () => {
  test("escapes everything a signer can influence", () => {
    const nasty = k.sealBlock(
      { ...SIG, signerName: '<script>alert(1)</script>', signerRole: 'a"b', reason: "R&D" },
      { language: "en" },
    );
    expect(nasty).not.toContain("<script>");
    expect(nasty).toContain("&lt;script&gt;");
    expect(nasty).toContain("R&amp;D");
  });
});

describe("the seal — geometry invariants", () => {
  // These lock two bugs that only a RENDER caught, never a read-through. Both
  // shipped in the first draft and were invisible in the HTML.
  const css = k.shell("x", "", {}).match(/<style>([\s\S]*?)<\/style>/)[1];

  test("the seal clips as a backstop, so nothing can escape the border", () => {
    // BUG 1: max-height alone does not clip. A long signer name pushed the
    // evidence rows visibly OUTSIDE the seal's border on the printed page.
    expect(css).toMatch(/\.seal\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.seal\s*\{[^}]*max-height:\s*34mm/);
  });

  test("evidence rows are 5.5pt, which is what stops them wrapping", () => {
    // BUG 2: at 6pt a monospace character is ~1.27mm, so the 45-character
    // date+method line needed ~58mm against a 58.5mm column — and wrapped,
    // orphaning the last word. Raising this back to 6pt reintroduces it.
    expect(css).toMatch(/\.seal \.ev\s*\{[^}]*font-size:\s*5\.5pt/);
  });

  test("the drawn variant does not promote the name to the reason's size", () => {
    // BUG 1's cause: styling the name as .reason (9pt semibold) made a
    // real-length name wrap and pushed the block past 34mm.
    const drawn = k.sealBlock({ ...SIG, markImageB64: "data:image/png;base64,x" }, { language: "en" });
    expect(drawn).toContain('class="who-drawn"');
    expect(drawn).not.toMatch(/class="reason">Aïssatou|class="reason">Jean/);
    expect(css).toMatch(/\.seal \.who-drawn\s*\{[^}]*font-size:\s*7\.5pt/);
  });
});

describe("the QR — measured, not assumed", () => {
  test("the short URL stays at or under 33 modules", async () => {
    // At 22mm that is 0.67mm per module. A phone camera wants >=0.5mm at arm's
    // length and 300dpi print needs >=0.34mm, so this clears both with margin —
    // which the long-token form (45 modules, 0.49mm) did not.
    const modules = await qr.moduleCount("https://smartlogistics.cm/v/A4B7K92MXQ1P");
    expect(modules).toBeLessThanOrEqual(33);
    expect(22 / modules).toBeGreaterThan(0.5);
  });

  test("renders inline SVG sized in millimetres, with its quiet zone intact", async () => {
    const svg = await qr.svg("https://smartlogistics.cm/v/A4B7K92MXQ1P", { sizeMm: 22 });
    expect(svg).toContain('width="22mm"');
    expect(svg).toContain('height="22mm"');
    expect(svg).toContain("crispEdges");
    // 33 modules + 4 quiet-zone modules on each side = 41.
    expect(svg).toMatch(/viewBox="0 0 41 41"/);
  });
});
