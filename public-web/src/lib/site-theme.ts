/**
 * The website's own theme — `GET /public/site/theme`.
 *
 * ── WHY THE PALETTE ARRIVES READY-MADE ─────────────────────────────────────
 *
 * The server derives it. This app receives roughly seventy CSS custom
 * properties per theme and sets them; it does no colour maths at all, and that
 * is the point:
 *
 *   · The derivation is real work — OKLCH conversion, a contrast walk per
 *     token, gamut mapping. Doing it here means doing it on a mid-range Android
 *     on a metered connection, on the critical path to first paint, for a
 *     result that is identical for every visitor of a given tenant.
 *   · This app has ~11 kB of gzipped first-paint headroom. Importing
 *     `@praxis/shared` to get the engine pulls Zod and the ISO country tables
 *     through a CommonJS interop boundary to compute something a server can
 *     compute once and cache.
 *   · The settings preview reads THIS endpoint too, so what a tenant is shown
 *     before they save and what a visitor sees afterwards cannot drift.
 *
 * ── WHY THIS IS SEPARATE FROM `applyBrand` ─────────────────────────────────
 *
 * `GET /branding` is the ERP's appearance row: the logo, the name, and the
 * colours the tenant's own staff see all day. This is the WEBSITE's row, and
 * they are deliberately not the same record — a tenant may want a restrained
 * workspace and a confident front door.
 *
 * So both run, in order: `applyBrand` first (logo, name, and its colours as a
 * floor), then this, which wins on colour for the surface it owns. A tenant who
 * has never opened Settings › Website gets the seeded default, which is the
 * brand orange — the same thing they had before this existed.
 *
 * ── FAILURE IS SILENT, AS IT IS FOR BRANDING ───────────────────────────────
 *
 * A marketing page that shows an error because a theme call timed out is worse
 * than the same page in default dress. The catch is deliberate.
 */
import { publicGet } from "./api";

export type SiteThemePayload = {
  input: { primary: string; secondary: string | null; tertiary: string | null };
  fonts: { display: string; body: string; mono: string };
  radius: string;
  defaultMode: "light" | "dark";
  light: Record<string, string>;
  dark: Record<string, string>;
};

const CACHE_KEY = "praxis.site-theme.v1";

/** The id of the single `<style>` element this module owns. One element,
 *  replaced wholesale, so there is never a second set of tokens underneath. */
const STYLE_ID = "praxis-site-theme";

/**
 * Is this actually a theme?
 *
 * The `.catch()` below covers a fetch that REJECTS. It does not cover a fetch
 * that succeeds and returns something else — an old server, a proxy's error
 * page rendered as JSON, a half-written cache entry. That gap was not
 * hypothetical: `applySiteTheme` did `Object.entries(payload.light)` on the
 * first thing it was handed, and eleven tests surfaced
 * "Cannot convert undefined or null to object" as an unhandled rejection.
 *
 * On a marketing page that is a white screen. So the shape is checked before
 * anything is painted, and anything unrecognisable is treated exactly like a
 * failed fetch: the tenant's branding stands and nobody sees an error.
 */
function isThemePayload(v: unknown): v is SiteThemePayload {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<SiteThemePayload>;
  return (
    Boolean(t.light) &&
    typeof t.light === "object" &&
    Boolean(t.dark) &&
    typeof t.dark === "object"
  );
}

export const getSiteTheme = (): Promise<SiteThemePayload | null> =>
  publicGet<SiteThemePayload>("/public/site/theme")
    .then((v) => (isThemePayload(v) ? v : null))
    .catch(() => null);

/** The last payload, so a returning visitor is themed before they are online.
 *  Same mechanism `readCachedBranding` uses, and for the same reason. */
export function readCachedSiteTheme(): SiteThemePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // A cache written by an older version of this app is exactly the malformed
    // payload isThemePayload exists for.
    return isThemePayload(parsed) ? parsed : null;
  } catch {
    // A private window, cleared site data, or a browser refusing storage. The
    // network fetch still runs; there is simply nothing to paint from first.
    return null;
  }
}

export function writeCachedSiteTheme(payload: SiteThemePayload): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage quota or a blocked API. Caching is an optimisation, never a
    // requirement — swallowing this is correct.
  }
}

/* ── writing the palette ───────────────────────────────────────────────────
 *
 * ── THE BUG THIS SHAPE EXISTS TO PREVENT ──────────────────────────────────
 *
 * The first version wrote ONE half — `getMode() === "dark" ? payload.dark :
 * payload.light` — as inline custom properties on `:root`. It was correct at
 * boot and wrong from the first click of the theme toggle: `setMode` flips
 * `.dark` and `data-theme`, and nothing re-ran this. The inline light palette
 * stayed on the root element, where it beats every rule in `index.css`, so a
 * visitor who asked for dark got the class, the attribute, the stored
 * preference — and a white page.
 *
 * It hid well. `index.css`'s own `.dark` block works perfectly when this
 * module has painted nothing, which is exactly the state of a dev preview with
 * no API behind it and of any tenant whose theme read fails. The bug appears
 * only when the read SUCCEEDS, i.e. for every real tenant.
 *
 * ── SO THE CASCADE DOES IT, NOT JAVASCRIPT ────────────────────────────────
 *
 * Both halves are written, once, into a stylesheet:
 *
 *     :root                                  { …light… }
 *     :root.dark, :root[data-theme="dark"]   { …dark…  }
 *
 * Nothing has to run when the mode changes, so no future path that flips the
 * class can forget to call us — which is the class of bug this was.
 *
 * TWO CASCADE FACTS MAKE IT WORK, and both are worth stating because neither is
 * obvious. `index.css` declares its tokens inside `@layer`, and an UNLAYERED
 * rule beats every layered one whatever the specificity — so this stylesheet
 * wins over the defaults in both modes. And between its own two rules,
 * `:root.dark` (0,2,0) beats `:root` (0,1,0), so the dark half wins exactly
 * when the class or the attribute is present.
 *
 * ── VALUES ARE FILTERED BEFORE THEY REACH A STYLESHEET ────────────────────
 *
 * These come from the tenant's own server and are colour strings from the
 * palette engine. They are still going into CSS text rather than into a
 * property setter, so a value carrying `}` or `<` would end the rule or the
 * element. Anything that is not a plain token name and a plain value is
 * dropped — not escaped, dropped: there is no legitimate palette token that
 * needs a brace, and a silently-corrected one would be a colour nobody chose.
 */

/* ── the tenant's chosen faces ─────────────────────────────────────────────
 *
 * ── THE PATH THAT WAS BUILT AND NEVER CONNECTED ───────────────────────────
 *
 * `publicTheme()` has returned `fonts: { display, body, mono }` since PR 2. The
 * settings picker writes it, the API refuses faces the site cannot render
 * (F-11), and `site-fonts-match-stylesheet.test.js` pins the registry against
 * `fonts.css` in both directions. Nothing in the browser read it: this module
 * wrote the palette and the radius and dropped `payload.fonts` on the floor.
 *
 * So a tenant chose Inter for their display face, was told it was accepted, and
 * got Archivo. Everything except the last three lines.
 *
 * ── WHY THE NAMES ARE RE-STATED RATHER THAN IMPORTED ──────────────────────
 *
 * `siteFontStack()` in `@praxis/shared/design/site-fonts` is the authority and
 * this is a copy of four strings. D-1 kept that package out of this bundle for
 * eleven kilobytes of Zod and country tables, and PR 5 spent the headroom down
 * to about one and a half. `site-theme.test.ts` asserts this map against the
 * registry, so the copy cannot drift silently — the same trade, and the same
 * guard, that `social-row.tsx` makes for its seven platform names.
 */
const FONT_STACKS: Record<string, string> = {
  archivo: '"Archivo Variable", "Archivo Variable Fallback", sans-serif',
  "ibm-plex-sans":
    '"IBM Plex Sans Variable", "IBM Plex Sans Variable Fallback", sans-serif',
  inter: '"Inter Variable", "Inter Variable Fallback", sans-serif',
  "jetbrains-mono":
    '"JetBrains Mono Variable", "JetBrains Mono Variable Fallback", monospace',
};

/** Exported for the test that pins it against the shared registry. */
export const __FONT_STACKS = FONT_STACKS;

/** The three font declarations, for a payload that names faces this app can
 *  actually render. An unknown id contributes nothing rather than a stack
 *  naming a family no `@font-face` declares — which is the silent fallback
 *  F-11 exists to prevent. */
function fontDeclarations(fonts: SiteThemePayload["fonts"] | undefined): string {
  if (!fonts || typeof fonts !== "object") return "";
  const out: string[] = [];
  for (const [role, id] of [
    ["display", fonts.display],
    ["body", fonts.body],
    ["mono", fonts.mono],
  ] as const) {
    const stack = typeof id === "string" ? FONT_STACKS[id] : undefined;
    if (stack) out.push(`--font-${role}:${stack}`);
  }
  return out.join(";");
}

/** `--foo-bar`. Nothing else is a token this app sets. */
const TOKEN_NAME = /^--[a-z0-9-]+$/i;

/** A colour, a length, a `var()`, a gradient — but no brace, semicolon, angle
 *  bracket, at-rule or comment, any of which would break out of the rule. */
const TOKEN_VALUE = /^[^{}<>;@\\]{1,200}$/;

function declarations(tokens: Record<string, string>, radius?: string): string {
  const out: string[] = [];
  for (const [name, value] of Object.entries(tokens)) {
    if (!TOKEN_NAME.test(name)) continue;
    if (typeof value !== "string" || !TOKEN_VALUE.test(value)) continue;
    if (value.includes("/*") || value.includes("*/")) continue;
    out.push(`${name}:${value}`);
  }
  if (radius && TOKEN_VALUE.test(radius)) out.push(`--radius:${radius}`);
  return out.join(";");
}

/**
 * Paint the tenant's palette — both halves, so the toggle needs no JavaScript.
 *
 * Idempotent: the same `<style>` element is reused and its contents replaced,
 * so applying a cached payload and then the fetched one leaves exactly one
 * stylesheet rather than two with the older underneath.
 */
export function applySiteTheme(payload: SiteThemePayload): void {
  // Belt and braces: every caller already screens through isThemePayload, and
  // this is the function that white-screens the page if one ever stops.
  if (!isThemePayload(payload)) return;

  /* The faces go in the LIGHT rule, not a third one: a tenant chooses one set
     of faces, not one per theme. Putting them in `:root` means they apply in
     both modes and the dark rule stays purely about colour. */
  const fonts = fontDeclarations(payload.fonts);
  const lightTokens = declarations(payload.light, payload.radius);
  const light = [lightTokens, fonts].filter(Boolean).join(";");
  const dark = declarations(payload.dark);
  if (!light && !dark) return;

  const css =
    (light ? `:root{${light}}` : "") +
    (dark ? `:root.dark,:root[data-theme="dark"]{${dark}}` : "");

  /* ── AND THE INLINE VALUES `applyBrand` LEFT ON THE ROOT ARE CLEARED ────
   *
   * `applyBrand` sets `--primary`, `--ring`, `--primary-foreground`,
   * `--secondary` and `--accent` as INLINE properties on `:root`, and inline
   * beats a stylesheet at any specificity. While this module also wrote inline
   * values it simply overwrote them, which is the order `branding.tsx`
   * describes: the ERP's appearance row is the floor, the website's row wins on
   * the surface it owns.
   *
   * Moving to a stylesheet inverted that silently — `applyBrand`'s inline
   * `--primary` would have outranked the tenant's own website colour in BOTH
   * modes. Found by clicking the toggle and watching `--primary` stay put while
   * `--background` switched correctly.
   *
   * So every token this payload publishes has its inline value removed. Tokens
   * `applyBrand` sets that the website theme does NOT publish keep theirs,
   * which is exactly the floor the comment above describes. `theme.ts` already
   * records the same hazard for `--primary-ink`: "an inline --primary-ink would
   * outrank the .dark rule and pin one theme's value to both." */
  const rootEl = document.documentElement;
  const published = new Set([...Object.keys(payload.light), ...Object.keys(payload.dark)]);
  // `applyBrand` sets these three from the ERP's appearance row as well.
  if (fonts) for (const role of ["display", "body", "mono"]) published.add(`--font-${role}`);
  for (const name of published) {
    if (TOKEN_NAME.test(name)) rootEl.style.removeProperty(name);
  }

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    /* Appended to <head>, so it sits after `index.css`. That only settles ties
       between rules of equal weight; the layer rule above is what actually
       decides this. Both are true and neither alone would be enough to rely
       on. */
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/** Undo everything this module set — used when a theme payload is replaced by
 *  one that has fewer tokens, so no stale value survives underneath. */
export function resetSiteTheme(): void {
  document.getElementById(STYLE_ID)?.remove();
}
