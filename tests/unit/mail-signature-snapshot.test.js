/**
 * SIGNATURE HTML SNAPSHOTS (§6.7 criterion 9, task S2).
 *
 * Criterion 9: "The signature HTML renders correctly in Outlook 2016+, Gmail
 * web and Apple Mail (snapshot test)." No mail client runs in CI; what a
 * snapshot CAN pin is the exact markup those clients' constraints force:
 * presentational tables with a width attribute (Outlook desktop, which strips
 * CSS widths), every style inline (Gmail, which strips `<style>`), a web-safe
 * font stack (Apple Mail renders system fonts), and no flex/grid anywhere
 * (Outlook 2016's Word engine ignores them). The four constraint assertions
 * below are the rule; the snapshot is the tripwire — any change to the
 * renderer's output must be reviewed against the same four clients, which is
 * exactly the review criterion 9 asks for.
 *
 * The models are hand-built rather than resolved from the database so the
 * snapshot is deterministic — no timestamps, no ids, no user rows. They carry
 * the shape `signature.resolve` produces (`person_line`, `contact_line`,
 * `legal_line`), because that is what the renderer actually reads.
 */
"use strict";

const { render } = require("../../src/modules/mail/signature/signature.html");

const NAMED_USER = {
  language: "en",
  system: false,
  kind: "classic",
  width_px: 650,
  brand_color: "#0f4c81",
  accent_color: "#c9a227",
  show_logo: false,
  show_motto_bar: true,
  show_legal: true,
  person: {
    full_name: "Élodie Kamga",
    job_title: "Directrice des opérations",
    department: "Freight & Logistics",
    person_line: "Élodie Kamga",
  },
  contact: {
    email: "elodie.kamga@praxis-ls.cm",
    phone_mobile: "+237 6 55 12 34 56",
    phone_desk: "+237 2 33 41 20 20",
    contact_line: "Tél. +237 2 33 41 20 20 · Port. +237 6 55 12 34 56 · elodie.kamga@praxis-ls.cm",
  },
  company: {
    legal_name: "Praxis LS SA",
    address_line: "Rue Joffre, Akwa, Douala",
    phone: "+237 2 33 41 20 20",
    website: "https://www.praxis-ls.cm",
    legal_line: "SA · RCCM CM-DLA-2020-B-12345 · NIU P052000123456T",
    motto: "Your supply chain, mastered",
    confidentiality: "This message is confidential and intended for the named recipient only.",
  },
};

const SYSTEM_BLOCK = {
  ...NAMED_USER,
  system: true,
  person: { full_name: null, job_title: null, department: "Billing", person_line: null },
  contact: {
    email: "billing@praxis-ls.cm",
    phone_mobile: null,
    phone_desk: null,
    contact_line: "billing@praxis-ls.cm",
  },
};

const COMPACT = {
  ...NAMED_USER,
  kind: "compact",
  person: {
    full_name: "Jean-Paul Nkoa",
    job_title: "Commercial senior",
    department: "Sales",
    person_line: "Jean-Paul Nkoa",
  },
};

describe("snapshot of the canonical renders", () => {
  test("a named user, classic layout, with accents and both phones", () => {
    expect(render(NAMED_USER)).toMatchSnapshot();
  });

  test("a SYSTEM block — corporate identity, no person's mobile", () => {
    expect(render(SYSTEM_BLOCK)).toMatchSnapshot();
  });

  test("the compact layout", () => {
    expect(render(COMPACT)).toMatchSnapshot();
  });
});

describe("the four target clients' constraints, on every canonical render", () => {
  const renders = {
    "named user": render(NAMED_USER),
    system: render(SYSTEM_BLOCK),
    compact: render(COMPACT),
  };

  test.each(Object.entries(renders))("%s — Outlook 2016+: table layout with a width attribute, no flex/grid", (_n, html) => {
    // Word's HTML engine ignores CSS widths and every modern layout property;
    // the signature is a presentational table whose width is an ATTRIBUTE.
    expect(html).toMatch(/<table/);
    expect(html).toMatch(/<table[^>]*width="650"/);
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  test.each(Object.entries(renders))("%s — Gmail web: everything inline, no <style>, no classes", (_n, html) => {
    // Gmail strips <style> blocks and class attributes; every declaration must
    // ride on the element itself.
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/class="/);
    const styled = html.match(/<[a-z]+[^>]*style="/g) || [];
    expect(styled.length).toBeGreaterThan(0);
  });

  test.each(Object.entries(renders))("%s — Apple Mail: web-safe font stack", (_n, html) => {
    expect(html).toMatch(/Arial, Helvetica, sans-serif/);
  });

  test.each(Object.entries(renders))("%s — markup is escaped, not executed", (_n, _html) => {
    // A signature whose model contains markup must render the characters, not
    // the markup — every client interprets this the same way, and a renderer
    // that does not is an injection surface in every outbound mail. This is
    // also the place that proves the snapshot above renders the PERSON, and
    // not a stray literal.
    const hostile = render({
      ...NAMED_USER,
      person: { ...NAMED_USER.person, person_line: "<img src=x onerror=alert(1)>" },
    });
    expect(hostile).not.toMatch(/<img src=x/);
    expect(hostile).toContain("&lt;img");
  });

  test("each canonical render contains its own person", () => {
    expect(render(NAMED_USER)).toContain("Élodie Kamga");
    expect(render(COMPACT)).toContain("Jean-Paul Nkoa");
    // The SYSTEM block carries no person — the corporate identity replaces it.
    expect(render(SYSTEM_BLOCK)).toContain("Billing");
    expect(render(SYSTEM_BLOCK)).not.toContain("Élodie");
  });
});
