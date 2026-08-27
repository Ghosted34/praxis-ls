"use strict";

/**
 * The delivery note is a ONE-PAGE, MONOLINGUAL, SIGNED instrument — and it is
 * the one document that has to say WHERE IN THE FILE IT SITS.
 *
 * The first three contracts are the transit order's, and this is the second
 * adopter of the same instrument sheet; `transit-order-document.test.js` holds
 * the kit-level primitives (the sheet height, the fit solver, the CSS injection
 * guard) and is not repeated here. What IS pinned here is everything the
 * delivery note does that the transit order does not:
 *
 *   · a container MANIFEST with ruled slots, which must never truncate. The
 *     legacy capped it at 18 and silently dropped the rest, which on a
 *     proof-of-delivery is data loss wearing a layout bug's clothes;
 *   · the PARTIAL-DELIVERY band. A sea file's twelve boxes clear over three
 *     weeks and each run gets its own note, so a note that says only what is in
 *     it leaves the driver and the client's gatekeeper unable to tell whether
 *     more is coming;
 *   · the RE-DELIVERY reason, printed, because the note is the only place
 *     anyone will look for it six months later.
 *
 * Every assertion reads the OUTPUT of the template or the RETURN of a pure
 * rule. Reading the plumbing is what let a bilingual document, a two-page
 * document and an uncalled seal builder all survive review.
 *
 * ── Why the height model is tested and not the render ──────────────────────
 * Paginating for real needs headless Chrome, which is not present in CI. The
 * arithmetic that decides the fit is what a refactor silently breaks, and it is
 * what is pinned. The measured constants came from rendering; the script that
 * produced them is `scripts/dev/measure-instrument.js`.
 */

const registry = require("../../src/services/documents/templates/registry");
const kit = require("../../src/services/documents/templates/kit");
const rules = require("../../src/modules/operations/delivery_note/delivery_note.rules");

const TPL = registry.get("DELIVERY_NOTE");

/** The entity as the RENDERER receives it — derived lines, not raw columns. */
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
};

const VERIFY = {
  url: "https://smartls.cm/v/A4B7K92MXQ1P",
  code: "A4B7K92MXQ1P",
  qrSvg: '<svg id="verify-qr"></svg>',
};

const SEAL = {
  forParty: ENTITY.legal_name,
  position: { n: 1, of: 1 },
  reason: "Marchandise remise au client",
  signerName: "Jean Mbarga",
  signerRole: "Chef de quai",
  signedAt: "28 juil. 2026, 09:12 WAT",
  method: "Vérifié par code e-mail",
  docRef: "SLAS-BL-2026-0052",
  contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  code: "A4B7K92MXQ1P",
  qrSvg: '<svg id="seal-qr"></svg>',
};

const cfgFor = (language, extra = {}) => kit.mergeCfg({}, { language, ...extra });
const dataWith = (patch = {}) => ({ ...JSON.parse(JSON.stringify(TPL.sampleData)), ...patch });

/** n numbered boxes, as the picker snapshots them onto a note. */
const boxes = (n) =>
  Array.from({ length: n }, (_, i) => ({
    container_no: `TCLU${String(1000000 + i).padStart(7, "0")}`,
    seal_no: `SL${889000 + i}`,
  }));

const scaleOf = (html) => Number(String(html).match(/--k:([\d.]+)/)[1]);

/**
 * The document WITHOUT its stylesheet. `kit.shell` inlines a stylesheet whose
 * comments are legitimately in English, so a grep over the raw string finds
 * English words on a French document that never prints one — the assertion
 * inverted. Everything below is a claim about what PRINTS.
 */
const body = (html) => String(html).replace(/<style>[\s\S]*?<\/style>/g, "");

/* ── 1. One page ─────────────────────────────────────────────────────────── */

describe("the note is one page, by construction", () => {
  test("it is built on the instrument sheet, not on a flowing page", () => {
    expect(body(TPL.build(dataWith(), cfgFor("fr"), ENTITY, VERIFY))).toContain('class="sheet"');
  });

  test("a fuller manifest is set tighter, never truncated", () => {
    const at = (n) => scaleOf(TPL.build(dataWith({ containers: boxes(n), seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(at(3)).toBeLessThanOrEqual(1);
    expect(at(3)).toBeGreaterThan(at(40));
    // Every box still prints. This is the assertion that stops a future
    // "just cap the manifest at 18 slots" from passing the page-count test —
    // which is exactly what the legacy did.
    const html = body(TPL.build(dataWith({ containers: boxes(40), seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    for (const c of boxes(40)) expect(html).toContain(c.container_no);
  });

  test("the height model covers every block the template can render", () => {
    // The estimate and the layout are maintained in two places and WILL drift.
    // A block added without a height must be a failed build, not a document
    // that quietly comes out on two pages.
    const H = TPL.HEIGHT_MM;
    for (const key of [
      "head", "name", "ident", "consignee", "cargoHead", "cargoRow", "cargoWrap",
      "cargoMin", "manifestHead", "manifestRow", "position", "reserves", "strip",
      "stampExtra", "foot", "gap",
    ]) {
      expect(typeof H[key]).toBe("number");
      expect(H[key]).toBeGreaterThan(0);
    }
    for (const key of ["seal", "footVfy"]) {
      expect(typeof TPL.FIXED_MM[key]).toBe("number");
      expect(TPL.FIXED_MM[key]).toBeGreaterThan(0);
    }
  });

  test("the cargo table's ruled minimum is in the estimate, not just in the CSS", () => {
    // `.cargo` reserves 26mm whatever it holds — the writable area that makes
    // the table usable on paper. Estimating a one-line table by its rows alone
    // told the solver the page was 14mm shorter than it is, which is a second
    // sheet on a full note.
    expect(TPL.HEIGHT_MM.cargoMin).toBeGreaterThan(TPL.HEIGHT_MM.cargoHead + TPL.HEIGHT_MM.cargoRow);
  });

  test("an optional block costs height only when it is rendered", () => {
    const at = (data) => scaleOf(TPL.build(data, cfgFor("fr"), ENTITY, VERIFY));
    // Enough boxes that both renders are already compressing — at 24 the page
    // has slack and both clamp to 1, which would pass for the wrong reason.
    const base = dataWith({ containers: boxes(48), seals: [SEAL] });
    expect(at({ ...base, position: null })).toBeGreaterThan(at(base));
  });

  test("the company cachet is paid for in the estimate", () => {
    // ~12mm of the signatory box, and it comes from config rather than from the
    // record — so a template that renders it must also count it, or a tenant
    // that uploads a stamp gets a second page and nobody connects the two.
    const data = dataWith({ containers: boxes(48), seals: [SEAL] });
    const at = (cfg) => scaleOf(TPL.build(data, cfg, ENTITY, VERIFY));
    expect(at(cfgFor("fr", { signature: { image_url: "data:image/png;base64,AAA" } })))
      .toBeLessThan(at(cfgFor("fr")));
  });

  test("the seal does not shrink, and the solver knows it", () => {
    // A seal keeps its type sizes and its QR keeps its millimetres (§3.7), so
    // 29mm of seal is 29mm at k = 0.5. Folding it into the scaling total makes
    // the solver believe it has ~15mm more to give than it has.
    const data = dataWith({ containers: boxes(60) });
    const signed = scaleOf(TPL.build({ ...data, seals: [SEAL] }, cfgFor("fr"), ENTITY, VERIFY));
    const unsigned = scaleOf(TPL.build({ ...data, seals: [] }, cfgFor("fr"), ENTITY, VERIFY));
    expect(signed).toBeLessThan(unsigned);
  });
});

/* ── 2. One language ─────────────────────────────────────────────────────── */

describe("the note comes out in ONE language", () => {
  const FRENCH_ONLY = [
    "Bon de livraison", "Destinataire", "Liste des conteneurs",
    "Observations / réserves du client", "Reçu par", "Date de livraison",
  ];
  const ENGLISH_ONLY = [
    "Delivery note", "Consignee", "Container manifest",
    "Comments / reservations (client)", "Received by",
  ];

  test("a French render contains no English label, and no slash pair", () => {
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    for (const word of FRENCH_ONLY) expect(html).toContain(word);
    for (const word of ENGLISH_ONLY) expect(html).not.toContain(word);
    expect(html).not.toContain("Bon de livraison / Delivery note");
    expect(html).not.toMatch(/Livré\s*\/\s*Delivered/);
  });

  test("an English render contains no French label", () => {
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("en"), ENTITY, VERIFY));
    for (const word of ENGLISH_ONLY) expect(html).toContain(word);
    for (const word of ["Liste des conteneurs", "Observations / réserves du client", "Destinataire"]) {
      expect(html).not.toContain(word);
    }
  });

  test("the status is a pair from the lifecycle, not a pre-joined string", () => {
    expect(rules.statusWords("ISSUED")).toEqual({ fr: "Émis", en: "Issued" });
    expect(rules.statusWords("DELIVERED")).toEqual({ fr: "Livré", en: "Delivered" });
    // An unknown state degrades to itself rather than to undefined — a document
    // must print SOMETHING in the status box.
    expect(rules.statusWords("WAT")).toEqual({ fr: "WAT", en: "WAT" });
    expect(rules.statusWords(null)).toEqual({ fr: "", en: "" });
  });

  test("a bilingual render is still available, and is the only one that pairs", () => {
    // Not a regression: "bilingual" is a value a tenant chooses on purpose.
    // What must never happen is a document configured fr or en pairing anyway.
    expect(body(TPL.build(dataWith(), cfgFor("bilingual"), ENTITY, VERIFY)))
      .toContain("Bon de livraison / Delivery note");
  });
});

/* ── 3. The manifest ─────────────────────────────────────────────────────── */

describe("the container manifest", () => {
  test("a short delivery still prints a form somebody can write on", () => {
    // Twelve ruled slots minimum. A driver arriving with a box added at the
    // last minute needs somewhere to write it, and the printed form is the only
    // artefact present at the handover.
    const html = body(TPL.build(dataWith({ containers: boxes(2) }), cfgFor("fr"), ENTITY, VERIFY));
    expect((html.match(/class="mcell"/g) || []).length).toBe(12);
    expect(html).toContain("______________");
  });

  test("nothing is ever truncated to make the slots fit", () => {
    const html = body(TPL.build(dataWith({ containers: boxes(31) }), cfgFor("fr"), ENTITY, VERIFY));
    // 31 boxes round up to 11 rows of three, so 33 cells: every box plus two
    // ruled remainders on the last row. A cap would show as 12, 18 or 30.
    expect((html.match(/class="mcell"/g) || []).length).toBe(33);
    expect(html).toContain("TCLU1000030");
  });

  test("a grouped line prints as the file states it, not as an unnamed box", () => {
    // 10708 — a file whose B/L has not numbered the boxes yet still says what
    // equipment is going. A dash there reads as a container we failed to name.
    const html = body(TPL.build(
      dataWith({ containers: [{ container_type_code: "40HC", qty: 3 }] }),
      cfgFor("fr"), ENTITY, VERIFY,
    ));
    expect(html).toContain("3 × 40HC");
  });

  test("a box going out again carries the reason it is", () => {
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain("Retour: porte endommagée, réexpédié");
  });

  test("a container number is escaped, not interpolated", () => {
    // Container numbers reach the template from an operator's keyboard via the
    // picker's hand-typed escape hatch.
    const html = TPL.build(
      dataWith({ containers: [{ container_no: '<img src=x onerror="alert(1)">' }] }),
      cfgFor("fr"), ENTITY, VERIFY,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

/* ── 4. Where in the file this delivery sits ─────────────────────────────── */

describe("the partial-delivery band", () => {
  test("it prints the run, the count and what is still moving", () => {
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain("Avancement de la livraison");
    expect(html).toContain("2 / 3");    // delivery 2 of 3 notes
    expect(html).toContain("8 / 12");   // containers signed for
    // In transit is its OWN figure. "0 still to come" while four are on a truck
    // is how a second truck gets dispatched for boxes already on the first.
    expect(html).toContain("En cours de livraison");
  });

  test("a single-box file gets no band at all", () => {
    // "Delivery 1 of 1, 0 remaining" is noise, and noise on a signed instrument
    // is worse than silence.
    const html = body(TPL.build(
      dataWith({ position: { sequence: 1, of_notes: 1, total: 1, delivered: 1, in_transit: 0, outstanding: 0 } }),
      cfgFor("fr"), ENTITY, VERIFY,
    ));
    expect(html).not.toContain("Avancement de la livraison");
  });

  test("a note printed without its position is still a valid note", () => {
    // `template.service` computes the position best-effort: a file whose
    // rollup fails must still print a delivery note, exactly as it did before
    // this band existed.
    const html = body(TPL.build(dataWith({ position: null }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain('class="sheet"');
    expect(html).not.toContain("Avancement de la livraison");
  });

  test("the band reads in English on an English note", () => {
    const html = body(TPL.build(dataWith(), cfgFor("en"), ENTITY, VERIFY));
    expect(html).toContain("Delivery progress");
    expect(html).toContain("Containers delivered");
    expect(html).not.toContain("Avancement de la livraison");
  });
});

/* ── 5. The signatory box ────────────────────────────────────────────────── */

describe("the signatory box, and the engine behind it", () => {
  test("both boxes print, signed or not", () => {
    const html = body(TPL.build(dataWith({ seals: [] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain(`Livré par ${ENTITY.legal_name}`);
    expect(html).toContain("Reçu par (nom, signature, cachet)");
    expect(html).toContain('class="strip"');
  });

  test("a signed note carries the seal, with the evidence on it", () => {
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain('class="seal"');
    expect(html).toContain("Jean Mbarga");
    expect(html).toContain("Chef de quai");
    expect(html).toContain("Marchandise remise au client");
    expect(html).toContain('<svg id="seal-qr">');
    expect(html).toContain("A4B7-K92M-XQ1P");
  });

  test("an UNSIGNED note carries no seal and no QR anywhere", () => {
    // The honest answer: there is nothing to verify, and a symbol resolving to
    // a 404 teaches readers that our marks do not work.
    const html = body(TPL.build(dataWith({ seals: [] }), cfgFor("fr"), ENTITY, null));
    expect(html).not.toContain('class="seal"');
    expect(html).not.toContain("A4B7-K92M-XQ1P");
  });

  test("the verification QR is printed exactly once", () => {
    // The seal carries it; the foot would carry the SAME code at the same size,
    // costing ~15mm of the height this rebuild exists to find.
    const html = body(TPL.build(dataWith({ seals: [SEAL] }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html.match(/A4B7-K92M-XQ1P/g)).toHaveLength(1);
    expect(html).not.toContain('<svg id="verify-qr">');
  });

  test("the reserves box is ruled and printable even when empty", () => {
    // The client's own words at the moment of acceptance are the most valuable
    // thing on the page in a dispute — so there is always somewhere to write
    // them, including on the copy that travels out unsigned.
    const html = body(TPL.build(dataWith({ reservations: null }), cfgFor("fr"), ENTITY, VERIFY));
    expect(html).toContain("Observations / réserves du client");
    expect(html).toMatch(/min-height:calc\(11mm \* var\(--k\)\)/);
  });
});

/* ── 6. The rollup the band and the screen both read ─────────────────────── */

describe("delivery progress, derived from the notes", () => {
  const unit = (id, patch = {}) => ({ id, container_no: id, is_delivered: false, is_issued: false, ...patch });

  test("a box on an issued note is NOT counted as still to go", () => {
    // The defect this whole rollup exists to prevent: `total - delivered` says
    // four are outstanding when four are on a truck, and a second truck goes
    // out for them.
    const p = rules.deliveryProgress({
      units: [
        unit("A", { is_delivered: true }),
        unit("B", { is_issued: true }),
        unit("C"),
      ],
    });
    expect(p).toMatchObject({ total: 3, delivered: 1, in_transit: 1, outstanding: 1 });
    expect(p.outstanding).not.toBe(p.total - p.delivered);
  });

  test("delivered wins over issued for the same box", () => {
    // A box on a delivered note AND an issued one has been signed for; the
    // second note is the re-delivery, not a reason to count it twice.
    const p = rules.deliveryProgress({ units: [unit("A", { is_delivered: true, is_issued: true })] });
    expect(p).toMatchObject({ total: 1, delivered: 1, in_transit: 0, outstanding: 0, complete: true });
  });

  test("complete means every box landed, not merely none outstanding", () => {
    // `outstanding === 0` is also true of a file whose last four boxes are on a
    // truck. Stating `complete` separately is what stops a screen closing a
    // file that has not finished.
    expect(rules.deliveryProgress({ units: [unit("A", { is_issued: true })] }).complete).toBe(false);
    expect(rules.deliveryProgress({ units: [] })).toMatchObject({ total: 0, complete: false, containerised: false });
  });

  test("a grouped line contributes only the part that was never itemised", () => {
    // The boxes broken out of a line report individually; counting both would
    // double the file.
    const p = rules.deliveryProgress({
      units: [unit("A", { is_delivered: true })],
      lines: [{ id: "L1", container_type_code: "40HC", qty: 3, itemised: 1, delivered_qty: 1, issued_qty: 1 }],
    });
    expect(p.total).toBe(3);              // one itemised box + two open of the line
    expect(p.groups[0]).toMatchObject({ qty: 2, delivered_qty: 1, in_transit_qty: 1, outstanding_qty: 0 });
  });

  test("a fully itemised line disappears rather than double-counting", () => {
    const p = rules.deliveryProgress({
      units: [unit("A"), unit("B")],
      lines: [{ id: "L1", qty: 2, itemised: 2, delivered_qty: 0, issued_qty: 0 }],
    });
    expect(p.total).toBe(2);
    expect(p.groups).toEqual([]);
  });

  test("the position is null for a file with no containers", () => {
    // A non-containerised note says nothing about container counts. "0 of 0" is
    // not an improvement on silence.
    expect(rules.deliveryPosition(rules.deliveryProgress({ units: [] }), { sequence: 1, ofNotes: 1 })).toBeNull();
    expect(rules.deliveryPosition(null, {})).toBeNull();
  });

  test("the position carries the run and the file's counts together", () => {
    const p = rules.deliveryProgress({ units: [unit("A", { is_delivered: true }), unit("B", { is_issued: true })] });
    expect(rules.deliveryPosition(p, { sequence: 2, ofNotes: 3 }))
      .toEqual({ sequence: 2, of_notes: 3, total: 2, delivered: 1, in_transit: 1, outstanding: 0 });
  });
});

/* ── 7. Re-delivering a box somebody already signed for ──────────────────── */

describe("re-delivery is distinguished, then explained", () => {
  const delivered = (ids) => new Map(ids.map((id) => [id, { doc_number: "BL-2026-0007", received_at: "2026-07-20" }]));

  test("a split load passes silently", () => {
    // A box on another ISSUED note is normal — two notes for one run, or a load
    // split between trucks. Only a DELIVERED note reaches this guard at all.
    expect(rules.assertRedeliveryExplained(
      [{ dossier_container_unit_id: "u1", container_no: "TCLU1" }],
      new Map(),
    )).toBe(true);
  });

  test("a box already signed for is refused until somebody says why", () => {
    expect(() => rules.assertRedeliveryExplained(
      [{ dossier_container_unit_id: "u1", container_no: "TCLU1" }],
      delivered(["u1"]),
    )).toThrow(/already been signed for/);
  });

  test("the refusal names the container, not the note", () => {
    // An operator re-delivering one box out of nine needs to know which.
    try {
      rules.assertRedeliveryExplained(
        [
          { dossier_container_unit_id: "u1", container_no: "TCLU1" },
          { dossier_container_unit_id: "u2", container_no: "TCLU2" },
        ],
        delivered(["u2"]),
      );
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err.code).toBe("ALREADY_DELIVERED");
      expect(err.details.containers).toEqual({ TCLU2: "already signed for on BL-2026-0007" });
    }
  });

  test("a reason lets it through, and the reason is what gets printed", () => {
    expect(rules.assertRedeliveryExplained(
      [{ dossier_container_unit_id: "u1", container_no: "TCLU1", redelivery_reason: "Retour: porte endommagée" }],
      delivered(["u1"]),
    )).toBe(true);
  });

  test("a hand-typed box is never accused — it points at nothing on the file", () => {
    expect(rules.assertRedeliveryExplained(
      [{ container_no: "TCLU9", dossier_container_unit_id: null }],
      delivered(["u1"]),
    )).toBe(true);
  });
});
