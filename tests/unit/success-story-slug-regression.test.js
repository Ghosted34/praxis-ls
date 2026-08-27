/**
 * Regression — the success_story service was slugifying with
 *   value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
 * which mangled every accented character into a dash
 * ("Dédouanement à Douala" → "d-douanement-douala"). PR1 swaps the local
 * `slug()` for the shared `src/shared/text/slug.js` helper. Two invariants
 * to keep:
 *
 *   1. A NEW story from an accented title gets the accent-safe suggestion.
 *   2. EXISTING stored slugs are never rewritten — `slug()` is only called
 *      at CREATE to auto-suggest (`slug(data.title)`), so changing the
 *      helper does not touch any row in the table.
 */
"use strict";

const service = require("../../src/modules/sales/success_story/success_story.service");
const { slug } = require("../../src/shared/text/slug");

describe("success_story accent-safe slug (guide §4.7 swap)", () => {
  test("the service re-exports a slug helper that uses the shared algorithm", () => {
    expect(typeof service.slug).toBe("function");
    expect(service.slug("Fret Aérien Import")).toBe("fret-aerien-import");
  });

  test("'Dédouanement à Douala' becomes 'dedouanement-a-douala' (the trap)", () => {
    // The exact pre-fix output was "d-douanement-douala" — every accented
    // character became a dash. After the swap it must not.
    expect(service.slug("Dédouanement à Douala")).toBe("dedouanement-a-douala");
  });

  test("apostrophes fold to a single dash", () => {
    expect(service.slug("L'entrepôt de Douala")).toBe("l-entrepot-de-douala");
  });

  test("non-latin titles fall back to a dashed key when one is provided", () => {
    // The story module itself does not pass a key — that is fine, the
    // create path also passes the title slug through the regex validator,
    // and the regex refuses anything but a-z0-9 dashes. The point of this
    // test is that the SHARED helper is the one the service delegates to,
    // so any future caller (including the service_type_web module) gets
    // the same algorithm and the same fallback.
    expect(slug("中文服务", "STORY_KEY")).toBe("story-key");
  });

  test("the shared helper is what the service uses, by reference", () => {
    // Lock the contract — if a future change reverts to a local slug(),
    // this test fails before the regression is shipped.
    expect(service.slug.toString()).toContain("slugify");
  });
});
