/**
 * The shared accent-safe slug helper (guide §4.7). The bug being fixed and
 * the table of cases in this file are the same table the guide names — the
 * French-first product's slugs must NFD-normalise before dash-folding.
 */
"use strict";

const { slug, MAX_LEN } = require("../../src/shared/text/slug");

describe("shared accent-safe slug helper", () => {
  test("the guide's headline trap: 'Fret Aérien Import' must NOT become 'fret-a-rien-import'", () => {
    expect(slug("Fret Aérien Import")).toBe("fret-aerien-import");
  });

  test("'Dédouanement' → 'dedouanement' (a single accented word)", () => {
    expect(slug("Dédouanement")).toBe("dedouanement");
  });

  test("apostrophe folded: 'L'entrepôt' → 'l-entrepot' (no leftover apostrophe, no empty)", () => {
    expect(slug("L'entrepôt")).toBe("l-entrepot");
  });

  test("double spaces → one dash; leading/trailing spaces trimmed", () => {
    expect(slug("  Fret   Aérien   Import  ")).toBe("fret-aerien-import");
  });

  test("mixed punctuation folded to a single dash", () => {
    expect(slug("Fret / aérien — import!")).toBe("fret-aerien-import");
  });

  test("> 80 chars cuts at a dash boundary, never mid-word", () => {
    const long = "a".repeat(70) + " " + "b".repeat(20);
    const out = slug(long);
    expect(out.length).toBeLessThanOrEqual(MAX_LEN);
    // The cut must be at a dash boundary, not in the middle of either run.
    expect(out).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(out.endsWith("a")).toBe(true);
    // The trailing "bbb..." must not survive the cut.
    expect(out).not.toMatch(/b/);
  });

  test("exactly 80 characters is preserved when the cut is at a natural boundary", () => {
    const s = "a".repeat(80);
    expect(slug(s)).toBe(s);
  });

  test("non-latin input falls back to the dashed key (never empty)", () => {
    expect(slug("中文服务", "SEA_FREIGHT_IMPORT")).toBe("sea-freight-import");
    expect(slug("中文服务", "RAIL_TRANSPORT")).toBe("rail-transport");
  });

  test("the fallback also goes through the dash-fold (a key with an underscore works)", () => {
    expect(slug("", "FOO_BAR_BAZ")).toBe("foo-bar-baz");
  });

  test("null and undefined produce the key fallback rather than throwing", () => {
    expect(slug(null, "K")).toBe("k");
    expect(slug(undefined, "K_1")).toBe("k-1");
  });

  test("purely numeric or alphanumeric input is unchanged (modulo lowercasing)", () => {
    expect(slug("Service 42 Type B")).toBe("service-42-type-b");
  });

  test("the result always matches the success_story regex /^[a-z0-9]+(?:-[a-z0-9]+)*$/", () => {
    for (const input of [
      "Fret Aérien Import", "Dédouanement", "L'entrepôt",
      "中文服务", "", "  ", "  __  ", "AAA", "a b c d e f g h i j k l m n o p q r s t u v w x y z",
    ]) {
      const out = slug(input, "FALLBACK_KEY");
      expect(out).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(out).not.toBe("");
    }
  });
});
