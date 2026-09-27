"use strict";
/**
 * The letterhead fixes from the tenant review of 21 Sep 2026 ("meeting 5"):
 *
 *   - the PO box did not follow an address change: with two active registered
 *     rows the preview and the PDF each took "the first" of a differently
 *     ordered list. The resolver is now deterministic, and the entity can
 *     choose the rows outright;
 *   - the bank block could not be moved down: blocks stacked in one cell were
 *     ordered by the catalogue alone, and a block's zone was the catalogue's;
 *   - RCCM and NIU print on one line unless the entity asks otherwise.
 */
const lh = require("../../src/modules/master/entity-letterhead.service");
const blocks = require("../../src/services/documents/templates/letterhead-blocks");
const kit = require("../../src/services/documents/templates/kit");

const OLD = {
  address_id: "a-old", type: "REGISTERED", is_active: true, is_primary: false,
  line1: "1030, Avenue Douala Manga Bell", po_box: "5120", city: "Douala",
  updated_at: "2026-01-10T10:00:00Z",
};
const NEW = { ...OLD, address_id: "a-new", po_box: "5121", updated_at: "2026-09-21T19:50:00Z" };
const MAIL = {
  address_id: "a-mail", type: "MAILING", is_active: true, is_primary: false,
  line1: "Boîte postale", po_box: "9999", city: "Douala", updated_at: "2026-03-01T00:00:00Z",
};

describe("which address prints", () => {
  test("two registered rows: the newest edit wins, whatever order the query returned", () => {
    expect(lh.registeredAddressRow([OLD, NEW]).address_id).toBe("a-new");
    expect(lh.registeredAddressRow([NEW, OLD]).address_id).toBe("a-new");
    expect(lh.poBox({}, [OLD, NEW])).toBe("5121");
  });

  test("a registered primary row beats a newer non-primary one", () => {
    const primaryOld = { ...OLD, is_primary: true };
    expect(lh.registeredAddressRow([NEW, primaryOld]).address_id).toBe("a-old");
  });

  test("the entity's chosen rows win, and a chosen inactive row falls back", () => {
    expect(lh.registeredAddressRow([OLD, NEW], { address_id: "a-old" }).address_id).toBe("a-old");
    expect(lh.registeredAddressRow([{ ...OLD, is_active: false }, NEW], { address_id: "a-old" }).address_id).toBe("a-new");
  });

  test("the PO box comes from a postal (MAILING) row when there is one, or the chosen postal row", () => {
    expect(lh.poBox({}, [NEW, MAIL])).toBe("9999");
    expect(lh.poBox({}, [NEW, MAIL], { postal_address_id: "a-new" })).toBe("5121");
  });

  test("compose prints the chosen address and PO box", () => {
    const c = blocks.compose({
      entity: { legal_name: "ACME" },
      addresses: [OLD, NEW],
      config: { address_id: "a-old" },
    }, "en");
    const addr = c.header.find((b) => b.id === "address").lines.map((l) => l.text).join(" | ");
    expect(addr).toContain("5120, Douala");
    expect(addr).not.toContain("5121");
  });
});

describe("RCCM and NIU on one line", () => {
  const ids = [{ kind: "RCCM", number: "RC/DLA/2021/B/2060" }, { kind: "NIU", number: "M042116033580Q" }];

  test("one line by default, one per line when switched off", () => {
    expect(lh.identifierText(ids)).toEqual(["RCCM: RC/DLA/2021/B/2060 · NIU: M042116033580Q"]);
    expect(lh.identifierText(ids, false)).toEqual(["RCCM RC/DLA/2021/B/2060", "NIU M042116033580Q"]);
  });

  test("the rendered preview's identifier line follows the same switch", () => {
    const entity = { legal_name: "ACME", rccm: "RC/1", niu: "N/1" };
    expect(lh.render({ entity }, "en").footer.identifier_line).toBe("NIU: N/1 · RCCM: RC/1");
    expect(lh.render({ entity, config: { identifiers_inline: false } }, "en").footer.identifier_line)
      .toBe("NIU N/1 · RCCM RC/1");
  });
});

describe("moving blocks", () => {
  const entity = {
    legal_name: "ACME", rccm: "RC/1", niu: "N/1",
    identifiers: [{ kind: "RCCM", number: "RC/1" }],
  };
  const order = (zone) => zone.map((b) => b.id);

  test("`order` moves a block down its stack", () => {
    const c = blocks.compose({
      entity,
      layout: { footer: [{ id: "payment", row: 0, col: 0, order: 99 }] },
    }, "en");
    const foot = order(c.footer);
    expect(foot[foot.length - 1]).toBe("payment");
  });

  test("a block listed in the header's saved list moves into the header, and leaves the footer", () => {
    const c = blocks.compose({
      entity,
      layout: { header: [{ id: "identifiers", row: 3, col: 0 }] },
    }, "en");
    expect(order(c.header)).toContain("identifiers");
    expect(order(c.footer)).not.toContain("identifiers");
    expect(c.header.find((b) => b.id === "identifiers").zone).toBe("header");
  });

  test("an id listed in both zones prints once, in the first", () => {
    const c = blocks.compose({
      entity,
      layout: { header: [{ id: "identifiers", row: 3 }], footer: [{ id: "identifiers", row: 0 }] },
    }, "en");
    expect(order(c.header).filter((id) => id === "identifiers")).toHaveLength(1);
    expect(order(c.footer)).not.toContain("identifiers");
  });

  test("a payment block dragged into the header still prints only on a document that opts in", () => {
    const cfg = {
      language: "en",
      letterhead_layout: { header: [{ id: "payment", row: 3, col: 0 }] },
      letterhead_config: {},
    };
    const withBank = {
      ...entity,
      letterhead_sources: { treasuryAccounts: [] },
      bank_block: { bank_name: "Afriland", account_number: "0001" },
    };
    const head = kit.standardHead(withBank, cfg, {});
    expect(head).not.toContain('data-block="payment"');
  });
});

describe("any brand colour, black included (00:41:19)", () => {
  const { colourInput, letterheadUpdate } = require("../../packages/shared/schemas/entity-common");

  test("names, a missing hash and the 3-digit shorthand all normalise to #rrggbb", () => {
    for (const v of ["black", "noir", "000", "#000", "000000", "#000000", " Black "]) {
      expect(colourInput(v)).toBe("#000000");
    }
    expect(colourInput("#C2703D")).toBe("#c2703d");
    expect(colourInput("not a colour")).toBeNull();
  });

  test("the letterhead validator stores what colourInput returns, and still refuses nonsense", () => {
    expect(letterheadUpdate.parse({ brand_color: "black" }).brand_color).toBe("#000000");
    expect(letterheadUpdate.safeParse({ brand_color: "sunset" }).success).toBe(false);
    expect(letterheadUpdate.parse({ brand_color: null }).brand_color).toBeNull();
  });

  test("text in a pale brand colour prints in a readable variant; rules keep the exact colour", () => {
    const html = kit.shell("t", "", { accent: "#ffff00" });
    expect(html).not.toMatch(/\.accent \{ color: #ffff00/);
    expect(html).toMatch(/\.lhb \.rule \{ border-bottom: 0\.7mm solid #ffff00/);
    expect(kit.shell("t", "", { accent: "#000000" })).toMatch(/\.accent \{ color: #000000/);
  });
});
