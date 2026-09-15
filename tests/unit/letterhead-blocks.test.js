"use strict";
/**
 * THE LETTERHEAD BLOCK MODEL (12760).
 *
 * These tests matter for the same reason the letterhead-assembly ones do, only
 * more so: this one pure function is now what the entity's editor draws, what
 * every one of ~27 document templates prints, and what the one-page fit model
 * measures. Three consumers of one definition — if they could diverge, the
 * canvas would be a lie and an instrument sheet would silently paginate.
 *
 * So the behaviour is pinned here rather than trusted to three call sites
 * agreeing.
 */
const blocks = require("../../src/services/documents/templates/letterhead-blocks");

const ENTITY = {
  entity_id: "e1",
  legal_name: "Smart Logistics and Services Ltd",
  legal_form: "SARL",
  share_capital: 100000000,
  share_capital_currency: "XAF",
  default_language: "fr",
  email: "operations@smartls.cm",
  phone: "+237 233 420 281",
  website: "smartls.cm",
  niu: "M042116033580Q",
  rccm: "RC/DLA/2021/B/2060",
  address_lines: ["1030, Avenue Douala Manga Bell, Bali", "PO Box 5120, Douala, Cameroun"],
  identifiers: [
    { kind: "RCCM", number: "RC/DLA/2021/B/2060" },
    { kind: "NIU", number: "M042116033580Q" },
  ],
};

const live = (zone) => zone.filter((b) => b.visible && b.lines.length);
const byId = (zone, id) => zone.find((b) => b.id === id);
const textOf = (b) => (b ? b.lines.map((l) => l.text).join(" | ") : null);

describe("composition — the content is derived, never typed", () => {
  test("the company qualifier is assembled from stored facts, per language", () => {
    expect(textOf(byId(blocks.compose({ entity: ENTITY }, "fr").header, "company_line")))
      .toBe("SARL au capital de 100,000,000 XAF");
    expect(textOf(byId(blocks.compose({ entity: ENTITY }, "en").header, "company_line")))
      .toBe("SARL share capital 100,000,000 XAF");
  });

  test("the show_ toggles still govern their blocks", () => {
    const c = blocks.compose(
      { entity: ENTITY, config: { show_legal_form: false, show_share_capital: false } },
      "fr",
    );
    // Both halves off leaves the qualifier with nothing to say, so the block is
    // switched off rather than printed empty.
    expect(byId(c.header, "company_line").visible).toBe(false);
    expect(byId(c.header, "contact").visible).toBe(true);
  });

  test("identifiers are jurisdictional, not two hardcoded labels", () => {
    const french = {
      ...ENTITY,
      identifiers: [{ kind: "SIREN", number: "552 100 554" }, { kind: "VAT", number: "FR40552100554" }],
    };
    expect(textOf(byId(blocks.compose({ entity: french }, "fr").footer, "identifiers")))
      .toBe("SIREN 552 100 554 | VAT FR40552100554");
  });

  test("an entity with no registration rows falls back to the legacy columns", () => {
    const legacy = { ...ENTITY, identifiers: [] };
    expect(textOf(byId(blocks.compose({ entity: legacy }, "fr").footer, "identifiers")))
      .toBe("RCCM RC/DLA/2021/B/2060 | NIU M042116033580Q");
  });

  test("an entity with no structured address falls back to its legacy column", () => {
    const legacy = { ...ENTITY, address_lines: undefined, address: "Bonabéri\nDouala, Cameroun" };
    expect(textOf(byId(blocks.compose({ entity: legacy }, "fr").header, "address")))
      .toBe("Bonabéri | Douala, Cameroun");
  });

  /**
   * The scar this default carries: the first rebuild of the transit order
   * printed the name, address, RCCM and NIU at BOTH ends — a quarter of the
   * identity block was duplication, on a document whose entire problem is
   * height.
   */
  test("head and foot share nothing by default", () => {
    const c = blocks.compose({ entity: ENTITY }, "fr");
    const footIds = live(c.footer).map((b) => b.id);
    expect(footIds).toContain("identifiers");
    expect(footIds).not.toContain("foot_company");
    expect(footIds).not.toContain("foot_address");
  });

  test("but a tenant who wants the name along the bottom can switch it on", () => {
    const c = blocks.compose(
      { entity: ENTITY, layout: { footer: [{ id: "foot_company", visible: true }] } },
      "fr",
    );
    expect(live(c.footer).map((b) => b.id)).toContain("foot_company");
  });

  test("a block switched on with nothing behind it is reported, not hidden", () => {
    const c = blocks.compose({ entity: { legal_name: "ACME" } }, "en");
    expect(c.empty_blocks).toContain("address");
    expect(c.empty_blocks).toContain("identifiers");
    // The accent rule always prints, so it is never "switched on but empty" —
    // reporting it would train the tenant to ignore the warning that matters.
    expect(c.empty_blocks).not.toContain("rule");
  });
});

describe("tokens — the sentence is theirs, the fact stays ours", () => {
  const withLine = (fr) => blocks.compose(
    { entity: ENTITY, customLines: [{ line_id: "L1", zone: "footer", text_fr: fr, text_en: fr }] },
    "fr",
  );

  test("a token resolves from the entity's own record", () => {
    expect(textOf(byId(withLine("Agréé en douane n° {{entity.rccm}}").footer, "custom:L1")))
      .toBe("Agréé en douane n° RC/DLA/2021/B/2060");
  });

  test("an unknown token resolves to nothing, never to itself", () => {
    // Printing "{{entity.siret}}" on a customer's invoice because somebody
    // guessed a name is worse than printing nothing.
    const b = byId(withLine("Licence {{entity.siret}}").footer, "custom:L1");
    expect(textOf(b)).not.toContain("{{");
  });

  test("a line whose every token is empty is dropped, not left as scaffolding", () => {
    const b = byId(withLine("Licence n° {{entity.siret}}").footer, "custom:L1");
    expect(b.lines).toHaveLength(0);
    expect(b.empty).toBe(true);
  });

  test("a line with a resolvable token keeps its literal text", () => {
    expect(blocks.resolveTokens("{{entity.legal_name}} — transitaire", { entity: ENTITY, doc: {} }))
      .toBe("Smart Logistics and Services Ltd — transitaire");
  });

  test("custom lines are per language", () => {
    const input = {
      entity: ENTITY,
      customLines: [{ line_id: "L1", zone: "footer", text_fr: "Transitaire agréé", text_en: "Licensed freight forwarder" }],
    };
    expect(textOf(byId(blocks.compose(input, "fr").footer, "custom:L1"))).toBe("Transitaire agréé");
    expect(textOf(byId(blocks.compose(input, "en").footer, "custom:L1"))).toBe("Licensed freight forwarder");
  });
});

describe("layout — a saved arrangement is a preference, not a schema", () => {
  test("a block catalogued after the tenant saved still appears", () => {
    // The "we add a field and it must be accommodated" contract. A saved layout
    // naming only two blocks must not blank the other nine.
    const c = blocks.compose(
      { entity: ENTITY, layout: { header: [{ id: "logo", row: 0, col: 0, span: 4 }] } },
      "fr",
    );
    expect(live(c.header).map((b) => b.id)).toEqual(
      expect.arrayContaining(["logo", "company_name", "address", "contact"]),
    );
  });

  test("a saved entry for a block that no longer exists is dropped, not rendered", () => {
    const c = blocks.compose(
      { entity: ENTITY, layout: { header: [{ id: "block_from_2019", row: 0 }] } },
      "fr",
    );
    expect(c.header.some((b) => b.id === "block_from_2019")).toBe(false);
  });

  test("placements are clamped, never trusted", () => {
    const c = blocks.compose(
      { entity: ENTITY, layout: { header: [{ id: "company_name", col: 99, span: 99, size: 99 }] } },
      "fr",
    );
    const b = byId(c.header, "company_name");
    expect(b.col).toBeLessThanOrEqual(11);
    expect(b.span).toBeLessThanOrEqual(12);
    expect(b.size).toBeLessThanOrEqual(2.5);
  });
});

describe("measurement — what the fit model solves against", () => {
  /**
   * The bug this pins. The first cut summed by ROW alone and reported an 8.7mm
   * header for the default layout, where the identity column alone is four
   * lines. It would have handed `fitScale` ~9mm of head to budget against a
   * real 20-plus, and every instrument sheet with a full cargo table would have
   * spilled onto a second page.
   */
  test("blocks stacked in one column cost their sum, not the tallest", () => {
    const c = blocks.compose({ entity: ENTITY }, "fr");
    // Four identity lines beside a wordmark — must exceed a single line's height
    // by a wide margin.
    expect(c.height.header_mm).toBeGreaterThan(15);
  });

  test("blocks abreast cost the taller column, not the sum", () => {
    const stacked = blocks.compose(
      { entity: ENTITY, layout: { header: [{ id: "logo", row: 0, col: 0 }, { id: "company_name", row: 1, col: 0 }] } },
      "fr",
    );
    const abreast = blocks.compose(
      { entity: ENTITY, layout: { header: [{ id: "logo", row: 0, col: 0 }, { id: "company_name", row: 0, col: 6 }] } },
      "fr",
    );
    expect(abreast.height.header_mm).toBeLessThan(stacked.height.header_mm);
  });

  test("adding a footer line adds millimetres the fit model can see", () => {
    const bare = blocks.compose({ entity: ENTITY }, "fr").height.footer_mm;
    const withLines = blocks.compose({
      entity: ENTITY,
      customLines: [
        { line_id: "L1", zone: "footer", text_fr: "Transitaire agréé" },
        { line_id: "L2", zone: "footer", text_fr: "Membre du GICAM" },
      ],
    }, "fr").height.footer_mm;
    expect(withLines).toBeGreaterThan(bare);
  });

  test("an inactive line costs nothing", () => {
    const c = blocks.compose({
      entity: ENTITY,
      customLines: [{ line_id: "L1", zone: "footer", text_fr: "Transitaire agréé", is_active: false }],
    }, "fr");
    expect(c.footer.some((b) => b.id === "custom:L1")).toBe(false);
  });
});

describe("the catalogue tells the editor where to send someone", () => {
  test("every block names the dossier tab and field that fixes it", () => {
    for (const b of blocks.catalogue("en")) {
      expect(typeof b.source.tab).toBe("string");
      expect(b.source.tab.length).toBeGreaterThan(0);
      expect(typeof b.source.field).toBe("string");
      expect(b.label.length).toBeGreaterThan(0);
    }
  });

  test("the identifiers block points at the registrations, not at a text box", () => {
    const ids = blocks.catalogue("en").find((b) => b.id === "identifiers");
    expect(ids.source).toEqual({ tab: "Identity & registrations", field: "registrations" });
  });

  test("the token picker offers only tokens that resolve", () => {
    const names = blocks.tokens("en").map((t) => t.token);
    expect(names).toContain("{{entity.rccm}}");
    for (const t of blocks.tokens("en")) {
      expect(t.token).toMatch(/^\{\{[a-z_]+\.[a-z_]+\}\}$/);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});

/**
 * THE DEEP LINKS ARE A CROSS-BOUNDARY CONTRACT, so they are gated like one.
 *
 * Each block names the dossier tab and the `data-field` anchor that fixes it,
 * and the letterhead studio turns that into a link. Nothing in the type system
 * connects a string in this catalogue to a `<Section field="…">` in a React
 * file — so a renamed tab or a removed anchor degrades into a link that lands
 * somewhere plausible and rings nothing, which is worse than no link at all
 * because the reader concludes the field does not exist.
 *
 * Same principle as `client/scripts/check-docs.mjs`: a rule enforced by a
 * document is a rule nobody enforces.
 */
describe("deep links resolve to something that exists", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) =>
    fs.readFileSync(path.join(__dirname, "../../client/src/features/masterdata", f), "utf8");
  // Both files: the studio renders inside the dossier's Letterhead tab, so an
  // anchor it carries is an anchor a link can reach.
  const dossier = read("entity-360.tsx") + read("letterhead-studio.tsx");

  /** The dossier's own `TABS` array — the only tabs a `?tab=` can select. */
  const tabs = (() => {
    const at = dossier.indexOf("const TABS = [");
    return [...dossier.slice(at, dossier.indexOf("] as const", at)).matchAll(/"([^"]+)"/g)]
      .map((m) => m[1]);
  })();

  /** Every `data-field` anchor the dossier renders, static or via a prop. */
  const anchors = new Set([
    ...[...dossier.matchAll(/\bfield="([^"]+)"/g)].map((m) => m[1]),
    ...[...dossier.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]),
    // `data-field={base}` on the wording textareas, keyed by the base name so
    // one link works whichever language is being edited.
    ...(dossier.includes("data-field={base}")
      ? ["header_note", "footer_note", "legal_mentions"]
      : []),
  ]);

  test("the dossier still has the tabs and anchors this test reads", () => {
    // Guards the test itself: if the parse above silently returns nothing, the
    // two tests below pass vacuously and the gate is gone.
    expect(tabs).toContain("Letterhead");
    expect(tabs.length).toBeGreaterThan(5);
    expect(anchors.size).toBeGreaterThan(5);
  });

  test.each(blocks.catalogue("en"))("$id points at a tab that exists", (b) => {
    expect(tabs).toContain(b.source.tab);
  });

  test.each(blocks.catalogue("en"))("$id points at an anchor that exists", (b) => {
    expect([...anchors]).toContain(b.source.field);
  });
});

/**
 * THE CANVAS PAINTS PAPER, AND IT HAS TO BE THE SAME PAPER.
 *
 * The studio deliberately steps outside the app's semantic tokens for the sheet
 * itself: a document preview is a picture of a piece of paper, and paper is
 * white in dark mode too. Painted with the app's surface tokens the sheet came
 * out light-on-dark while the PDF it depicts is black-on-white — a WYSIWYG
 * editor showing the opposite of what prints.
 *
 * The consequence is a hand-mirrored copy of `kit.defaults()` in a React file,
 * which is exactly the kind of duplicate that drifts silently. So it is gated:
 * change the print ink on the server and this fails until the canvas follows.
 */
describe("the studio's print palette matches the renderer's", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "../..");
  const kitSrc = fs.readFileSync(
    path.join(root, "src/services/documents/templates/kit.js"),
    "utf8",
  );
  const studioSrc = fs.readFileSync(
    path.join(root, "client/src/features/masterdata/letterhead-studio.tsx"),
    "utf8",
  );

  /** `ink: brand.ink || "#101E34"` and `muted: "#6B7A90"` in kit.defaults(). */
  const kitColour = (key) => {
    const m = kitSrc.match(new RegExp(`\\n\\s*${key}:[^,\\n]*"(#[0-9A-Fa-f]{6})"`));
    return m && m[1].toUpperCase();
  };
  /** `ink: "#101E34"` inside the studio's PRINT constant. */
  const studioColour = (key) => {
    const block = studioSrc.slice(studioSrc.indexOf("const PRINT = {"));
    const m = block.match(new RegExp(`${key}:\\s*"(#[0-9A-Fa-f]{6})"`));
    return m && m[1].toUpperCase();
  };

  test.each(["ink", "muted", "rule"])("%s is the same colour on both sides", (key) => {
    const server = kitColour(key);
    // Guards the test: a regex that stops matching would pass vacuously.
    expect(server).toMatch(/^#[0-9A-F]{6}$/);
    expect(studioColour(key)).toBe(server);
  });

  test("the sheet is painted white, not with an app surface token", () => {
    expect(studioColour("paper")).toBe("#FFFFFF");
  });
});
