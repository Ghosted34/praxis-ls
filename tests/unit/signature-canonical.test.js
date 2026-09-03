"use strict";

/**
 * GOLDEN DIGEST TEST — doc/SIGNATURE_ENGINEERING_GUIDE.md §3.6.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * IF THIS TEST FAILS, DO NOT UPDATE THE EXPECTED DIGEST.
 *
 * A changed digest means a canonical payload builder changed shape. Every
 * signature ever issued against that doc type has just stopped verifying: the
 * recomputed hash no longer matches any stored one, so every signed document in
 * every tenant now reads as AMENDED — a silent, total, un-noticed failure that
 * would surface months later as "why does the portal say our invoices were
 * tampered with".
 *
 * WHAT TO DO INSTEAD: bump `v` in the builder, add a NEW branch for the new
 * version, keep the old branch reachable, and add a fixture + digest for the new
 * version alongside the existing one. canonical.hash() dispatches on the version
 * stored on the signature row, so old rows keep verifying against old logic.
 * ══════════════════════════════════════════════════════════════════════════
 */

const canonical = require("../../src/services/signatures/canonical");
const fixtures = require("../fixtures/signature-canonical.fixtures");
const { signableDocTypes } = require("../../src/modules/vault/document_vault/document_vault.types");

/** The AppError code a call throws, or null if it did not throw. Asserting on
 *  the code rather than the message keeps these tests from breaking when the
 *  human-facing wording is improved. */
function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code || err.message;
  }
}

const GOLDEN = {
  FINAL_INVOICE: "b84eb88ad6321b2f8e6cbed5d623a9ca9e56d4e0fba6bf4d55520f20b4ff4c80",
  PROFORMA_ADVANCE: "b3dcbd312d3fae46786af8df8490a307d91231b70863864213e29b53b1f5f23a",
  QUOTATION: "de85bb78954737be67de158f5c62b3cfa4037f2fd937e10bbb3c46b000b39d26",
  PROPOSAL: "9e6d51eb2519cc4888d74d66e5291a93cb9cf91d7e310d0da6003557b690adaa",
  PURCHASE_ORDER: "8db9884465222b57f12edce2f7478a8fb54e5c77ed7d52485ec5e9e411a81e0d",
  DELIVERY_NOTE: "019a44b5e71f5b6327daf03b71c2a2b7d24828e7341d79383b54623bac104ad5",
  TRANSIT_ORDER: "6b95a5a8bb8a2860e881f0c40e9d054fe68382cc3a459e64bc6663a5583cb821",
  EMPLOYMENT_CONTRACT: "36af8a718a8e31fbbd73d076e537d9f7cc1a8abf4e784b962c5d1329435c7b3b",
  COSTING: "e95d4f53d1b05af3c9673f0b839ec3416771c5f8843466f660fbd16eca66c6f9",
};

describe("canonical payload — golden digests", () => {
  for (const [docType, expected] of Object.entries(GOLDEN)) {
    test(`${docType} hashes to its pinned digest`, () => {
      expect(canonical.hash(docType, fixtures[docType])).toBe(expected);
    });
  }

  test("every signable doc type has a builder, a fixture and a digest", () => {
    // The three lists are maintained in three files and WILL drift apart. This
    // is the assertion that makes the drift a failed build rather than a doc
    // type that silently cannot be signed.
    const ceiling = signableDocTypes().sort();
    expect(canonical.SIGNABLE.slice().sort()).toEqual(ceiling);
    expect(Object.keys(fixtures).sort()).toEqual(ceiling);
    expect(Object.keys(GOLDEN).sort()).toEqual(ceiling);
  });
});

describe("canonical payload — the hashed contract", () => {
  test("key order is stable across rebuilds", () => {
    const a = JSON.stringify(canonical.canonical("FINAL_INVOICE", fixtures.FINAL_INVOICE));
    const b = JSON.stringify(canonical.canonical("FINAL_INVOICE", { ...fixtures.FINAL_INVOICE }));
    expect(a).toBe(b);
  });

  test("money rounds to 2dp and quantities to 3dp inside the builder", () => {
    // A float that renders as 1200.00 and one that is 1200.004 must hash the
    // same, or a signature goes stale on an artefact nobody can see on the page.
    const base = { ...fixtures.FINAL_INVOICE };
    const nudged = {
      ...base,
      totals: { ...base.totals, total_ttc: base.totals.total_ttc + 0.0004 },
      lines: base.lines.map((l) => ({ ...l, qty: l.qty + 0.00004 })),
    };
    expect(canonical.hash("FINAL_INVOICE", nudged)).toBe(GOLDEN.FINAL_INVOICE);
  });

  test("a change a human would notice DOES change the digest", () => {
    const tampered = {
      ...fixtures.FINAL_INVOICE,
      totals: { ...fixtures.FINAL_INVOICE.totals, total_ttc: fixtures.FINAL_INVOICE.totals.total_ttc + 1 },
    };
    expect(canonical.hash("FINAL_INVOICE", tampered)).not.toBe(GOLDEN.FINAL_INVOICE);
  });

  test("delivery-note reserves are part of the attestation", () => {
    // A delivery signed "2 pallets damaged" and one signed clean are different
    // attestations. Editing the reserves afterwards must invalidate the signature.
    const clean = { ...fixtures.DELIVERY_NOTE, reserves: "" };
    expect(canonical.hash("DELIVERY_NOTE", clean)).not.toBe(GOLDEN.DELIVERY_NOTE);
  });

  test("employment contract carries clause HEADINGS, never bodies", () => {
    const payload = canonical.canonical("EMPLOYMENT_CONTRACT", fixtures.EMPLOYMENT_CONTRACT);
    expect(payload.clauses).toEqual(["Confidentialité", "Non-concurrence", "Clause de mobilité"]);
    expect(JSON.stringify(payload)).not.toMatch(/body|texte integral/i);
  });

  test("an unregistered doc type throws rather than hashing nothing", () => {
    expect(() => canonical.hash("PAYSLIP", {})).toThrow(/NO_CANONICAL_PAYLOAD|canonical signature payload/);
  });

  /**
   * REGRESSION — CodeQL js/unvalidated-dynamic-method-call, High.
   *
   * `docType` arrives from a request body, and BUILDERS was a plain object
   * literal. BUILDERS["constructor"] resolved to `Object` — truthy AND callable
   * — so the `if (!builder) throw` guard passed and hash("constructor", {})
   * returned a real-looking sha256 for a document type that does not exist.
   * Verified broken before the fix.
   */
  test.each([
    "constructor", "toString", "valueOf", "hasOwnProperty", "__proto__",
    "isPrototypeOf", "propertyIsEnumerable", "toLocaleString",
  ])("Object.prototype member %s is not a doc type", (probe) => {
    expect(canonical.isSignable(probe)).toBe(false);
    expect(codeOf(() => canonical.canonical(probe, {}))).toBe("NO_CANONICAL_PAYLOAD");
    expect(codeOf(() => canonical.hash(probe, {}))).toBe("NO_CANONICAL_PAYLOAD");
  });

  test("a non-string doc type throws rather than coercing", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(codeOf(() => canonical.hash(bad, {}))).toBe("NO_CANONICAL_PAYLOAD");
    }
  });

  test("an unimplemented payload version throws rather than silently using v1", () => {
    expect(() => canonical.hash("FINAL_INVOICE", fixtures.FINAL_INVOICE, 2)).toThrow(/version/i);
  });
});

describe("canonical payload — diff", () => {
  test("names the fields that changed, ignoring v and type", () => {
    const before = canonical.canonical("FINAL_INVOICE", fixtures.FINAL_INVOICE);
    const after = canonical.canonical("FINAL_INVOICE", {
      ...fixtures.FINAL_INVOICE,
      totals: { ...fixtures.FINAL_INVOICE.totals, total_ttc: 999 },
    });
    const d = canonical.diff(before, after);
    expect(d.map((x) => x.field)).toEqual(["totals"]);
  });

  test("identical payloads diff to nothing", () => {
    const p = canonical.canonical("QUOTATION", fixtures.QUOTATION);
    expect(canonical.diff(p, p)).toEqual([]);
  });
});
