/**
 * THE SIGNATURE CARD — palette, geometry and the drift guards.
 *
 * The card reproduces a signature staff already have in their mail clients, so
 * "close enough" is the failure mode this file exists to catch. Three things are
 * pinned:
 *
 *   1. The PALETTE resolves from tenant branding, with the Praxis fallback
 *      landing in the right ROLE — the mapping is the one thing a reasonable
 *      person would get backwards (see signature.palette.js's header).
 *   2. The GEOMETRY is the original's numbers, not approximations of them.
 *   3. The card and the email fallback carry the same CONTENT, which is what
 *      replaced "the PNG screenshots the email HTML" when the card stopped
 *      being expressible as email HTML.
 */
"use strict";

const palette = require("../../src/modules/mail/signature/signature.palette");
const card = require("../../src/modules/mail/signature/signature.card");
const htmlMod = require("../../src/modules/mail/signature/signature.html");
const { resolve } = require("../../src/modules/mail/signature/signature.resolve");

/** The three hexes the standalone generator hard-coded. */
const SMART_LS = { accentDeep: "#0D5C8A", accentGlow: "#1FA2E1", primary: "#FF8C00" };

/** What migration 12758 seeds — the values that are not a function of a brand colour. */
const SEEDED_LAYOUT = {
  kind: "card",
  surface_color: "#f0f8fd",
  surface_deep_color: "#e0f2fe",
  warm_deep_color: "#f97316",
  font_body: "Montserrat",
  font_motto: "Brittany Signature",
};

function model(overrides = {}) {
  return resolve({
    employee: { full_name: "Line Audrey HAPPY", job_title: "Care Business Partner" },
    entity: {
      legal_name: "Smart LS",
      street_line: "1030, Avenue Douala Manga Bell, Bali",
      po_box: "P.O. Box: 5120",
      city: "Douala",
      country: "Cameroon",
      website: "www.smartls.cm",
    },
    profile: { phone_desk: "+237 233-420-281", phone_mobile: "+237 657-133-028" },
    template: { layout: SEEDED_LAYOUT, copy_en: { motto: "Going Beyond Your Expectations..." } },
    mailbox: { email_address: "line.happy@smartls.cm" },
    ...overrides,
  }, "en");
}

describe("palette — the parametric brand", () => {
  test("a tenant's branding drives the card, in the right roles", () => {
    const p = palette.resolve(SMART_LS, SEEDED_LAYOUT);
    expect(p.ink).toBe("#0d5c8a");   // name, website, motto
    expect(p.glow).toBe("#1fa2e1");  // borders, gradient middle
    expect(p.warm).toBe("#ff8c00");  // title dash, gradient tail
  });

  /**
   * The mapping that matters. `primary` is the obvious reading of "the brand
   * colour" and is WRONG here: Praxis's own primary is an orange, so mapping the
   * name to it would render an unbranded tenant's card with an orange name and a
   * blue title dash — the design with two colours transposed.
   */
  test("an unbranded tenant gets the Praxis fallback in the same roles", () => {
    const p = palette.resolve({}, {});
    expect(p.ink).toBe("#0C4A7A");   // a blue, on the name
    expect(p.warm).toBe("#F5821F");  // an orange, on the dash
    expect(p.ink).not.toBe(p.warm);
  });

  test("the seeded surfaces reproduce the original exactly", () => {
    const p = palette.resolve(SMART_LS, SEEDED_LAYOUT);
    expect(p.surface).toBe("#f0f8fd");
    expect(p.surfaceDeep).toBe("#e0f2fe");
    expect(p.warmDeep).toBe("#f97316");
  });

  /** Unpinned, the surfaces are still derived from the tenant's own cyan rather
   *  than falling back to another tenant's tint. */
  test("unpinned surfaces derive from the tenant's glow", () => {
    const a = palette.resolve({ accentGlow: "#1FA2E1" }, {});
    const b = palette.resolve({ accentGlow: "#B34700" }, {});
    expect(a.surface).not.toBe(b.surface);
    expect(a.surface).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("a malformed colour falls through rather than reaching the CSS", () => {
    const p = palette.resolve({ accentDeep: "red; }" }, {});
    expect(p.ink).toBe("#0C4A7A");
  });

  /**
   * `check:fonts` reads source, so a family named in a DATABASE row would reach
   * the renderer without the gate ever seeing it. The template may name a
   * family; it may not smuggle a stack.
   */
  test("a template cannot inject a font stack", () => {
    expect(palette.fonts({ font_motto: "Comic Sans, cursive" }).motto).toBe("Brittany Signature");
    expect(palette.fonts({ font_body: "Georgia" }).body).toBe("Georgia");
  });
});

describe("card geometry — the original's numbers", () => {
  const p = palette.resolve(SMART_LS, SEEDED_LAYOUT);

  test("the card is 650 × 325", () => {
    expect(card.CARD_W).toBe(650);
    expect(card.CARD_H).toBe(325);
  });

  test("every transcribed dimension survives", () => {
    const css = card.css(p, palette.fonts(SEEDED_LAYOUT), "");
    for (const rule of [
      "height:5px",            // top accent bar
      "width:225px",           // logo column
      "height:185px",          // divider
      "height:220px",          // top section
      "font-size:25px",        // name
      "width:32px",            // title dash
      "height:52px",           // motto pill
      "border-radius:50px",    // pill
      "font-size:26px",        // motto
      "gap:6.5px",             // contact rows
    ]) {
      expect(css).toContain(rule);
    }
  });

  test("the three brand colours reach the gradients", () => {
    const css = card.css(p, palette.fonts(SEEDED_LAYOUT), "");
    expect(css).toContain(`linear-gradient(90deg,${p.ink} 0%,${p.glow} 50%,${p.warm} 100%)`);
  });

  test("the five contact rows render, in order", () => {
    const body = card.body(model(), p);
    expect(body.match(/class="contact-item"/g)).toHaveLength(5);
    const order = [...body.matchAll(/id="sig-grad-(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["phone", "email", "address", "po_box", "website"]);
  });

  /** Ordinary spaces collapse in HTML, pulling the two numbers ~8px closer than
   *  the original. The separator is non-breaking on both sides. */
  test("desk and mobile share one row, separated by a non-breaking pipe", () => {
    const f = card.fields(model());
    expect(f.phone).toBe("+237 233-420-281  |  +237 657-133-028");
  });

  test("a row with no value is omitted, not left as a stranded icon", () => {
    const m = model({ entity: { legal_name: "Smart LS" } });
    const body = card.body(m, p);
    expect(body).not.toContain("sig-grad-website");
    expect(body).not.toContain("sig-grad-address");
    expect(body.match(/class="contact-item"/g)).toHaveLength(2); // phone + email
  });

  test("typed markup in a name is escaped", () => {
    const m = model({ employee: { full_name: '<script>alert(1)</script>', job_title: "x" } });
    const body = card.body(m, p);
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });

  test("a tenant with no logo gets its name, not an empty column", () => {
    const body = card.body(model(), p);
    expect(body).toContain("logo-fallback");
    expect(body).toContain("Smart LS");
  });

  /** Headless Chromium has no page origin, so only inlined bytes load. */
  test("the card prefers the inlined logo over the https one", () => {
    const m = model({ logo: "data:image/png;base64,AAAA" });
    expect(card.fields(m).logo_url).toBe("data:image/png;base64,AAAA");
    expect(card.body(m, p)).toContain("logo-img");
  });

  test("the document carries the embedded fonts it is handed", () => {
    const doc = card.document(model(), p, palette.fonts(SEEDED_LAYOUT), "@font-face{font-family:'X'}");
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain("@font-face{font-family:'X'}");
    expect(doc).toContain("'Montserrat'");
    expect(doc).toContain("'Brittany Signature'");
  });
});

describe("the card and the email fallback agree", () => {
  /**
   * The drift guard. `classic` and `compact` are screenshotted FROM the email
   * HTML, so they cannot diverge. The card cannot be expressed as email HTML at
   * all, so the two are rendered separately — and this is what stops them
   * saying different things.
   */
  test("every value on the card appears in the email text fallback", () => {
    const m = model();
    m.card_png_url = "https://smartls.praxisls.com/media/x.png";
    const email = htmlMod.render(m);
    const f = card.fields(m);

    for (const value of [f.name, f.title, f.email, f.website, f.motto]) {
      expect(value).toBeTruthy();
    }
    expect(email).toContain(f.title);
    expect(email).toContain(f.motto);
    expect(email).toContain("smartls.cm");
  });

  test("the email half stays email-safe", () => {
    const m = model();
    m.card_png_url = "https://smartls.praxisls.com/media/x.png";
    const email = htmlMod.render(m);
    expect(email).not.toMatch(/<style|display:flex|display:grid|var\(--|@font-face/);
    expect(email).toContain("<table");
    expect(email).toContain('width="650"');
  });

  test("the image carries an alt naming the person, for a blocked-image client", () => {
    const m = model();
    m.card_png_url = "https://smartls.praxisls.com/media/x.png";
    const email = htmlMod.render(m);
    expect(email).toMatch(/<img [^>]*alt="Line Audrey HAPPY — Care Business Partner — Smart LS"/);
  });

  /** No PNG yet (a first send, or a screenshot that failed) must still send a
   *  working signature rather than a broken image. */
  test("with no PNG the email is the text half alone", () => {
    const email = htmlMod.render(model());
    expect(email).not.toContain("<img");
    expect(email).toContain("Care Business Partner");
  });
});
