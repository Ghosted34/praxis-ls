/**
 * White-label theming. The tenant's brand tokens (from the `GET /branding`
 * endpoint, branding.service.js) override the design-system CSS variables at
 * runtime — no rebuild. Call applyBrand() after the public branding fetch (and
 * again on save). Most tokens are plain CSS colour strings (hex) set straight
 * onto :root so every `bg-primary`/`bg-secondary`/`bg-accent` utility re-tints
 * instantly. The status-pill tokens (--ok/--warn/--bad) are consumed as raw
 * `R G B` triplets (`rgb(var(--warn) / 0.15)`), so hex values are converted.
 */
export type Brand = {
  primary?: string | null;
  primaryForeground?: string | null;
  secondary?: string | null;
  accent?: string | null;
  accentDeep?: string | null;
  info?: string | null;
  success?: string | null;
  warn?: string | null;
  danger?: string | null;
  fontDisplay?: string | null;
  fontBody?: string | null;
  fontMono?: string | null;
  radius?: string | null;
  logoUrl?: string | null;
  name?: string | null;
};

const root = () => document.documentElement;

/** All the vars applyBrand touches — used by resetBrand to fully revert. */
const MANAGED_VARS = [
  "--primary",
  "--primary-foreground",
  "--primary-ink-light",
  "--primary-ink-dark",
  "--ring",
  "--brand-orange",
  "--secondary",
  "--accent",
  "--brand-orange-deep",
  "--info",
  "--ok",
  "--warn",
  "--bad",
  "--destructive",
  "--font-display",
  "--font-body",
  "--font-mono",
  "--radius",
];

/**
 * "#f5821f" / "#abc" → "245 130 31" (space-separated RGB triplet) for tokens
 * consumed via `rgb(var(--x) / a)`. Returns null for non-hex input so we skip
 * the assignment rather than write an invalid value.
 */
function hexToTriplet(value: string): string | null {
  let hex = value.trim();
  if (hex[0] !== "#") return null;
  hex = hex.slice(1);
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/* ── accessible text variant of the tenant accent ─────────────────────────────
 *
 * A brand colour chosen to look good as a BUTTON FILL is usually unreadable as
 * TEXT: the default #F5821F measures 2.59:1 on white, well under the WCAG 2.1
 * AA floor of 4.5:1 (audit F13). Every tenant picks their own primary, so this
 * cannot be a hand-tuned constant — it has to be derived.
 *
 * We keep the hue and walk the colour toward black (light theme) or white (dark
 * theme) until it clears the threshold against that theme's card surface. Hue
 * is preserved because the result must still read as the tenant's brand.
 */
type Rgb = [number, number, number];

/**
 * The surfaces the derived ink has to clear, per theme. Both `--background` and
 * `--card` — accent type appears on bare page and inside panels — and, as of
 * Phase 5, the tinted pill ground computed from each. There is no single worst
 * case; see `toAccessibleInk`.
 *
 * Values mirror index.css. They are duplicated rather than read from the
 * computed style because `applyBrand` runs before first paint, when the
 * stylesheet may not have resolved.
 */
const LIGHT_SURFACE: Rgb = [243, 246, 251]; // --background, light
const LIGHT_CARD: Rgb = [255, 255, 255]; // --card, light
const DARK_SURFACE: Rgb = [11, 13, 17]; // --background, dark
const DARK_CARD: Rgb = [18, 22, 30]; // --card, dark
/** `.st-orange`'s ground alpha, from index.css. */
const PILL_TINT = 0.14;
const AA_NORMAL = 4.5;

function parseHex(value: string): Rgb | null {
  const t = hexToTriplet(value);
  if (!t) return null;
  const [r, g, b] = t.split(" ").map(Number);
  return [r, g, b];
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear mix toward `target` by `t` (0..1). */
function mix(c: Rgb, target: Rgb, t: number): Rgb {
  return [
    Math.round(c[0] + (target[0] - c[0]) * t),
    Math.round(c[1] + (target[1] - c[1]) * t),
    Math.round(c[2] + (target[2] - c[2]) * t),
  ];
}

/**
 * Nudge `colour` toward black or white — whichever moves it away from the
 * theme's base surface — until it clears `ratio` against EVERY surface it can
 * land on. Steps of 2% so the result is the least altered colour that passes,
 * keeping it on-brand. Returns the fully-darkened/lightened colour if even that
 * cannot reach the target (only possible for a mid-grey surface).
 *
 * WHY A LIST AND NOT ONE SURFACE (Phase 5). It used to take `--card` alone, and
 * the first attempt at this fix simply swapped in the pill ground — which broke
 * on a near-black tenant brand in DARK mode, and the test caught it. The
 * intuition that "the tinted ground is always the worse case" holds in the light
 * theme and inverts in the dark one: tinting a dark surface with a near-black
 * brand makes the ground DARKER than the card, so a light ink clears the ground
 * comfortably and fails the card. There is no single worst surface; there is a
 * SET, and the ink has to clear all of it.
 */
function toAccessibleInk(colour: Rgb, surfaces: Rgb[], ratio = AA_NORMAL): Rgb {
  const clears = (c: Rgb) => surfaces.every((s) => contrast(c, s) >= ratio);
  if (clears(colour)) return colour;
  const target: Rgb = luminance(surfaces[0]) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.02; t <= 1; t += 0.02) {
    const next = mix(colour, target, t);
    if (clears(next)) return next;
  }
  return target;
}

/**
 * The ground a status pill actually presents its text on: the brand colour at
 * `PILL_TINT` over the surface. Source-over compositing, the same arithmetic the
 * browser does and that `scripts/check-contrast.mjs` does for the static tokens.
 */
function pillGround(colour: Rgb, surface: Rgb): Rgb {
  return colour.map((c, i) => Math.round(c * PILL_TINT + surface[i] * (1 - PILL_TINT))) as Rgb;
}

const rgbCss = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;

export function applyBrand(brand: Brand) {
  const r = root();
  const set = (name: string, value?: string | null) => {
    if (value) r.style.setProperty(name, value);
  };
  /** Set a triplet token only when the value converts cleanly. */
  const setTriplet = (name: string, value?: string | null) => {
    const t = value ? hexToTriplet(value) : null;
    if (t) r.style.setProperty(name, t);
  };

  // Accent (full colour strings — Tailwind consumes these directly).
  set("--primary", brand.primary);
  set("--ring", brand.primary);
  set("--primary-foreground", brand.primaryForeground);
  set("--secondary", brand.secondary);
  set("--accent", brand.accent);

  // Accessible TEXT variants of the accent, one per theme. Both are written as
  // inline sources; index.css picks between them via :root / .dark, because an
  // inline --primary-ink would outrank the .dark rule and pin one theme's value
  // to both.
  const accent = brand.primary ? parseHex(brand.primary) : null;
  if (accent) {
    /*
     * Derived against every surface the ink lands on, INCLUDING the pill ground
     * (Phase 5). `--primary-ink` is the text of `.st-orange`, whose background
     * is the brand colour at 14% — deriving against bare `--card` gave a value
     * that measured 4.64:1 on a card and 3.79:1 on the pill. The static tokens
     * had the identical defect and the contrast gate now catches it there; here
     * the value is computed at runtime for a tenant's own colour, where no gate
     * can ever see it, so getting it right in the derivation is the only lever.
     */
    const surfaces = (base: Rgb, card: Rgb): Rgb[] => [base, card, pillGround(accent, base), pillGround(accent, card)];
    r.style.setProperty("--primary-ink-light", rgbCss(toAccessibleInk(accent, surfaces(LIGHT_SURFACE, LIGHT_CARD))));
    r.style.setProperty("--primary-ink-dark", rgbCss(toAccessibleInk(accent, surfaces(DARK_SURFACE, DARK_CARD))));
  }

  // Brand-mark gradient stops (raw triplets in index.css).
  setTriplet("--brand-orange", brand.primary);
  setTriplet("--brand-orange-deep", brand.accentDeep);

  // Status colours. --destructive is a full string (Tailwind); the status pill
  // tokens --ok/--warn/--bad are raw triplets. --info has no consumer yet but
  // is set for forward use.
  set("--info", brand.info);
  setTriplet("--ok", brand.success);
  setTriplet("--warn", brand.warn);
  set("--destructive", brand.danger);
  setTriplet("--bad", brand.danger);

  // Typography + shape.
  set("--font-display", brand.fontDisplay);
  set("--font-body", brand.fontBody);
  set("--font-mono", brand.fontMono);
  set("--radius", brand.radius);
}

export function resetBrand() {
  MANAGED_VARS.forEach((v) => root().style.removeProperty(v));
}
