"use strict";
/**
 * The palette engine — up to three tenant colours in, a complete, accessible,
 * two-theme token set out.
 *
 * ── WHY THIS IS IN packages/shared AND NOT IN A FRONTEND ───────────────────
 *
 * Three programs must agree on the same palette from the same input: the API
 * (which persists and serves it), the ERP's appearance editor (which promises a
 * tenant what their site will look like BEFORE they save), and the public site
 * (which paints it). A palette derived twice is a palette that diverges, and it
 * diverges in the one place a tenant will certainly notice — the preview
 * telling them something the site then contradicts. Same argument, same
 * package, as `pwa-design.js`: two programs rendering one thing from one
 * settings row.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * It does not touch `--brand-*`. Those are PRAXIS's, never tenant-overridable,
 * and they live in `packages/brand` (see the boundary note there). This engine
 * owns the TENANT layer only: `--primary` and everything derived from it.
 *
 * It does not persist anything. `site_theme` stores the INPUT — three hex
 * values — never this function's output. Storing derived tokens would freeze a
 * tenant's palette against every future improvement to the derivation and give
 * the system two sources of truth for one fact.
 *
 * ── THE PROPERTY THE WHOLE THING RESTS ON ──────────────────────────────────
 *
 * Every surface/text pair it emits clears WCAG AA in BOTH themes, for ANY
 * input — including the inputs a tenant will actually pick, which are chosen to
 * look good as a button fill and are therefore usually illegible as type. The
 * default #F5821F measured 2.59:1 on white; the brand's own #FF5A00 measures
 * 3.13:1. That is not an edge case, it is the normal case, and the reason this
 * file exists rather than a table of hand-picked hex values.
 *
 * The assertion is not a comment. `tests/unit/palette-engine.test.js` runs the
 * full contrast matrix across eight palettes — including deliberately hostile
 * ones — in both themes, and fails the build on any pair under 4.5:1.
 *
 * ── DEFAULTS REPRODUCE TODAY'S DESIGN ──────────────────────────────────────
 *
 * The lightness and chroma targets below were MEASURED from the tokens already
 * in `public-web/src/index.css`, not invented. Handed the Praxis brand orange,
 * the engine emits a palette very close to the one the site ships today. That
 * is deliberate: it makes this a generalisation of a design that was already
 * reviewed, rather than a replacement for it, and it means a regression shows
 * up as a diff against known values instead of as a matter of taste.
 */

const {
  hexToOklch,
  oklchToHex,
  contrast,
  walkToContrast,
  rotateHue,
  hueDelta,
  parseHex,
  toTriplet,
  normaliseColor,
} = require("./color");

/* ── Constants ──────────────────────────────────────────────────────────────*/

/** WCAG 2.1 AA for normal text. Large text (≥18.66px bold / ≥24px) needs 3:1,
 *  and non-text UI needs 3:1 — but nothing here targets those floors: a token
 *  is used at sizes this file cannot see, so every text token is derived to the
 *  strictest requirement it could face. */
const AA = 4.5;
/** Non-text contrast (WCAG 1.4.11) — borders, focus rings, chart strokes. */
const AA_UI = 3;

/** The fallback when a tenant has set nothing. The brand orange, so an
 *  unconfigured tenant renders a Praxis-looking product rather than an
 *  unstyled one — the rule `index.css` already follows. */
const DEFAULT_PRIMARY = "#ff5a00";

/**
 * Surface lightness targets, measured from the shipped tokens (§ file header).
 *
 * `fg` and `mutedFg` are STARTING points, not final values: both are walked
 * against the surface they actually sit on before being emitted, because a
 * tinted surface moves the ground under them.
 */
const SURFACES = {
  light: {
    background: 1.0,
    card: 1.0,
    secondary: 0.9784,
    muted: 0.9637,
    accent: 0.9484,
    fg: 0.2171,
    mutedFg: 0.5055,
    /** Alpha of the ink used for borders and inputs on this theme. */
    borderAlpha: 0.12,
    inputAlpha: 0.22,
    /** How much of the primary's chroma leaks into the neutrals. */
    tint: 0.055,
    tintCap: 0.012,
  },
  dark: {
    background: 0.1635,
    card: 0.1999,
    secondary: 0.1999,
    muted: 0.2308,
    accent: 0.2506,
    fg: 0.9484,
    mutedFg: 0.8099,
    borderAlpha: 0.14,
    inputAlpha: 0.22,
    tint: 0.08,
    tintCap: 0.022,
  },
};

/**
 * Transport modes. Hue is an ANCHOR CONSTANT and is never derived from the
 * tenant's primary — see doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md §1.4 for the exact
 * scope of the amendment this implements. What harmonises is chroma and
 * lightness; hue may be PULLED toward the tenant's palette by at most
 * MODE_HUE_MAX_PULL degrees, which is below the threshold at which a hue reads
 * as a different colour.
 *
 * Values measured from the tokens shipped in client/ and public-web/, so
 * `harmoniseModes: false` reproduces them exactly.
 */
const MODES = {
  sea: { light: "#28945e", dark: "#4abe85" },
  air: { light: "#1c9bd7", dark: "#62c4f5" },
  road: { light: "#e07a1a", dark: "#f79e42" },
  rail: { light: "#9333ea", dark: "#c084fc" },
};

/**
 * The anchors above are HEX, not lightness/chroma/hue constants, and that is
 * load-bearing.
 *
 * The first version of this file stored the polar coordinates, measured to four
 * decimal places. Rebuilding a colour from those and converting back to sRGB
 * lands within a unit or two of the original — which is invisible to the eye and
 * fatal to the promise that `harmoniseModes: false` reproduces the ERP EXACTLY.
 * The test caught it: dark sea came back `79 190 130` against the shipped
 * `74 190 133`.
 *
 * So the hex IS the constant — it is also what `client/src/index.css` actually
 * says, which makes this table checkable against that file by eye — and the
 * polar form is derived from it at call time, only on the path that harmonises.
 */
const modeLch = (name, theme) => hexToOklch(MODES[name][theme]);

const MODE_HUE_MAX_PULL = 10;
const MODE_HUE_PULL_FACTOR = 0.12;
/** How far a mode's chroma may travel toward the tenant's, as a fraction. */
const MODE_CHROMA_BLEND = 0.45;
/** And the band it may never leave, relative to its anchor — a mode that went
 *  grey would stop identifying anything, and one that went neon would compete
 *  with the accent for "press me". */
const MODE_CHROMA_FLOOR = 0.6;
const MODE_CHROMA_CEIL = 1.4;

/**
 * Status colours. Deliberately NOT harmonised toward the brand: a status that
 * shares a hue with the accent stops reading as a status. Hue and chroma are
 * held; only lightness is walked, and only if the theme's surface demands it.
 *
 * `fill` is the saturated value for grounds; the text value is what clears AA
 * on the tint. The split already exists in index.css and is preserved.
 */
const STATUS = {
  ok: { light: "#28945e", dark: "#4fcb86" },
  warn: { light: "#b08018", dark: "#f0b34a" },
  bad: { light: "#d2443a", dark: "#f0837b" },
};

/** Where a derived secondary and tertiary sit when the tenant supplied one
 *  colour. Analogous rather than complementary: a complement reads as a second
 *  brand competing with the first, and on a logistics site the accent's job is
 *  to be the only thing that looks pressable. */
const DERIVED_SECONDARY_ROTATION = 32;
const DERIVED_TERTIARY_ROTATION = -32;

/* ── Helpers ────────────────────────────────────────────────────────────────*/

/** A neutral at `l`, tinted toward `hue` by `chroma`. */
const surface = (l, hue, chroma) => oklchToHex({ l, c: chroma, h: hue });

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The label colour for text sitting ON a fill.
 *
 * THIS IS THE ONE THAT BITES, and `packages/brand` says so in as many words:
 * white on #FF5A00 is 3.13:1 and fails, carbon on the same fill is 6.33:1. So
 * the answer is not "white" and it is not "carbon" — it is whichever of the two
 * clears, and when NEITHER clears (a mid-tone fill leaves no room) the FILL is
 * darkened until carbon does. Returning a failing label would be the one
 * outcome that puts illegible text on the tenant's own call-to-action.
 */
function labelOn(fillHex, ink, paper) {
  const onInk = contrast(fillHex, ink);
  const onPaper = contrast(fillHex, paper);
  if (onInk >= AA || onPaper >= AA) {
    return { fill: fillHex, label: onInk >= onPaper ? ink : paper, adjusted: false };
  }
  const base = hexToOklch(fillHex);
  let best = { fill: fillHex, label: ink, ratio: onInk };
  for (let step = 1; step <= 40; step += 1) {
    const candidate = oklchToHex({ ...base, l: clamp(base.l - step * 0.015, 0, 1) });
    const ratio = contrast(candidate, ink);
    if (ratio > best.ratio) best = { fill: candidate, label: ink, ratio };
    if (ratio >= AA) break;
  }
  return { fill: best.fill, label: best.label, adjusted: true };
}

/* ── The engine ─────────────────────────────────────────────────────────────*/

/**
 * @param {object} input
 * @param {string} input.primary        hex, required (falls back to the brand orange)
 * @param {string|null} [input.secondary]
 * @param {string|null} [input.tertiary]
 * @param {boolean} [input.harmoniseModes=true]  false reproduces the ERP's fixed modes exactly
 * @returns {{ light: Record<string,string>, dark: Record<string,string>, meta: object }}
 */
function derivePalette(input) {
  const raw = input && typeof input === "object" ? input : {};
  const harmonise = raw.harmoniseModes !== false;

  // Anything unparseable falls back rather than throwing: this runs at request
  // time against a row that a past migration or a hand-edited seed may have
  // filled with anything at all, and the correct failure is a default palette,
  // not a 500 on the tenant's home page.
  const primary = parseHex(raw.primary) ? raw.primary.trim() : DEFAULT_PRIMARY;
  const primaryLch = hexToOklch(primary);

  const secondary = parseHex(raw.secondary)
    ? raw.secondary.trim()
    : rotateHue(primary, DERIVED_SECONDARY_ROTATION);
  const tertiary = parseHex(raw.tertiary)
    ? raw.tertiary.trim()
    : rotateHue(primary, DERIVED_TERTIARY_ROTATION);

  const corrections = [];
  const themes = {};

  for (const theme of ["light", "dark"]) {
    const S = SURFACES[theme];
    const hue = primaryLch.h;
    const tintC = Math.min(primaryLch.c * S.tint, S.tintCap);

    const background = surface(S.background, hue, theme === "light" ? 0 : tintC);
    const card = surface(S.card, hue, theme === "light" ? 0 : tintC);
    const secondarySurface = surface(S.secondary, hue, tintC);
    const mutedSurface = surface(S.muted, hue, tintC);
    const accentSurface = surface(S.accent, hue, tintC);

    // Body text is walked against the LIGHTEST ground it will sit on, so it
    // passes on all of them. On light that is `background`/`card`; on dark it
    // is `accent`, which is the most-lifted surface.
    const lightestGround = theme === "light" ? background : accentSurface;
    const fgSeed = surface(S.fg, hue, tintC * 0.5);
    const foreground = walkToContrast(
      fgSeed,
      lightestGround,
      AA,
      theme === "light" ? "darker" : "lighter",
    );
    const mutedSeed = surface(S.mutedFg, hue, tintC * 1.5);
    const mutedForeground = walkToContrast(
      mutedSeed,
      lightestGround,
      AA,
      theme === "light" ? "darker" : "lighter",
    );

    // The accent as TYPE. Not the fill: the fill is chosen to look right as a
    // button and is measured here against the surface type actually sits on.
    const inkDirection = theme === "light" ? "darker" : "lighter";
    const primaryInk = walkToContrast(primary, card, AA, inkDirection);
    if (primaryInk.toLowerCase() !== primary.toLowerCase()) {
      corrections.push({
        theme,
        token: "--primary-ink",
        from: primary,
        to: primaryInk,
        fromRatio: Number(contrast(primary, card).toFixed(2)),
        toRatio: Number(contrast(primaryInk, card).toFixed(2)),
        reason: "accent-as-text",
      });
    }

    // The label on the accent FILL, and the fill itself if it had to move.
    const ink = "#0a0a0a";
    const paper = "#ffffff";
    const onFill = labelOn(primary, ink, paper);
    if (onFill.adjusted) {
      corrections.push({
        theme,
        token: "--primary",
        from: primary,
        to: onFill.fill,
        reason: "no-legible-label",
      });
    }

    const secondaryInk = walkToContrast(secondary, card, AA, inkDirection);
    const tertiaryInk = walkToContrast(tertiary, card, AA, inkDirection);

    const inkTriplet = theme === "light" ? "10 10 10" : "237 238 238";

    const tokens = {
      "--background": background,
      "--foreground": foreground,
      "--card": card,
      "--card-foreground": foreground,
      "--secondary": secondarySurface,
      "--secondary-foreground": foreground,
      "--muted": mutedSurface,
      "--muted-foreground": mutedForeground,
      "--accent": accentSurface,
      "--accent-foreground": foreground,
      "--border": `rgb(${inkTriplet} / ${S.borderAlpha})`,
      "--input": `rgb(${inkTriplet} / ${S.inputAlpha})`,
      "--primary": onFill.fill,
      "--primary-foreground": onFill.label,
      "--primary-ink": primaryInk,
      "--ring": primaryInk,
      "--secondary-ink": secondaryInk,
      "--tertiary-ink": tertiaryInk,
    };

    const modeHex = {};
    // Modes. Anchors held; chroma and lightness harmonised; hue pulled at most
    // MODE_HUE_MAX_PULL degrees. See §1.4 of the guide.
    for (const name of Object.keys(MODES)) {
      const anchorHex = MODES[name][theme];
      let hex = anchorHex;
      if (harmonise) {
        const ref = modeLch(name, theme);
        const pull = clamp(
          hueDelta(ref.h, primaryLch.h) * MODE_HUE_PULL_FACTOR,
          -MODE_HUE_MAX_PULL,
          MODE_HUE_MAX_PULL,
        );
        const wanted = clamp(
          primaryLch.c,
          ref.c * MODE_CHROMA_FLOOR,
          ref.c * MODE_CHROMA_CEIL,
        );
        hex = oklchToHex({
          l: ref.l,
          c: ref.c * (1 - MODE_CHROMA_BLEND) + wanted * MODE_CHROMA_BLEND,
          h: (((ref.h + pull) % 360) + 360) % 360,
        });
      }
      // Modes are drawn as 1.5px strokes and small fills, so they are held to
      // the non-text floor against the card rather than to AA. The unharmonised
      // path is exempt: those values are the ERP's and must not move here.
      if (harmonise && contrast(hex, card) < AA_UI) {
        hex = walkToContrast(hex, card, AA_UI, inkDirection);
      }
      modeHex[name] = hex;
      tokens[`--mode-${name}`] = toTriplet(parseHex(hex));
    }

    const statusHex = {};
    // Status. Hue and chroma held on purpose; lightness walked only if needed.
    for (const name of Object.keys(STATUS)) {
      const fill = STATUS[name][theme];
      const text = walkToContrast(fill, card, AA, inkDirection);
      statusHex[name] = { fill, text };
      tokens[`--${name}`] = toTriplet(parseHex(text));
      tokens[`--${name}-fill`] = toTriplet(parseHex(fill));
    }

    // Measured on HEX, never on the emitted triplet: `contrast()` cannot parse
    // "240 131 123", and reading a triplet as a colour silently yields black.
    tokens["--destructive"] = `rgb(${tokens["--bad"]})`;
    tokens["--destructive-foreground"] =
      contrast(statusHex.bad.text, "#ffffff") >= AA ? "#ffffff" : "#0a0a0a";

    themes[theme] = tokens;
  }

  return {
    light: themes.light,
    dark: themes.dark,
    meta: {
      input: { primary, secondary, tertiary, harmoniseModes: harmonise },
      derived: {
        secondary: !parseHex(raw.secondary),
        tertiary: !parseHex(raw.tertiary),
      },
      corrections,
    },
  };
}

/**
 * Every text-on-surface pair the engine promises. Exported so the settings
 * preview can SHOW a tenant the measured ratios (§6.2) and the test suite can
 * assert them, from one list — a preview that checked a different set of pairs
 * from the tests would reassure a tenant about a palette the gate then failed.
 */
const AA_PAIRS = [
  ["--foreground", "--background"],
  ["--foreground", "--card"],
  ["--foreground", "--secondary"],
  ["--foreground", "--muted"],
  ["--foreground", "--accent"],
  ["--muted-foreground", "--card"],
  ["--muted-foreground", "--muted"],
  ["--muted-foreground", "--background"],
  ["--primary-ink", "--card"],
  ["--primary-ink", "--background"],
  ["--secondary-ink", "--card"],
  ["--tertiary-ink", "--card"],
  ["--primary-foreground", "--primary"],
];

/** Non-text pairs, held to 3:1 (WCAG 1.4.11) rather than 4.5:1. */
const UI_PAIRS = [
  ["--mode-sea", "--card"],
  ["--mode-air", "--card"],
  ["--mode-road", "--card"],
  ["--mode-rail", "--card"],
];

/**
 * Measure a derived theme against the promise. Returns one row per pair.
 * `ok` is what the gate and the settings UI both read.
 */
function auditTheme(tokens) {
  // Token values come in two representations (hex, and bare "R G B" triplets
  // for the ones consumed as `rgb(var(--x) / a)`), so every value is normalised
  // before it is measured. Skipping this is what made the first run of this
  // audit report 1.15:1 for four mode colours that are actually fine.
  const resolve = (name) => normaliseColor(tokens[name]);
  const rows = [];
  for (const [fg, bg] of AA_PAIRS) {
    const ratio = contrast(resolve(fg), resolve(bg));
    rows.push({ fg, bg, ratio: Number(ratio.toFixed(2)), required: AA, ok: ratio >= AA });
  }
  for (const [fg, bg] of UI_PAIRS) {
    const ratio = contrast(resolve(fg), resolve(bg));
    rows.push({ fg, bg, ratio: Number(ratio.toFixed(2)), required: AA_UI, ok: ratio >= AA_UI });
  }
  return rows;
}

exports.derivePalette = derivePalette;
exports.auditTheme = auditTheme;
exports.AA_PAIRS = AA_PAIRS;
exports.UI_PAIRS = UI_PAIRS;
exports.AA = AA;
exports.AA_UI = AA_UI;
exports.MODES = MODES;
exports.MODE_HUE_MAX_PULL = MODE_HUE_MAX_PULL;
exports.DEFAULT_PRIMARY = DEFAULT_PRIMARY;
