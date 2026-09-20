"use strict";

/**
 * THE IDENTIFIERS BLOCK COMPOSES FROM THE REGISTRATION ROWS — through the
 * entity's own letterhead endpoint, not just in the pure model.
 *
 * The bug this pins: `corporate_entity.service.letterhead()` handed
 * `letterhead-blocks.compose()` the RAW `repo.get` row as `composeInput.entity`,
 * while compose's own @param contract expected the entity to already carry
 * `identifiers` and `address_lines` — derived facts that were computed inside
 * `entity-letterhead.service.render()` and never attached here. The identifiers
 * block therefore only ever saw the legacy `corporate_entity.niu`/`.rccm`
 * columns, which are NULL for any tenant whose NIU/RCCM live in
 * entity_registration rows (the post-0512 shape). The rendered PREVIEW printed
 * the numbers — it calls render(), which derives them — while the composed
 * BLOCKS beside it printed nothing, and since 12760 the blocks are what every
 * document actually prints.
 *
 * So this fixture is deliberately the tenant the bug hurt: legacy columns
 * null, the statutory identifiers held ONLY as registration rows, the
 * registered office held ONLY as an entity_address row (the legacy `address`
 * blob says something else, so a fallback that sneaks through is visible).
 *
 * PR-04 (Decision Q3) must survive the fix: the rows are forwarded REDACTED
 * for a caller without MOD-01 tax view, a redacted row carries no number, and
 * a numberless row composes no identifier — asserted on the serialized body,
 * same as entity-tax-boundary.test.js, so a leak anywhere in the bundle fails.
 */

jest.mock("../../src/modules/master/corporate_entity/corporate_entity.repo", () => {
  const entity = {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics and Services Ltd",
    legal_form: "SARL",
    share_capital: 100000000,
    share_capital_currency: "XAF",
    default_currency: "XAF",
    default_language: "en",
    email: "info@slas.cm",
    phone: "+237 233 420 281",
    country_code: "CM",
    // THE POINT OF THIS FIXTURE. 0512 backfilled these columns into rows and
    // new tenants never fill them: the rows are the only source of truth.
    niu: null,
    rccm: null,
    // The legacy blob deliberately DISAGREES with the structured row, so the
    // address assertion can tell which source composed the block.
    address: "LEGACY-BLOB-ADDRESS, Yaoundé",
  };
  const registrations = [
    { registration_id: "r1", entity_id: "e1", kind: "NIU", number: "M042116033580Q", country_code: "CM", is_primary: true },
    { registration_id: "r2", entity_id: "e1", kind: "RCCM", number: "RC/DLA/2021/B/2060", country_code: "CM", is_primary: true },
  ];
  const taxRegistrations = [
    {
      tax_registration_id: "t1", entity_id: "e1", jurisdiction_name: "Cameroun",
      country_code: "CM", tax_kind: "VAT", tax_number: "CMVAT00778899", regime: "STANDARD",
      is_primary: true, is_active: true,
    },
  ];
  const addresses = [
    {
      address_id: "a1", entity_id: "e1", type: "REGISTERED",
      line1: "1030, Avenue Douala Manga Bell", line2: "Bali",
      city: "Douala", region: null, postal_code: null, po_box: "BP 5120",
      country_code: "CM", is_primary: true, is_active: true,
    },
  ];
  return {
    WRITABLE: [], LETTERHEAD_WRITABLE: [],
    get: async () => entity,
    collections: async () => ({ people: [], contacts: [], addresses, registrations, establishments: [] }),
    documentsAndTax: async () => ({ documents: [], tax_registrations: taxRegistrations, letterhead: null }),
    treasuryAccounts: async () => [],
    letterheadLines: async () => [],
  };
});

const entityService = require("../../src/modules/master/corporate_entity/corporate_entity.service");

const NO_CLIENT = { query: async () => ({ rows: [], rowCount: 0 }) };

const SECRETS = {
  niu: "M042116033580Q",
  rccm: "RC/DLA/2021/B/2060",
  vat: "CMVAT00778899",
};

/** The composed block, by id, in one zone of one language. */
const block = (out, lang, zone, id) => out.blocks[lang][zone].find((b) => b.id === id);
const textOf = (b) => (b ? b.lines.map((l) => l.text).join(" | ") : null);

describe("GET /entities/:id/letterhead — composed blocks read the registration rows", () => {
  it("an entity whose NIU/RCCM live only in entity_registration rows prints them in the identifiers block", async () => {
    const out = await entityService.letterhead(NO_CLIENT, "e1", "en", { tax: true });

    const ids = block(out, "en", "footer", "identifiers");
    expect(textOf(ids)).toContain(`NIU ${SECRETS.niu}`);
    expect(textOf(ids)).toContain(`RCCM ${SECRETS.rccm}`);
    // PR-10 / A3: the VAT number rides the tax registration and STAYS there —
    // the trade-register line prints NIU/RCCM (and any other registration
    // rows), never a tax-registration number.
    expect(textOf(ids)).not.toContain(`VAT ${SECRETS.vat}`);
    expect(textOf(ids)).not.toContain(SECRETS.vat);
    // On the page, and not reported as "switched on, but empty".
    expect(ids.visible).toBe(true);
    expect(ids.empty).toBe(false);
    expect(out.blocks.en.empty_blocks).not.toContain("identifiers");

    // Both languages compose from the same rows — a French sheet must not
    // lose its statutory mentions to a language switch.
    expect(textOf(block(out, "fr", "footer", "identifiers"))).toContain(`NIU ${SECRETS.niu}`);

    // And the preview beside the blocks agrees — the two surfaces are fed the
    // same rows, which is the property the whole rebuild is for.
    expect(out.preview.en.footer.identifier_line).toContain(SECRETS.niu);
  });

  it("a caller without MOD-01 tax view gets the layout with the numbers absent — blocks included", async () => {
    const out = await entityService.letterhead(NO_CLIENT, "e1", "en", { tax: false });

    // The whole serialized bundle, so a number leaking through ANY surface —
    // block lines, preview, config echo — fails, not just the one asserted.
    const body = JSON.stringify(out);
    for (const s of [SECRETS.niu, SECRETS.rccm, SECRETS.vat]) {
      expect(body).not.toContain(s);
    }

    // The layout itself is intact: the block still exists for the editor to
    // arrange; it just has nothing to print for this caller.
    const ids = block(out, "en", "footer", "identifiers");
    expect(ids).toBeDefined();
    expect(ids.lines).toHaveLength(0);
  });

  it("defaults fail closed: a call site asserting nothing composes no identifiers", async () => {
    const out = await entityService.letterhead(NO_CLIENT, "e1", "en");
    const body = JSON.stringify(out);
    for (const s of [SECRETS.niu, SECRETS.rccm, SECRETS.vat]) {
      expect(body).not.toContain(s);
    }
  });

  it("the registered-address block composes from the structured entity_address row, not the legacy blob", async () => {
    const out = await entityService.letterhead(NO_CLIENT, "e1", "en", { tax: true });

    const addr = block(out, "en", "header", "address");
    expect(textOf(addr)).toContain("1030, Avenue Douala Manga Bell");
    expect(textOf(addr)).toContain("Douala");
    // The structured row won: the free-text column that predates
    // entity_address stays a fallback for tenants who have nothing else.
    expect(textOf(addr)).not.toContain("LEGACY-BLOB-ADDRESS");
    expect(addr.empty).toBe(false);
  });
});
