"use strict";

/**
 * The costing sheet as a DOCUMENT — what it must say, and what it must not.
 *
 * WHAT THESE PIN, and why each is a defect that has already happened once.
 *
 * 1. THE DOC TYPE IS REGISTERED. `COSTING` had a template and a projection and
 *    was never in `DOC_TYPES`, so `assertDocType` threw 422 UNKNOWN_DOC_TYPE
 *    and `document_vault.capture()` refused it: the sheet could be previewed
 *    and printed and could never be FILED. Nothing failed loudly — the capture
 *    is best-effort at every call site — so no approved costing in any tenant
 *    has a vault copy of what was approved. A registry test is the only thing
 *    that keeps that from coming back.
 *
 * 2. NO RAW ENUM ON A4. The legacy sheet printed `SUBMITTED_FOR_VALIDATION` at
 *    a person. Statuses leave the rules as a {fr, en} pair and the template
 *    picks a side.
 *
 * 3. VAT IS AN AMOUNT, AND A DÉBOURS SAYS WHY IT HAS NONE. The legacy column
 *    was a percentage, so a mispriced line could only be found with a
 *    calculator; and its VAT box defaulted to ticked, which is how its sample
 *    sheet charges 19.25% VAT on a customs duty.
 *
 * 4. UPSTREAM VAT IS DISCLOSED AND IN NO TOTAL. The Maersk case: we pay
 *    119,250, we re-bill 119,250, and the 19,250 inside it was never ours.
 *
 * 5. THE EQUIPMENT IS IN THE DESCRIPTION. Demurrage is one line per container
 *    type, so without it the sheet prints "Demurrage" twice with two different
 *    amounts and no way to tell which box is which.
 *
 * 6. THE SEAL ATTESTS TO THE BUDGET. Line identity in the canonical payload
 *    includes the container type, and nature includes `is_disbursement` —
 *    editing either after approval must invalidate the seal.
 *
 * Every assertion reads the OUTPUT of the template or the RETURN of a pure
 * function. Reading the plumbing is what let an unregistered doc type survive.
 */

const registry = require("../../src/services/documents/templates/registry");
const kit = require("../../src/services/documents/templates/kit");
const canonical = require("../../src/services/signatures/canonical");
const rules = require("../../src/modules/costing/costing/costing.rules");
const {
  DOC_TYPES,
  isDocType,
  assertDocType,
  moduleKeyForDocType,
  signaturePolicyFor,
} = require("../../src/modules/vault/document_vault/document_vault.types");

const TPL = registry.get("COSTING");

/** The entity as the RENDERER receives it — derived lines, not raw columns. */
const ENTITY = {
  legal_name: "SMART LOGISTICS AND SERVICES LTD",
  address_lines: ["1030, Avenue Douala Manga Bell, Bali", "PO Box 5120, Douala, Cameroun"],
  identifiers: [{ kind: "RCCM", number: "RC/DLA/2021/B/2060" }, { kind: "NIU", number: "M042116033580Q" }],
  city: "Douala",
  niu: "M042116033580Q",
};

const cfgFor = (language, extra = {}) => kit.mergeCfg({}, { language, ...extra });
const dataWith = (patch = {}) => ({ ...JSON.parse(JSON.stringify(TPL.sampleData)), ...patch });

/**
 * The document WITHOUT its stylesheet. `kit.shell` inlines a stylesheet whose
 * comments are legitimately in English, so a grep over the raw string finds
 * English words on a French document that never prints one.
 */
const body = (html) => String(html).replace(/<style>[\s\S]*?<\/style>/g, "");

/**
 * Money is formatted with `toLocaleString("fr-FR")`, whose thousands separator
 * is U+202F (narrow no-break space) — not the space a test literal contains.
 * An assertion written with a plain space fails against a page that is
 * correct, so every space-like character is normalised here rather than
 * pasting invisible ones into the expectations below.
 */
const norm = (html) => String(html).replace(/[\u00a0\u202f\u2009]/g, " ");
const render = (patch = {}, language = "en") =>
  norm(body(TPL.build(dataWith(patch), cfgFor(language), ENTITY, null)));

/* ── 1. The doc type exists ──────────────────────────────────────────────── */

describe("COSTING is a registered doc type", () => {
  test("the vault accepts it — capture() used to refuse the only document this module makes", () => {
    expect(isDocType("COSTING")).toBe(true);
    expect(assertDocType("COSTING")).toBe("COSTING");
  });

  test("reading it follows MOD-46, not the Settings grant", () => {
    // `moduleKeyForDocType` falls back to MOD-70 for anything unregistered, so
    // an unregistered costing was readable only by whoever administered the
    // application — and by everyone who did.
    expect(moduleKeyForDocType("COSTING")).toBe("MOD-46");
    expect(DOC_TYPES.COSTING.module).toBe("costing/costing");
  });

  test("it is signable, but neither certified nor wet", () => {
    const p = signaturePolicyFor("COSTING");
    expect(p.signable).toBe(true);
    // Certification costs money per envelope and a costing never leaves the
    // building; the wet path cannot be applied by a transition at all.
    expect(p.allowsQes).toBe(false);
    expect(p.allowsWet).toBe(false);
  });
});

/* ── 2. Statuses in words ────────────────────────────────────────────────── */

describe("the status is said out loud", () => {
  test("the rules answer with a pair, never a joined string", () => {
    expect(rules.statusWords("APPROVED_LOCKED")).toEqual({ fr: "Approuvée", en: "Approved" });
    // An unknown status echoes rather than resolving to a blank: a sheet in a
    // state nobody has named must still print something the reader can report.
    expect(rules.statusWords("WHAT")).toEqual({ fr: "WHAT", en: "WHAT" });
  });

  test("the enum never reaches the page", () => {
    const html = render({ status: "SUBMITTED_FOR_VALIDATION", status_words: rules.statusWords("SUBMITTED_FOR_VALIDATION") });
    expect(html).toContain("To validate");
    expect(html).not.toContain("SUBMITTED_FOR_VALIDATION");
  });

  test("a French sheet prints French alone", () => {
    const html = render({ status_words: rules.statusWords("APPROVED_LOCKED") }, "fr");
    expect(html).toContain("Approuvée");
    expect(html).not.toContain("Approved");
  });
});

/* ── 3. VAT is an amount; a débours shows it with (PT) ────────────────────── */

describe("the VAT column is an amount, and a débours is marked (PT)", () => {
  test("a taxed line shows the VAT amount, not the rate", () => {
    // 2 × 500,000 at 19.25% = 192,500. 12768: just the figure — the "(19.25%)"
    // in brackets was noise on a document (the reader has the amount).
    const html = render();
    expect(html).toContain("192 500 XAF");
    expect(html).not.toContain("192 500 XAF (19.25%)");
  });

  test("a débours shows its supplier VAT with (PT) after it", () => {
    // 45'HC surestaries: 100,000 net, 19,250 supplier VAT, re-billed at cost.
    expect(render()).toContain("19 250 XAF (PT)");
  });

  test("a débours with no VAT shows just (PT), never a rate", () => {
    const html = render();
    // The customs-duty line carries no supplier VAT — (PT) alone, no 19.25%.
    expect(html).toContain("(PT)");
    expect(html).not.toMatch(/Droits et taxes de douane[\s\S]{0,220}19\.25%/);
  });

  test("the débours sub-total sits inside the totals — at cost, not 'untaxed'", () => {
    const html = render();
    expect(html).toContain("of which débours (at cost)");
    // The old label claimed débours were untaxed; they are budgeted now.
    expect(html).not.toContain("untaxed");
  });
});

/* ── 4. The supplier's VAT is budgeted into the total ─────────────────────── */

describe("débours VAT is in the total, and named", () => {
  test("the VAT total includes the débours VAT (192,500 + 19,250 = 211,750)", () => {
    // The sample's VAT is the service line's 192,500 PLUS the débours 19,250,
    // which is the whole point of 12768: the budget accounts for the cash.
    expect(render()).toContain("211 750 XAF");
  });

  test("a memo names how much of the VAT is the supplier's on débours (PT)", () => {
    expect(render()).toContain("of which on débours (PT)");
  });

  test("a sheet with no débours VAT prints no such memo", () => {
    const html = render({ totals: { ...TPL.sampleData.totals, upstream_vat_total: 0 } });
    expect(html).not.toContain("of which on débours (PT)");
  });

  test("every débours gets a remarks line, above the pricer's own remarks", () => {
    const html = render();
    // A line per pass-through explaining what (PT) means…
    expect(html).toMatch(/\(PT\)[^<]*Surestaries[^<]*disbursement re-billed at cost/);
    // …and the user's remark still prints, after them.
    expect(html).toContain("Taux carrier confirmé le 25/07");
    const firstNote = html.indexOf("disbursement re-billed at cost");
    const userRemark = html.indexOf("Taux carrier confirmé");
    expect(firstNote).toBeGreaterThan(-1);
    expect(userRemark).toBeGreaterThan(firstNote);
  });
});

/* ── 5. The equipment, and the facts ─────────────────────────────────────── */

describe("the sheet names what it is pricing", () => {
  test("a per-container charge names its box", () => {
    // Two demurrage lines that differ only by equipment are unreadable without
    // it — and demurrage IS one line per container type.
    expect(render()).toContain("45'HC");
  });

  test("the shipment facts print, and an empty one is omitted rather than dashed", () => {
    const html = render();
    expect(html).toContain("MAEU123456");
    expect(html).toContain("Antwerp");
    const bare = render({ bl_mawb: null, pol: null, pod: null, eta: null, incoterm: null, carrier: null });
    expect(bare).not.toContain("B/L");
    // A page of dashes reads as a broken render, not as a file with less on it.
    expect(bare).not.toContain("Port of loading");
  });

  test("the counterparty is named — the payload the portal reads", () => {
    expect(render()).toContain("CIMENCAM SA");
  });

  test("the amount is written out, as every other money document does", () => {
    expect(render()).toContain("Amount in words");
  });
});

/* ── 6. The seals ────────────────────────────────────────────────────────── */

describe("the seals", () => {
  const SEAL = (reason) => ({
    forParty: ENTITY.legal_name,
    reason,
    signerName: "Jean Mbarga",
    signerRole: "Operations Officer",
    signedAt: "28 juil. 2026, 09:12 WAT",
    method: "Session",
    docRef: "CST-2026-0012",
    contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    code: "A4B7K92MXQ1P",
    qrSvg: '<svg id="seal-qr"></svg>',
  });

  test("all three print, each naming the decision it records", () => {
    const html = render({
      seals: [SEAL("Accusé de réception"), SEAL("Examiné et accepté"), SEAL("Approuvé pour expédition")],
    });
    expect(html).toContain("Accusé de réception");
    expect(html).toContain("Examiné et accepté");
    expect(html).toContain("Approuvé pour expédition");
  });

  test("an unsealed sheet still offers somewhere to sign", () => {
    // A DRAFT printed for a desk review has nobody to seal it yet, and a page
    // with neither seals nor signature lines cannot be signed at all.
    const html = render({ seals: [] }, "fr");
    expect(html).toContain('class="sig"');
  });
});

/* ── 7. What the seal attests to ─────────────────────────────────────────── */

describe("the canonical payload", () => {
  const base = {
    number: "CST-1", date: "2026-07-27", status: "APPROVED_LOCKED", dossier_ref: "SBX-1",
    currency: "XAF", exchange_rate: 1, party: { name: "CIMENCAM SA", lines: [] },
    carrier: "Maersk", incoterm: "CIF", bl_mawb: "MAEU1", pol: "Antwerp", pod: "Douala", eta: "2026-08-14",
    lines: [
      { label: "Surestaries", container_type: "40'DRY", qty: 1, unit: 100000, tax: null, is_disbursement: true, upstream_vat: 0, amount: 100000 },
      { label: "Surestaries", container_type: "20'DRY", qty: 1, unit: 60000, tax: null, is_disbursement: true, upstream_vat: 0, amount: 60000 },
    ],
    totals: { total_ht: 160000, vat_total: 0, total_ttc: 160000, disbursement_total: 160000, upstream_vat_total: 0 },
  };
  const h = (d) => canonical.hash("COSTING", d);

  test("swapping two per-container amounts changes the hash", () => {
    // Without `container_type` in the line, these two payloads are the same
    // multiset of labels and amounts, and moving the 40' price onto the 20'
    // would leave a signed sheet reading as unchanged.
    const swapped = {
      ...base,
      lines: [
        { ...base.lines[0], unit: 60000, amount: 60000 },
        { ...base.lines[1], unit: 100000, amount: 100000 },
      ],
    };
    expect(h(swapped)).not.toBe(h(base));
  });

  test("flipping a line's nature changes the hash, though no amount moved", () => {
    const reclassified = {
      ...base,
      lines: [{ ...base.lines[0], is_disbursement: false }, base.lines[1]],
    };
    expect(h(reclassified)).not.toBe(h(base));
  });

  test("changing the shipment changes the hash — the same charges, a different commitment", () => {
    expect(h({ ...base, pod: "Kribi" })).not.toBe(h(base));
  });

  test("the exchange rate is attested — a foreign-currency budget has an XAF value", () => {
    expect(h({ ...base, exchange_rate: 600 })).not.toBe(h(base));
  });

  test("the remarks are NOT attested — a note to the validator is not a term", () => {
    expect(h({ ...base, remarks: "anything at all" })).toBe(h(base));
  });

  test("the amendment summary is NOT attested — it is a derived view, not the commitment", () => {
    // Hashing it would make every seal read AMENDED the moment somebody
    // touched a line, which is the opposite of what the status means.
    expect(h({ ...base, amendment: { has_changes: true, added: [], changed: [], removed: [] } })).toBe(h(base));
  });
});
