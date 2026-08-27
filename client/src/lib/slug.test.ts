/**
 * Twin parity tests for `client/src/lib/slug.ts` against the server helper
 * cases in `tests/unit/slug-helper.test.js` (guide §4.7 / §7).
 */
import { describe, it, expect } from "vitest";
import { slug, SLUG_MAX_LEN, isValidSlug, SLUG_RE } from "./slug";

describe("client slug twin (accent-safe)", () => {
  it("the guide's headline trap: 'Fret Aérien Import' → fret-aerien-import", () => {
    expect(slug("Fret Aérien Import")).toBe("fret-aerien-import");
  });

  it("'Dédouanement' → dedouanement", () => {
    expect(slug("Dédouanement")).toBe("dedouanement");
  });

  it("'L'entrepôt' → l-entrepot", () => {
    expect(slug("L'entrepôt")).toBe("l-entrepot");
  });

  it("double spaces collapse to one dash", () => {
    expect(slug("  Fret   Aérien   Import  ")).toBe("fret-aerien-import");
  });

  it("> 80 chars cuts at a dash boundary, never mid-word", () => {
    const long = "a".repeat(70) + " " + "b".repeat(20);
    const out = slug(long);
    expect(out.length).toBeLessThanOrEqual(SLUG_MAX_LEN);
    expect(out).toMatch(SLUG_RE);
    expect(out.endsWith("a")).toBe(true);
    expect(out).not.toMatch(/b/);
  });

  it("non-latin input falls back to the dashed key", () => {
    expect(slug("中文服务", "SEA_FREIGHT_IMPORT")).toBe("sea-freight-import");
    expect(slug("中文服务", "RAIL_TRANSPORT")).toBe("rail-transport");
  });

  it("never returns empty — blank input uses the key fallback", () => {
    expect(slug("", "FOO_BAR_BAZ")).toBe("foo-bar-baz");
    expect(slug(null, "K")).toBe("k");
    expect(slug(undefined, "K_1")).toBe("k-1");
  });

  it("isValidSlug accepts only the server regex shape", () => {
    expect(isValidSlug("fret-aerien-import")).toBe(true);
    expect(isValidSlug("Fret")).toBe(false);
    expect(isValidSlug("fret--x")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});
