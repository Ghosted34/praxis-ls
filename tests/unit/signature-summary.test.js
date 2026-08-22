"use strict";

/**
 * The as-signed summary — doc/SIGNATURE_ENGINEERING_GUIDE.md §5.4, Q12 = B.
 *
 * Two of the assertions here are disclosure decisions rather than behaviour:
 * an unregistered doc type must NOT fall back to dumping the payload, and an
 * employment contract must NOT publish a salary. Both are the kind of thing a
 * later "let's just show what we have" refactor removes without noticing, so
 * both are pinned.
 */

const summary = require("../../src/services/signatures/summary");
const canonical = require("../../src/services/signatures/canonical");
const fixtures = require("../fixtures/signature-canonical.fixtures");
const { signableDocTypes } = require("../../src/modules/vault/document_vault/document_vault.types");

/** A stored payload, built the way a signature row's really is. */
const stored = (docType) => canonical.canonical(docType, fixtures[docType]);

describe("every signable doc type has a summary slot", () => {
  test("no signable type is missing a resolver", () => {
    // The guide asks for the registry to sit beside DOC_TYPES so a new signable
    // type cannot be added without someone seeing the summary slot. It lives
    // next to canonical.js instead — the coupling that actually bites, since
    // these resolvers read the shape those builders produce — and THIS is what
    // enforces the slot. Co-location is a hope; a failing build is a gate.
    const missing = signableDocTypes().filter((t) => !summary.hasSummary(t));
    expect(missing).toEqual([]);
  });

  test("no resolver exists for a type that cannot be signed", () => {
    const signable = new Set(signableDocTypes());
    expect(summary.SUMMARISABLE.filter((t) => !signable.has(t))).toEqual([]);
  });

  test.each(signableDocTypes())("%s renders fields from its stored payload", (docType) => {
    const out = summary.summarise(docType, stored(docType), "en");
    expect(out).not.toBeNull();
    expect(out.doc_type).toBe(docType);
    expect(typeof out.title).toBe("string");
    expect(out.title.length).toBeGreaterThan(0);
    expect(out.fields.length).toBeGreaterThan(0);
    for (const f of out.fields) {
      expect(typeof f.label).toBe("string");
      expect(typeof f.value).toBe("string");
    }
  });

  test.each(signableDocTypes())("%s is bilingual", (docType) => {
    const en = summary.summarise(docType, stored(docType), "en");
    const fr = summary.summarise(docType, stored(docType), "fr");
    // Same shape, different words. Not every label DIFFERS between the two
    // ("Date" is "Date"), so the assertion is on the title, which always does.
    expect(fr.fields.map((f) => f.key)).toEqual(en.fields.map((f) => f.key));
    expect(fr.title).not.toBe(en.title);
  });
});

describe("the disclosure rules", () => {
  test("an unregistered doc type returns null, never a dump of the payload", () => {
    // §5.4: "A fallback that dumps whatever columns exist is exactly how a
    // disclosure decision gets made by accident."
    expect(summary.summarise("PAYSLIP", { gross_salary: 900000 }, "en")).toBeNull();
    expect(summary.summarise("SOMETHING_NEW", { secret: "x" }, "en")).toBeNull();
  });

  test("prototype keys do not resolve to a builder", () => {
    // The canonical.js finding, one directory over: a plain object literal
    // returns Object for "constructor" — truthy AND callable, so a
    // `if (!resolver) return null` guard passes and the caller invokes it.
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(summary.summarise(key, {}, "en")).toBeNull();
      expect(summary.hasSummary(key)).toBe(false);
    }
  });

  test("an employment contract does not publish a salary", () => {
    const payload = stored("EMPLOYMENT_CONTRACT");
    // Prove the fixture actually carries one, or the assertion below is vacuous.
    expect(payload.gross_salary).toBeGreaterThan(0);
    const out = summary.summarise("EMPLOYMENT_CONTRACT", payload, "en");
    const text = JSON.stringify(out);
    expect(text).not.toContain(String(payload.gross_salary));
    expect(out.fields.map((f) => f.key)).not.toContain("gross_salary");
  });

  test("an employment contract publishes clause HEADINGS and nothing under them", () => {
    const payload = { ...stored("EMPLOYMENT_CONTRACT"), clauses: ["Confidentiality", "Notice period"] };
    const out = summary.summarise("EMPLOYMENT_CONTRACT", payload, "en");
    expect(out.detail.value).toContain("Confidentiality");
    expect(out.detail.value).toContain("Notice period");
  });

  test("a delivery note's reserves are shown in full — they are the attestation", () => {
    const payload = { ...stored("DELIVERY_NOTE"), reserves: "2 pallets damaged on arrival" };
    const out = summary.summarise("DELIVERY_NOTE", payload, "en");
    expect(out.detail.value).toBe("2 pallets damaged on arrival");
  });

  test("a clean delivery note has no reserves block rather than an empty one", () => {
    const out = summary.summarise("DELIVERY_NOTE", { ...stored("DELIVERY_NOTE"), reserves: "" }, "en");
    expect(out.detail).toBeNull();
  });
});

describe("money is formatted for a printed page, not for a locale library", () => {
  test("grouped with a plain space and suffixed with the payload currency", () => {
    expect(summary.money(1607900, "XAF")).toBe("1 607 900 XAF");
  });

  test("no narrow no-break space — it renders as a box in some PDF viewers", () => {
    // Escapes, not literals: U+202F and U+00A0 are invisible in a diff, and a
    // lint rule rejects irregular whitespace in source for exactly that reason.
    expect(summary.money(1607900, "XAF")).not.toMatch(/[\u202F\u00A0]/);
  });

  test("a whole number keeps no decimals; a fractional one keeps two", () => {
    expect(summary.money(1200, "EUR")).toBe("1 200 EUR");
    expect(summary.money(1200.5, "EUR")).toBe("1 200.50 EUR");
  });

  test("junk formats to an empty string, never to NaN on a legal page", () => {
    expect(summary.money(undefined, "XAF")).toBe("");
    expect(summary.money("not a number", "XAF")).toBe("");
  });
});

describe("the amendment panel names what changed, and shows values only where it may", () => {
  const changes = (before, after) => summary.describeChanges(canonical.diff(before, after), { currency: "XAF", language: "en" });

  test("a scalar field shows its before and after", () => {
    const out = changes({ number: "FCT-1" }, { number: "FCT-2" });
    expect(out).toEqual([{ field: "number", label: "Reference", before: "FCT-1", after: "FCT-2" }]);
  });

  test("a money field is formatted on both sides", () => {
    const out = changes({ total_qty: 12 }, { total_qty: 18 });
    expect(out[0].before).toBe("12 XAF");
    expect(out[0].after).toBe("18 XAF");
  });

  test("a structured field is NAMED and its values withheld", () => {
    // Rendering the current `lines` array would publish the live contents of a
    // document the reader is only entitled to the signed version of — the same
    // defect §5.4 removes from the summary itself.
    const out = changes({ lines: [{ label: "a" }] }, { lines: [{ label: "b" }] });
    expect(out).toEqual([{ field: "lines", label: "Line items", before: null, after: null }]);
  });

  test("totals are named, not itemised", () => {
    const out = changes({ totals: { total_ttc: 1 } }, { totals: { total_ttc: 2 } });
    expect(out[0].before).toBeNull();
    expect(out[0].after).toBeNull();
  });

  test("an unlabelled field fails CLOSED — named from its key, never valued", () => {
    // A field added to a builder without a label here must not publish itself.
    const out = changes({ some_new_field: "old" }, { some_new_field: "new" });
    expect(out).toEqual([{ field: "some_new_field", label: "some new field", before: null, after: null }]);
  });

  test("v and type are not reported as changes", () => {
    expect(changes({ v: 1, type: "A" }, { v: 1, type: "A" })).toEqual([]);
  });
});
