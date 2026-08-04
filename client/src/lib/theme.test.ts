import { describe, it, expect, afterEach } from "vitest";
import { applyBrand, resetBrand } from "./theme";

/**
 * The accessible-ink derivation (audit F13).
 *
 * A tenant picks a brand colour for how it looks as a BUTTON FILL. Used as TEXT
 * the same colour is usually unreadable — the default #F5821F measures 2.59:1 on
 * white. applyBrand therefore derives --primary-ink per tenant. These tests pin
 * that behaviour, because a regression here silently reintroduces a WCAG failure
 * for every tenant at once.
 */
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const la = luminance(...a);
  const lb = luminance(...b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

function readVar(name: string): [number, number, number] {
  const raw = document.documentElement.style.getPropertyValue(name).trim();
  const m = raw.match(/(\d+)\s+(\d+)\s+(\d+)/);
  if (!m) throw new Error(`${name} not set or unparseable: "${raw}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const WHITE: [number, number, number] = [255, 255, 255]; // --card, light
const DARK_CARD: [number, number, number] = [18, 22, 30]; // --card, dark

describe("applyBrand — accessible accent text", () => {
  afterEach(() => resetBrand());

  const brands = [
    ["SmartLS orange", "#F5821F"],
    ["blue", "#1C9BD7"],
    ["red", "#D9342B"],
    ["green", "#22A06B"],
    ["purple", "#7C5CFF"],
    ["near-black", "#111111"],
    ["near-white", "#FAFAFA"],
  ] as const;

  for (const [name, hex] of brands) {
    it(`derives an AA-passing --primary-ink for ${name} (${hex})`, () => {
      applyBrand({ primary: hex });
      expect(contrast(readVar("--primary-ink-light"), WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(readVar("--primary-ink-dark"), DARK_CARD)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("leaves --primary itself untouched — brand fills must not shift", () => {
    applyBrand({ primary: "#F5821F" });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#F5821F");
  });

  it("does not alter a colour that already passes", () => {
    // #7A3B00 is dark enough to clear 4.5:1 on white unaided.
    applyBrand({ primary: "#7A3B00" });
    expect(readVar("--primary-ink-light")).toEqual([122, 59, 0]);
  });

  it("ignores a non-hex accent rather than writing an invalid value", () => {
    applyBrand({ primary: "not-a-colour" });
    expect(document.documentElement.style.getPropertyValue("--primary-ink-light")).toBe("");
  });

  it("resetBrand clears the derived ink vars", () => {
    applyBrand({ primary: "#1C9BD7" });
    expect(document.documentElement.style.getPropertyValue("--primary-ink-light")).not.toBe("");
    resetBrand();
    expect(document.documentElement.style.getPropertyValue("--primary-ink-light")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--primary-ink-dark")).toBe("");
  });
});
