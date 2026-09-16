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

/**
 * RE-POINTING A ROLE — the tenant whose deep accent IS their orange.
 *
 * The default mapping is right for a brand whose `accentDeep` is its dark
 * colour. Smart LS's is; a tenant whose is an orange gets an orange name and,
 * before `<role>_from`, no way to change it that did not also move that orange
 * through the whole product. These tests pin the two halves that make the
 * re-point safe: it beats a pin nobody can see, and it drops the pins that were
 * hand-picked to pair with the colour it replaced.
 */
describe("palette — pointing a role at another brand colour", () => {
  /** A brand whose deep accent is the orange and whose blue is `secondary`. */
  const TRANSPOSED = {
    primary: "#F5821F",
    secondary: "#0C4A7A",
    accentDeep: "#F5821F",
    accentGlow: "#34AAE2",
  };

  test("the name follows the brand colour it is pointed at", () => {
    const before = palette.resolve(TRANSPOSED, SEEDED_LAYOUT);
    expect(before.ink).toBe("#f5821f"); // the orange nobody chose for a name

    const after = palette.resolve(TRANSPOSED, { ...SEEDED_LAYOUT, ink_from: "secondary" });
    expect(after.ink).toBe("#0c4a7a");
    // Only `ink` moves — a re-point is one role, not a new palette.
    expect(after.warm).toBe(before.warm);
    expect(after.glow).toBe(before.glow);
  });

  /**
   * The re-point sits ABOVE the pin. If it did not, picking a swatch on a
   * template that happens to carry `ink_color` would do nothing and nothing
   * would say why.
   */
  test("a re-point beats a pinned hex, and clearing it gives the pin back", () => {
    const pinned = { ...SEEDED_LAYOUT, ink_color: "#123456" };
    expect(palette.resolve(TRANSPOSED, pinned).ink).toBe("#123456");
    expect(palette.resolve(TRANSPOSED, { ...pinned, ink_from: "secondary" }).ink).toBe("#0c4a7a");
    // Clearing is removing the key — the pin was never destroyed.
    expect(palette.resolve(TRANSPOSED, pinned).ink).toBe("#123456");
  });

  /**
   * The seeded card pins #f97316 beside an ORANGE warm and two cyan tints beside
   * a CYAN glow. Those are the second half of a pair, not colours in their own
   * right: keep them after the first half moves and the title dash renders blue
   * fading into orange.
   */
  test("re-pointing warm drops the deep orange that was picked to pair with it", () => {
    const p = palette.resolve(TRANSPOSED, { ...SEEDED_LAYOUT, warm_from: "secondary" });
    expect(p.warm).toBe("#0c4a7a");
    expect(p.warmDeep).not.toBe("#f97316");
    expect(p.warmDeep).toBe(palette.shade("#0c4a7a", 0.1));
  });

  test("re-pointing glow re-derives the surfaces it tints", () => {
    const p = palette.resolve(TRANSPOSED, { ...SEEDED_LAYOUT, glow_from: "primary" });
    expect(p.surface).not.toBe("#f0f8fd");
    expect(p.surface).toBe(palette.tint("#f5821f", 0.065));
    expect(p.surfaceDeep).toBe(palette.tint("#f5821f", 0.135));
  });

  /** A role nobody touched keeps its pins exactly. This is what lets the seeded
   *  card go on reproducing the original hex for hex. */
  test("an untouched template still renders its seeded hexes", () => {
    const p = palette.resolve(SMART_LS, { ...SEEDED_LAYOUT, ink_from: "secondary" });
    expect(p.surface).toBe("#f0f8fd");
    expect(p.surfaceDeep).toBe("#e0f2fe");
    expect(p.warmDeep).toBe("#f97316");
  });

  /** `layout` is a JSON blob an administrator can PATCH. A typo in it has to
   *  degrade to the default mapping, never to an empty colour in the CSS. */
  test("a name that is not a brand colour is ignored", () => {
    for (const junk of ["chartreuse", "#0c4a7a", "", null, "Primary"]) {
      expect(palette.resolve(TRANSPOSED, { ink_from: junk }).ink).toBe("#f5821f");
    }
  });

  test("roles() reports what the editor draws", () => {
    const rows = palette.roles(TRANSPOSED, { ...SEEDED_LAYOUT, ink_from: "secondary" });
    expect(rows.map((r) => r.role)).toEqual(["ink", "glow", "warm"]);

    const ink = rows.find((r) => r.role === "ink");
    expect(ink).toMatchObject({
      source: "secondary",
      default_source: "accentDeep",
      is_repointed: true,
      hex: "#0c4a7a",
    });
    // An untouched role reports the default as its live source, not as a change.
    expect(rows.find((r) => r.role === "warm")).toMatchObject({
      source: "primary",
      is_repointed: false,
    });
  });

  /**
   * The swatch a person picks and the colour the card paints come from ONE
   * function, so a tenant who has never opened Appearance can still re-point.
   */
  test("swatches and the card agree, set or unset", () => {
    const all = palette.swatches({ primary: "#FF8C00" });
    expect(all.find((s) => s.key === "primary")).toMatchObject({ hex: "#ff8c00", is_set: true });

    const unset = all.find((s) => s.key === "secondary");
    expect(unset.is_set).toBe(false);
    expect(palette.resolve({ primary: "#FF8C00" }, { ink_from: "secondary" }).ink).toBe(unset.hex);
  });

  /**
   * The validator repeats the key list rather than importing this module, so
   * that it stays a plain schema file. This is the guard that keeps the two
   * lists the same — an enum that drifts is an endpoint that refuses a colour
   * the editor is offering.
   */
  test("the wire schema accepts exactly the brand colours the palette knows", () => {
    const { schemas } = require("../../src/modules/mail/signature/signature.validator");
    const accepted = schemas.palette.innerType().shape.ink.unwrap().unwrap().options;
    expect([...accepted].sort()).toEqual([...palette.BRAND_KEYS].sort());
  });

  /** PRAXIS_FALLBACK is the role-shaped view of BRAND_FALLBACK. Two literals
   *  that must agree, so they are asserted against each other rather than both
   *  against a third copy. */
  test("the two fallback tables are one palette", () => {
    expect(palette.PRAXIS_FALLBACK.ink).toBe(palette.BRAND_FALLBACK.accentDeep);
    expect(palette.PRAXIS_FALLBACK.glow).toBe(palette.BRAND_FALLBACK.accentGlow);
    expect(palette.PRAXIS_FALLBACK.warm).toBe(palette.BRAND_FALLBACK.primary);
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
  /**
   * The guard is about CONTACT FACTS, not about every mark on the card.
   *
   * The fallback exists for a recipient whose client blocks the image: they must
   * still be able to tell who wrote to them and how to reply. The motto is
   * deliberately NOT in it — it is decoration, it is set in a script face the
   * fallback cannot use anyway, and restating it under the card duplicated the
   * card's own strapline in plain grey text for every recipient who CAN see
   * images. Losing a strapline when images are off costs nothing; losing a phone
   * number costs the reply.
   */
  test("every contact fact survives in the fallback when no image was generated", () => {
    const m = model();
    m.card_png_url = null;
    const email = htmlMod.render(m);
    const f = card.fields(m);

    // Name, title, company, both numbers, the address and the website — the
    // things a recipient needs in order to know who wrote and how to reply.
    //
    // Compared field by field rather than string by string: the card splits the
    // street and the P.O. Box into two icon rows, while the fallback joins them
    // into one line, so the two carry the same FACTS in different shapes. An
    // assertion on the shape would pin the wrong thing.
    expect(f.name).toBeTruthy();
    expect(email).toContain(f.name);
    expect(email).toContain(f.title);
    expect(email).toContain(m.company.legal_name);
    expect(email).toContain(m.contact.phone_desk);
    expect(email).toContain(m.contact.phone_mobile);
    expect(email).toContain(m.contact.email);
    expect(email).toContain(f.website);
    expect(email).toContain(m.company.address_line);
  });

  test("the motto stays on the card and is not restated as text under it", () => {
    const m = model();
    m.card_png_url = "https://smartls.praxisls.com/media/x.png";
    expect(card.fields(m).motto).toBeTruthy();
    expect(htmlMod.render(m)).not.toContain("Going Beyond");
  });

  /**
   * The fallback carries the TENANT'S colours, not a literal.
   *
   * It read `model.brand_color || "#0f4c81"` and the card template sets no
   * `brand_color` — its colours resolve from branding — so every fallback ever
   * rendered used that hard-coded blue. On a white-label product that is the
   * one colour on the page belonging to nobody.
   */
  test("the fallback is painted in the tenant's brand, not a literal", () => {
    const m = model();
    m.palette = palette.resolve(SMART_LS, SEEDED_LAYOUT);
    m.card_png_url = null;
    const email = htmlMod.render(m);
    expect(email).toContain(m.palette.ink);   // rule, name, website
    expect(email).toContain(m.palette.warm);  // the title dash
    expect(email).not.toContain("#0f4c81");
  });

  test("a tenant with different branding gets a different fallback", () => {
    const a = model();
    const b = model();
    a.palette = palette.resolve({ accentDeep: "#0D5C8A" }, {});
    b.palette = palette.resolve({ accentDeep: "#14532D" }, {});
    expect(htmlMod.render(a)).not.toBe(htmlMod.render(b));
    expect(htmlMod.render(b)).toContain("#14532d");
  });

  /** A phone number nobody can tap is a phone number nobody rings. */
  test("the fallback's contact details are clickable", () => {
    const m = model();
    m.palette = palette.resolve(SMART_LS, SEEDED_LAYOUT);
    const email = htmlMod.render(m);
    expect(email).toContain('href="tel:+237233420281"');
    expect(email).toContain('href="mailto:line.happy@smartls.cm"');
    // A bare domain is not a link until it has a scheme.
    expect(email).toContain('href="https://www.smartls.cm"');
  });

  /** Outlook's Word engine drops a CSS border on a <td>; a filled cell survives. */
  test("the brand rule is a filled cell, not a CSS border", () => {
    const m = model();
    m.palette = palette.resolve(SMART_LS, SEEDED_LAYOUT);
    const email = htmlMod.render(m);
    expect(email).toContain(`bgcolor="${m.palette.ink}"`);
    expect(email).not.toMatch(/border-left:/);
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
