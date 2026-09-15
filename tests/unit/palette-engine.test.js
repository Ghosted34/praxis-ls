/**
 * The palette engine's promise, asserted.
 *
 * ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
 *
 * `packages/shared/design/palette.js` claims that ANY tenant colour, including
 * one chosen with no thought for legibility, yields a complete token set that
 * clears WCAG AA in BOTH themes. That claim is the entire reason the engine
 * exists rather than a table of hand-picked hex values, and it is not the kind
 * of claim a reviewer can check by looking.
 *
 * So it is measured here, across eight palettes, in two themes, for every pair
 * the engine promises — and the hostile ones are the point. A tenant WILL pick
 * a near-white primary because it looks good on their letterhead; a tenant WILL
 * pick a neon green because it is in their logo. The palettes below are not
 * synthetic edge cases, they are the Tuesday this product has to survive.
 *
 * ── THE ONE THAT IS NOT ABOUT CONTRAST ─────────────────────────────────────
 *
 * `harmoniseModes: false` must reproduce the ERP's transport-mode triplets
 * EXACTLY, byte for byte, against the literals in client/src/index.css. That is
 * what stops this work shifting the Control Tower's colours as a side effect —
 * see doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md §1.4 for the scope of the amendment.
 * If that test fails, the ERP has moved and the PR is wrong.
 */
"use strict";

const {
  derivePalette,
  auditTheme,
  AA_PAIRS,
  UI_PAIRS,
  MODES,
  MODE_HUE_MAX_PULL,
} = require("../../packages/shared/design/palette");
const {
  contrast,
  hexToOklch,
  hueDelta,
  tripletToHex,
  normaliseColor,
  oklchToHex,
} = require("../../packages/shared/design/color");

/**
 * Eight palettes. Two are real (the tenant we ship and the Praxis brand); six
 * are chosen to break a naive derivation in a specific way.
 */
const PALETTES = {
  "smart logistics (orange + blue)": { primary: "#FF5A00", secondary: "#1884C4" },
  "praxis (orange + slate)": { primary: "#FF5A00", secondary: "#7E8286" },
  "single near-white": { primary: "#FAFAF8" },
  "single near-black": { primary: "#0B0B0C" },
  "fully desaturated": { primary: "#7E8286" },
  "maximum chroma neon": { primary: "#00FF6A" },
  "two colours 6 degrees apart": { primary: "#2266DD", secondary: "#2E6BD8" },
  "magenta, no second colour": { primary: "#D6009B" },
};

const THEMES = ["light", "dark"];

describe("palette engine — accessibility", () => {
  for (const [name, input] of Object.entries(PALETTES)) {
    for (const theme of THEMES) {
      test(`${name} · ${theme} · every promised pair clears its floor`, () => {
        const rows = auditTheme(derivePalette(input)[theme]);
        // Every pair the engine promises is actually measured — a shrinking
        // pair list would make this suite pass by checking less.
        expect(rows).toHaveLength(AA_PAIRS.length + UI_PAIRS.length);
        const failing = rows
          .filter((r) => !r.ok)
          .map((r) => `${r.fg} on ${r.bg} = ${r.ratio}:1 (needs ${r.required})`);
        expect(failing).toEqual([]);
      });
    }
  }

  test("every emitted token parses as a colour in both representations", () => {
    for (const input of Object.values(PALETTES)) {
      const p = derivePalette(input);
      for (const theme of THEMES) {
        for (const [token, value] of Object.entries(p[theme])) {
          expect({ token, ok: normaliseColor(value) !== null }).toEqual({
            token,
            ok: true,
          });
        }
      }
    }
  });
});

describe("palette engine — the ERP must not move", () => {
  /** The literals in client/src/index.css. Copied deliberately: if someone
   *  changes the engine's anchors, this fails and names the file to check. */
  const ERP_LIGHT = {
    "--mode-sea": "40 148 94",
    "--mode-air": "28 155 215",
    "--mode-road": "224 122 26",
    "--mode-rail": "147 51 234",
  };
  const ERP_DARK = {
    "--mode-sea": "74 190 133",
    "--mode-air": "98 196 245",
    "--mode-road": "247 158 66",
    "--mode-rail": "192 132 252",
  };

  test("harmoniseModes:false reproduces client/src/index.css exactly", () => {
    const p = derivePalette({ primary: "#FF5A00", harmoniseModes: false });
    for (const [token, expected] of Object.entries(ERP_LIGHT)) {
      expect(`light ${token}=${p.light[token]}`).toBe(`light ${token}=${expected}`);
    }
    for (const [token, expected] of Object.entries(ERP_DARK)) {
      expect(`dark ${token}=${p.dark[token]}`).toBe(`dark ${token}=${expected}`);
    }
  });

  test("the no-op path is independent of the tenant's colour", () => {
    const a = derivePalette({ primary: "#FF5A00", harmoniseModes: false });
    const b = derivePalette({ primary: "#00FF6A", harmoniseModes: false });
    for (const theme of THEMES) {
      for (const mode of Object.keys(MODES)) {
        expect(a[theme][`--mode-${mode}`]).toBe(b[theme][`--mode-${mode}`]);
      }
    }
  });
});

describe("palette engine — harmonisation stays inside its bounds", () => {
  test(`a harmonised mode hue never moves more than ${MODE_HUE_MAX_PULL} degrees`, () => {
    for (const [name, input] of Object.entries(PALETTES)) {
      const p = derivePalette(input);
      for (const theme of THEMES) {
        for (const mode of Object.keys(MODES)) {
          const anchorHue = hexToOklch(MODES[mode][theme]).h;
          const hex = tripletToHex(p[theme][`--mode-${mode}`]);
          const moved = Math.abs(hueDelta(anchorHue, hexToOklch(hex).h));
          // A mode walked for contrast can shift hue slightly through gamut
          // mapping, so the tolerance is the pull limit plus a small epsilon
          // rather than an exact bound.
          expect({ name, theme, mode, within: moved <= MODE_HUE_MAX_PULL + 2 }).toEqual({
            name,
            theme,
            mode,
            within: true,
          });
        }
      }
    }
  });

  test("modes never go grey and never out-shout the accent", () => {
    for (const input of Object.values(PALETTES)) {
      const p = derivePalette(input);
      for (const theme of THEMES) {
        for (const mode of Object.keys(MODES)) {
          const anchorC = hexToOklch(MODES[mode][theme]).c;
          const c = hexToOklch(tripletToHex(p[theme][`--mode-${mode}`])).c;
          expect(c).toBeGreaterThan(anchorC * 0.5);
          expect(c).toBeLessThan(anchorC * 1.5);
        }
      }
    }
  });
});

describe("palette engine — derivation rules", () => {
  test("a single colour still yields a distinct secondary and tertiary", () => {
    const p = derivePalette({ primary: "#FF5A00" });
    expect(p.meta.derived).toEqual({ secondary: true, tertiary: true });
    const ink = hexToOklch(p.light["--primary-ink"]).h;
    const sec = hexToOklch(p.light["--secondary-ink"]).h;
    const ter = hexToOklch(p.light["--tertiary-ink"]).h;
    // Far enough apart to read as different, close enough to read as a family.
    expect(Math.abs(hueDelta(ink, sec))).toBeGreaterThan(12);
    expect(Math.abs(hueDelta(ink, ter))).toBeGreaterThan(12);
    expect(Math.abs(hueDelta(sec, ter))).toBeLessThan(120);
  });

  test("a supplied secondary is used rather than derived", () => {
    const p = derivePalette({ primary: "#FF5A00", secondary: "#1884C4" });
    expect(p.meta.derived.secondary).toBe(false);
    // Blue in, blue out — the ink step-down holds hue.
    expect(hexToOklch(p.light["--secondary-ink"]).h).toBeCloseTo(
      hexToOklch("#1884C4").h,
      0,
    );
  });

  test("the brand orange reproduces the documented corrections", () => {
    const p = derivePalette({ primary: "#FF5A00" });
    // packages/brand records these three as measured properties of the colour.
    expect(Number(contrast("#FF5A00", "#ffffff").toFixed(2))).toBe(3.13);
    expect(Number(contrast("#0A0A0A", "#FF5A00").toFixed(2))).toBe(6.33);
    // On light it must step down; on dark it already clears and must NOT move.
    expect(p.light["--primary-ink"]).not.toBe("#FF5A00");
    expect(p.dark["--primary-ink"]).toBe("#FF5A00");
    // And the label on an orange fill is carbon, never white.
    expect(p.light["--primary-foreground"]).toBe("#0a0a0a");
  });

  test("corrections are reported so the settings preview can explain them", () => {
    const p = derivePalette({ primary: "#FF5A00" });
    const ink = p.meta.corrections.find(
      (c) => c.theme === "light" && c.token === "--primary-ink",
    );
    expect(ink).toBeTruthy();
    expect(ink.fromRatio).toBeLessThan(4.5);
    expect(ink.toRatio).toBeGreaterThanOrEqual(4.5);
  });

  test("a mid-tone fill with no legible label has its fill darkened", () => {
    // Neither carbon nor white clears 4.5:1 on a mid grey, so the engine must
    // move the FILL rather than ship an unreadable button.
    const p = derivePalette({ primary: "#808080" });
    expect(contrast(p.light["--primary"], p.light["--primary-foreground"])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("palette engine — robustness", () => {
  test("is deterministic", () => {
    const a = derivePalette({ primary: "#FF5A00", secondary: "#1884C4" });
    const b = derivePalette({ primary: "#FF5A00", secondary: "#1884C4" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("garbage in falls back rather than throwing", () => {
    // This runs at request time against a row a past migration or a
    // hand-edited seed may have filled with anything. The correct failure is a
    // default palette, not a 500 on the tenant's home page.
    for (const bad of [undefined, null, {}, { primary: "" }, { primary: "nope" }, { primary: 42 }]) {
      const p = derivePalette(bad);
      expect(auditTheme(p.light).every((r) => r.ok)).toBe(true);
      expect(p.meta.input.primary).toBe("#ff5a00");
    }
  });

  test("colour maths round-trips without drift", () => {
    for (const hex of ["#ff5a00", "#1884c4", "#0a0a0a", "#ffffff", "#7e8286", "#00ff6a"]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  test("a triplet is never measured as a hex by accident", () => {
    // The defect this pins: normaliseColor() did not exist, auditTheme handed
    // "40 148 94" straight to contrast(), parseHex returned null, and four mode
    // colours reported 1.15:1 when they were actually fine. A silent zero is
    // worse than a throw because it reports a FAILURE that is not real, which
    // is how a correct palette gets "fixed".
    expect(tripletToHex("40 148 94")).toBe("#28945e");
    expect(tripletToHex("999 0 0")).toBeNull();
    expect(normaliseColor("40 148 94")).toBe("#28945e");
    expect(normaliseColor("#28945e")).toBe("#28945e");
    expect(normaliseColor("rgb(40 148 94)")).toBe("#28945e");
  });
});
