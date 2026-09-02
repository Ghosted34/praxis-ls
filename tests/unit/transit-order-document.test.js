"use strict";

/**
 * The transit order is a ONE-PAGE, MONOLINGUAL, SIGNED instrument.
 *
 * Those are three contracts, not three preferences, and each of them has been
 * broken in production:
 *
 *   · the rendered order ran to two pages, putting the signature boxes alone on
 *     page 2 — so the sheet the client stamped and returned carried no cargo,
 *     no declared value and no customs regime on it;
 *   · a tenant configured `fr` still received "Ordre de transit / Transit
 *     order", "Émis / Issued" and eight "Facture / Invoice" labels, because the
 *     projection pre-joined both languages before the template could pick one;
 *   · `kit.sealBlock` had existed, tested and documented since PR-1 and nothing
 *     called it, so no document has ever carried the signature it collected.
 *
 * Every assertion here reads the OUTPUT. Reading the plumbing is what let all
 * three survive: there was a `language` config, a `verify` parameter and a
 * `show.signature` flag, and none of them changed what came out of the printer.
 *
 * ── Why the height model is tested and not the render ──────────────────────
 * Paginating for real needs headless Chrome, which is not present in CI (see
 * `signature-pdf-raster-deps.test.js` for the same constraint). What IS pinned
 * here is the arithmetic that decides the fit — the height model, the estimate
 * it produces, and the scale that comes out of it — because that is the part a
 * refactor silently breaks. The measured constants came from rendering; the
 * script that produced them is `scripts/dev/measure-instrument.js`.
 */

const registry = require("../../src/services/documents/templates/registry");
const kit = require("../../src/services/documents/templates/kit");
const rules = require("../../src/modules/operations/transit_order/transit_order.rules");

const TPL = registry.get("TRANSIT_ORDER");

/**
 * The entity as the RENDERER receives it: derived lines, not raw columns.
 *
 * `address_lines` and `identifiers` are assembled by
 * `modules/master/entity-letterhead.service` from the entity's structured
 * `entity_address` and registration rows — the same function the entity
 * dossier previews with. The legacy `address` / `rccm` / `niu` columns are
 * kept here to prove the fallback still renders for an unmigrated tenant.
 */
const ENTITY = {
  legal_name: "SMART LOGISTICS AND SERVICES LTD",
  address_lines: ["1030, Avenue Douala Manga Bell, Bali", "PO Box 5120, Douala, Cameroun"],
  identifiers: [
    { kind: "RCCM", number: "RC/DLA/2021/B/2060" },
    { kind: "NIU", number: "M042116033580Q" },
  ],
  address: "1030, Avenue Douala Manga Bell, Bali\nPO Box 5120, Douala, Cameroun",
  city: "Douala",
  rccm: "RC/DLA/2021/B/2060",
  niu: "M042116033580Q",
  email: "operations@smartls.cm",
  phone: "+237 233 420 281",
  bank_block: { bank: "AFRILAND FIRST BANK", account: "10005-0006-107018411001-93" },
};

const VERIFY = {
  url: "https://smartls.cm/v/A4B7K92MXQ1P",
  code: "A4B7K92MXQ1P",
  qrSvg: '<svg id="verify-qr"></svg>',
};

const SEAL = {
  forParty: ENTITY.legal_name,
  position: { n: 1, of: 1 },
  reason: "Approuvé pour expédition",
  signerName: "Jean Mbarga",
  signerRole: "Directeur Commercial",
  signedAt: "27 juil. 2026, 14:35 WAT",
  method: "Vérifié par code e-mail",
  docRef: "SLAS-TRO-2026-0019",
  contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  code: "A4B7K92MXQ1P",
  qrSvg: '<svg id="seal-qr"></svg>',
};

const cfgFor = (language, extra = {}) => kit.mergeCfg({}, { language, ...extra });
const dataWith = (patch = {}) => ({ ...JSON.parse(JSON.stringify(TPL.sampleData)), ...patch });

/** Cargo lines with a description long enough to wrap, the realistic worst case. */
const lines = (n) =>
  Array.from({ length: n }, (_, i) => ({
    marks: `SCC/2026/${40 + i}`,
    packages: String(10 + i),
    label: "Sacs de ciment CIMENCAM 50kg palettisés, film étirable",
    weight: `${2 + i} t`,
    value: `${1000000 * (i + 1)} XAF`,
  }));

/**
 * The document WITHOUT its stylesheet.
 *
 * `kit.shell` inlines the whole sheet stylesheet, and that stylesheet
 * legitimately contains English words in its comments. A grep over the raw
 * string therefore finds "Import" on a French document that never prints it —
 * the assertion inverted. Everything below is a claim about what PRINTS.
 */
const body = (html) => String(html).replace(/<style>[\s\S]*?<\/style>/g, "");

/* ── 1. One page ─────────────────────────────────────────────────────────── */

describe("the sheet is one page, by construction", () => {
  test("the sheet is exactly the printable height, less the rounding guard", () => {
    // 297mm of A4 less two 16mm margins is 265mm; the sheet claims 264mm.
    // The missing millimetre is not slack — layout happens in 96dpi pixels and
    // a sheet built to exactly the page height measured 265.1mm and paginated
    // to two pages, the second carrying a tenth of a millimetre of nothing.
    expect(kit.sheetHeightMm({ paper: "A4", margin_mm: 16 })).toBe(265);
    expect(kit.fitBudgetMm({ paper: "A4", margin_mm: 16 })).toBe(264);
    expect(body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY)))
      .toContain('class="sheet"');
  });

  test("the sheet's height follows the paper and the margin", () => {
    expect(kit.sheetHeightMm({ paper: "LETTER", margin_mm: 16 })).toBe(247.4);
    expect(kit.sheetHeightMm({ paper: "A4", margin_mm: 10 })).toBe(277);
    // An unknown paper falls back to A4 rather than to NaN, which would emit
    // `min-height: NaNmm` and silently un-pin the foot.
    expect(kit.sheetHeightMm({ paper: "TABLOID", margin_mm: 16 })).toBe(265);
  });

  test("a fuller order is set tighter, never truncated", () => {
    const at = (n) => {
      const html = TPL.build(dataWith({ lines: lines(n), seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY);
      return Number(String(html).match(/--k:([\d.]+)/)[1]);
    };
    const one = at(1);
    const twenty = at(20);
    expect(one).toBeGreaterThan(twenty);
    expect(one).toBeLessThanOrEqual(1);
    // Every line still prints. This is the assertion that stops a future
    // "just cap the table at 12 rows" from passing the page-count test.
    const html = body(TPL.build(dataWith({ lines: lines(20), seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    for (const l of lines(20)) expect(html).toContain(l.marks);
  });

  test("the scale is clamped, and a nonsense estimate lands on a readable page", () => {
    expect(kit.fitScale(100, 264)).toBe(1);         // fits: never enlarged
    expect(kit.fitScale(528, 264)).toBe(0.5);       // twice too tall
    expect(kit.fitScale(100000, 264)).toBe(kit.FIT_FLOOR);
    expect(kit.fitScale(0, 264)).toBe(1);
    expect(kit.fitScale(NaN, 264)).toBe(1);
    expect(kit.fitScale(264, 0)).toBe(1);
  });

  test("blocks that cannot shrink are solved for, not scaled", () => {
    // A seal keeps its type sizes and a QR keeps its millimetres, so 29mm of
    // seal is still 29mm at k = 0.5. Folding them into one total and solving
    // `budget / content` assumes they shrink; the page then comes out ~2mm over,
    // which is a second sheet. `budget = fixed + scaling · k` is exact.
    expect(kit.fitScale(235, 264, 29)).toBe(1);       // 235 + 29 = 264 exactly
    expect(kit.fitScale(470, 264, 29)).toBe(0.5);     // (264 − 29) / 470
    // Naively dividing would have said this fits at 0.53 and it does not.
    expect(kit.fitScale(470, 264)).toBeGreaterThan(kit.fitScale(470, 264, 29));
    // Unshrinkable blocks alone over the budget: the floor, and an honest spill.
    expect(kit.fitScale(200, 264, 300)).toBe(kit.FIT_FLOOR);
    expect(kit.fitScale(200, 264, NaN)).toBe(1);
  });

  test("the fixed-height model names every block that ignores the fit", () => {
    for (const key of ["seal", "footVfy"]) {
      expect(typeof TPL.FIXED_MM[key]).toBe("number");
      expect(TPL.FIXED_MM[key]).toBeGreaterThan(0);
    }
  });

  test("the emitted scale is a bare number — cfg reaches the stylesheet", () => {
    // `cfg` is merged from a tenant-saved settings row, and `--k` is
    // interpolated into a stylesheet that themes every document. A string that
    // survived to the output would be a CSS injection point.
    const html = kit.shell("x", "<i></i>", { fit: "1;} body{display:none} .x{a:b" });
    expect(html).toMatch(/--k:1"/);
    expect(html).not.toContain("display:none");
  });

  test("the signature strip may not be split across a page break", () => {
    // The one block whose whole purpose is to come back stamped.
    const css = String(kit.shell("x", "", {}));
    expect(css).toMatch(/\.strip \{[^}]*break-inside: avoid/);
    expect(css).toMatch(/\.strip \{[^}]*page-break-inside: avoid/);
  });

  test("the height model covers every block the template can render", () => {
    // The estimate and the layout are maintained in two places and WILL drift.
    // This makes a block added without a height a failed build rather than a
    // document that quietly comes out on two pages.
    const H = TPL.HEIGHT_MM;
    for (const key of [
      "head", "name", "ident", "facts", "cargoHead", "cargoRow", "cargoWrap",
      "cargoFoot", "regime", "liability", "docs", "note", "lodged", "strip",
      "stampExtra", "foot", "gap",
    ]) {
      expect(typeof H[key]).toBe("number");
      expect(H[key]).toBeGreaterThan(0);
    }
  });

  test("an optional block costs height only when it is rendered", () => {
    const k = (data) => Number(String(TPL.build(data, cfgFor("fr"), ENTITY, VERIFY)).match(/--k:([\d.]+)/)[1]);
    const bare = dataWith({ lines: lines(8), seals: [SEAL], instructions: null, declaration_ref: null });
    const full = { ...bare, instructions: "Livraison sous escorte.", declaration_ref: "D-4471/2026", lodged_date: "2026-08-01" };
    expect(k(full)).toBeLessThan(k(bare));
  });

  test("the company cachet is paid for in the estimate", () => {
    // It is ~17mm of the signatory box and it comes from config, not from the
    // record — so a template that reads it must also count it, or a tenant that
    // uploads a stamp gets a second page and nobody connects the two.
    const data = dataWith({ lines: lines(8), seals: [SEAL] });
    const k = (cfg) => Number(String(TPL.build(data, cfg, ENTITY, VERIFY)).match(/--k:([\d.]+)/)[1]);
    expect(k(cfgFor("fr", { signature: { image_url: "data:image/png;base64,AAA" } })))
      .toBeLessThan(k(cfgFor("fr")));
  });
});

/* ── 2. One language ─────────────────────────────────────────────────────── */

describe("the document comes out in ONE language", () => {
  const FRENCH_ONLY = ["Ordre de transit", "Marques", "Désignation de la marchandise", "Pièces jointes", "Facture", "Émis"];
  const ENGLISH_ONLY = ["Transit order", "Marks", "Cargo description", "Attached documents", "Invoice", "Issued"];

  test("a French render contains no English label, and no slash pair", () => {
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    for (const word of FRENCH_ONLY) expect(html).toContain(word);
    for (const word of ENGLISH_ONLY) expect(html).not.toContain(word);
    // The specific shape the tenant complained about.
    expect(html).not.toContain("Ordre de transit / Transit order");
    expect(html).not.toContain("Facture / Invoice");
    expect(html).not.toMatch(/Émis\s*\/\s*Issued/);
  });

  test("an English render contains no French label", () => {
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("en"), ENTITY, VERIFY));
    for (const word of ENGLISH_ONLY) expect(html).toContain(word);
    for (const word of ["Désignation de la marchandise", "Pièces jointes", "Régime douanier"]) {
      expect(html).not.toContain(word);
    }
  });

  test("the status is a pair from the lifecycle, not a pre-joined string", () => {
    // The projection used to hand the renderer "Émis / Issued" as ONE value, so
    // `cfg.language` was powerless over it. One vocabulary, two sides, and the
    // screen and the sheet read it from the same place.
    expect(rules.statusWords("ISSUED")).toEqual({ fr: "Émis", en: "Issued" });
    expect(rules.statusWords("LODGED")).toEqual({ fr: "Déclaré", en: "Lodged" });
    // An unknown state degrades to itself rather than to undefined — a document
    // must print SOMETHING in the status box.
    expect(rules.statusWords("WAT")).toEqual({ fr: "WAT", en: "WAT" });
    expect(rules.statusWords(null)).toEqual({ fr: "", en: "" });
  });

  test("every attached-document label carries both languages, joined by neither", () => {
    for (const d of rules.SUBMITTED_DOC_TYPES) {
      expect(d.label_fr).toBeTruthy();
      expect(d.label_en).toBeTruthy();
      expect(d.label_fr).not.toContain(" / ");
      expect(d.label_en).not.toContain(" / ");
    }
  });

  test("the checklist prints EVERY field the form offers", () => {
    // The legacy form offered five boxes and its print template checked a sixth
    // it could never tick. All eight print, ticked or not: an unticked box is
    // information — it says the document was asked for and is not attached.
    const html = body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY));
    for (const d of rules.SUBMITTED_DOC_TYPES) expect(html).toContain(d.label_fr);
    // The sample must show the same checklist the real projection builds, or
    // the Studio preview under-reports the form an operator is about to send.
    expect(TPL.sampleData.documents.map((d) => d.code))
      .toEqual(rules.SUBMITTED_DOC_TYPES.map((d) => d.code));
  });

  test("a bilingual render is still available, and is the only one that pairs", () => {
    // Not a regression: "bilingual" is a configured value a tenant chooses on
    // purpose. What must never happen is a document configured fr or en pairing
    // anyway, which is what the two tests above pin.
    const html = body(TPL.build(dataWith(), cfgFor("bilingual"), ENTITY, VERIFY));
    expect(html).toContain("Ordre de transit / Transit order");
  });

  test("a legal clause stacks in bilingual mode rather than slash-joining", () => {
    // The insurance clause carries the company name. Slash-joined it prints the
    // name four times in a row and stops being readable, which is the whole
    // reason `clauseText` exists.
    const html = body(TPL.build(dataWith(), cfgFor("bilingual"), ENTITY, VERIFY));
    expect(html).toContain('class="alt"');
    expect(html).not.toContain(`Assurance NON couverte par ${ENTITY.legal_name} — à la charge du client / Insurance`);
  });
});

/* ── 3. The signatory box ────────────────────────────────────────────────── */

describe("the signatory box, and the engine behind it", () => {
  test("both boxes print, signed or not", () => {
    const html = body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain("Visa / cachet du client");
    expect(html).toContain(`Pour ${ENTITY.legal_name}`);
    expect(html).toContain('class="strip"');
  });

  test("a signed order carries the seal, with the evidence on it", () => {
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain('class="seal"');
    expect(html).toContain("Jean Mbarga");
    expect(html).toContain("Directeur Commercial");
    expect(html).toContain("Approuvé pour expédition");
    expect(html).toContain("Vérifié par code e-mail");
    expect(html).toContain('<svg id="seal-qr">');
    expect(html).toContain("A4B7-K92M-XQ1P");
  });

  test("an UNSIGNED order carries no seal and no QR anywhere", () => {
    // The honest answer: there is nothing to verify, and a symbol resolving to
    // a 404 teaches readers that our marks do not work.
    const html = body(TPL.build(dataWith({ seals: [] }), cfgFor("fr"), ENTITY, null));
    expect(html).not.toContain('class="seal"');
    expect(html).not.toContain("A4B7-K92M-XQ1P");
  });

  test("the verification QR is printed exactly once", () => {
    // The seal carries it. The foot would carry the SAME code at the same size,
    // costing ~15mm of the height this whole rebuild exists to find.
    const signed = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(signed.match(/A4B7-K92M-XQ1P/g)).toHaveLength(1);
    expect(signed).toContain('<svg id="seal-qr">');
    expect(signed).not.toContain('<svg id="verify-qr">');
  });

  test("a seal inside a titled box does not print the party name twice", () => {
    const inBox = kit.sealBlock(SEAL, { language: "fr" }, { titled: true });
    expect(inBox).not.toContain(`Pour ${ENTITY.legal_name}`);
    // …and the default is unchanged, because a seal standing alone must declare
    // its side (SIGNATURE_ENGINEERING_GUIDE §3.12).
    expect(kit.sealBlock(SEAL, { language: "fr" })).toContain(`Pour ${ENTITY.legal_name}`);
  });

  test("the position in the chain survives the titled variant", () => {
    // A box header can say whose side it is. It cannot say "2 of 3".
    const two = { ...SEAL, position: { n: 2, of: 3 } };
    expect(kit.sealBlock(two, { language: "en" }, { titled: true })).toContain("2 of 3");
  });

  test("the seal never prints a verdict or an IP, wherever it sits", () => {
    // §3.12 and §3.13. A static PDF cannot know it is still valid, and this
    // page travels through a warehouse and a border post.
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    for (const forbidden of ["VALID", "VALIDE", "AES_OTP", "197.210", "Vérifié ✓"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  test("the company cachet prints when configured, and nothing when not", () => {
    const stamped = body(TPL.build(dataWith(), cfgFor("fr", {
      signature: { image_url: "data:image/png;base64,IMAGEBYTES" },
    }), ENTITY, VERIFY));
    expect(stamped).toContain('class="stamp"');
    expect(stamped).toContain("IMAGEBYTES");
    expect(body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY))).not.toContain('class="stamp"');
  });
});

/* ── 4. The letterhead and the foot ──────────────────────────────────────── */

describe("the letterhead and the foot", () => {
  test("the head says how to reach us; the foot says who we are legally", () => {
    // The legacy transit order printed no letterhead at all, which is the thing
    // clients actually complained about. But the first rebuild printed the
    // legal name, the address, RCCM and NIU at BOTH ends — a quarter of the
    // identity block on the page was duplication, on a document whose entire
    // problem is height. Head and foot now share nothing.
    //
    // 12760 replaced the sheet's own `.lh2`/`.ifoot` pair with the SHARED
    // shell — `.lhz` (a twelve-column grid) and `.sfoot` — now composed from
    // `letterhead-blocks` and used by every document this product prints, not
    // just this one. The anatomy this test guards is unchanged, which is the
    // point of the migration; only the class names moved.
    const html = body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY));
    const head = html.slice(html.indexOf('class="lhz"'), html.indexOf('class="dname"'));
    const foot = html.slice(html.indexOf('class="sfoot"'));

    expect(head).toContain(ENTITY.legal_name);
    expect(head).toContain("1030, Avenue Douala Manga Bell, Bali");
    expect(head).toContain("PO Box 5120, Douala, Cameroun");
    expect(head).toContain("+237 233 420 281 · operations@smartls.cm");
    expect(head).not.toContain("RCCM");
    expect(head).not.toContain("NIU");

    expect(foot).toContain("RCCM RC/DLA/2021/B/2060");
    expect(foot).toContain("NIU M042116033580Q");
    expect(foot).not.toContain(ENTITY.legal_name);
    expect(foot).not.toContain("Avenue Douala Manga Bell");
  });

  test("the address prints as the structured lines the entity holds", () => {
    const html = body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain('<div class="ln">1030, Avenue Douala Manga Bell, Bali</div>');
    expect(html).toContain('<div class="ln">PO Box 5120, Douala, Cameroun</div>');
  });

  test("an entity with no structured address still prints its legacy column", () => {
    // The documents were the LAST surface reading `corporate_entity.address`.
    // A tenant that has never filled in the structured row must keep the
    // letterhead it has, so the fallback is load-bearing, not decoration.
    const legacy = { ...ENTITY, address_lines: undefined, address: "Bonabéri\nDouala, Cameroun" };
    const html = body(TPL.build(dataWith(), cfgFor("fr"), legacy, VERIFY));
    expect(html).toContain('<div class="ln">Bonabéri</div>');
    expect(html).toContain('<div class="ln">Douala, Cameroun</div>');
  });

  test("the identifiers are whatever the jurisdiction requires", () => {
    // Two hardcoded labels are correct in exactly one country. A French entity
    // carries SIREN and TVA; the foot prints what the entity's registration
    // rows actually hold.
    const french = {
      ...ENTITY,
      identifiers: [{ kind: "SIREN", number: "552 100 554" }, { kind: "TVA", number: "FR40552100554" }],
    };
    const html = body(TPL.build(dataWith(), cfgFor("fr"), french, VERIFY));
    expect(html).toContain("SIREN 552 100 554");
    expect(html).toContain("TVA FR40552100554");
    expect(html).not.toContain("RCCM");
  });

  test("an entity with no registration rows falls back to niu and rccm", () => {
    const legacy = { ...ENTITY, identifiers: [] };
    const html = body(TPL.build(dataWith(), cfgFor("fr"), legacy, VERIFY));
    expect(html).toContain("RCCM RC/DLA/2021/B/2060");
    expect(html).toContain("NIU M042116033580Q");
  });

  test("bank details are not printed on an authorisation", () => {
    // They belong on a document somebody is meant to PAY. This one travels
    // through a warehouse, a border post and a customer's filing cabinet.
    const html = body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).not.toContain("AFRILAND FIRST BANK");
    expect(html).not.toContain("10005-0006");
    // …and the kit can still print them where they belong.
    expect(kit.instrumentFoot(ENTITY, cfgFor("fr"), null, { bank: true }))
      .toContain("AFRILAND FIRST BANK");
  });

  test("the logo is drawn when branding has one, the name when it does not", () => {
    const withLogo = body(TPL.build(dataWith(), cfgFor("fr", {
      logo: { url: "data:image/png;base64,LOGOBYTES", show: true, height_mm: 15 },
    }), ENTITY, VERIFY));
    expect(withLogo).toContain("LOGOBYTES");
    expect(body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY))).toContain('class="wordmark"');
  });

  test("the mark is sized by an explicit height, not by max-height alone", () => {
    // An <img> constrained only by max-height contributes ZERO to a flex item's
    // max-content width in Chrome, so the letterhead collapsed to 0×0 and every
    // document rendered with a logo that had loaded and was invisible.
    const css = String(kit.shell("x", "", {}));
    expect(css).toMatch(/\.lhb img\.mark \{[^}]*height: \d+mm/);
  });

  test("the foot claims the page, and says what the document is", () => {
    // "Page 1 / 1" is a literal, and it is true by construction — the sheet is
    // one page. If that ever stops holding, the label is wrong on the paper as
    // well as in the layout, which is the loud failure a silent second sheet
    // never gave anybody.
    const fr = body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY));
    expect(fr).toContain("Page 1 / 1");
    expect(fr).toContain("Autorisation de transit");
    expect(body(TPL.build(dataWith(), cfgFor("en"), ENTITY, VERIFY)))
      .toContain("Transit authorisation");
  });

  test("the reference sits under the title, and only there", () => {
    const html = body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain('<div class="ref">SLAS-TRO-2026-0019</div>');
    // Once on the page. It used to be under the title AND in the identity row,
    // which is the duplication the head/foot split had just removed elsewhere.
    expect(html.match(/SLAS-TRO-2026-0019/g)).toHaveLength(2); // title + seal evidence
    expect(html).not.toContain("N° d'ordre");
    // …and the strapline is no longer competing with it for the same slot.
    const title = html.slice(html.indexOf('class="dname"'), html.indexOf('class="blk"'));
    expect(title).not.toContain("Autorisation de transit");
  });

  test("an unsigned document's foot carries the QR, since no seal holds one", () => {
    const html = body(TPL.build(dataWith({ seals: [] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain('<svg id="verify-qr">');
    expect(html).toContain("A4B7-K92M-XQ1P");
  });
});
