import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  applySiteTheme,
  resetSiteTheme,
  readCachedSiteTheme,
  writeCachedSiteTheme,
  __FONT_STACKS,
  type SiteThemePayload,
} from "@/lib/site-theme";

/**
 * The website theme, and the failure that would white-screen a marketing page.
 *
 * ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 *
 * `getSiteTheme()` catches a REJECTED fetch, and the module's header said
 * "failure is silent". That covered the wrong half. A fetch that SUCCEEDS and
 * returns something else — an older server, a proxy's error page serialised as
 * JSON, a cache entry written by a previous version of this app — sailed
 * straight through the catch into `Object.entries(payload.light)`.
 *
 * It surfaced as eleven unhandled rejections across the suite:
 * "Cannot convert undefined or null to object". On a real visitor's page that
 * is a thrown error during boot, which for a client-rendered app is a blank
 * screen — the single worst outcome for the surface a tenant is judged by, and
 * caused by the theme being *cosmetic*.
 *
 * So the shape is checked at every entry point, and anything unrecognisable is
 * treated exactly like a failed fetch: the tenant's branding stands.
 */

const full = (): SiteThemePayload => ({
  input: { primary: "#ff5a00", secondary: null, tertiary: null },
  fonts: { display: "archivo", body: "inter", mono: "jetbrains-mono" },
  radius: "10px",
  defaultMode: "light",
  light: { "--background": "#ffffff", "--foreground": "#191a1b" },
  dark: { "--background": "#0b0d11", "--foreground": "#edeeee" },
});

beforeEach(() => {
  localStorage.clear();
  resetSiteTheme();
  document.documentElement.removeAttribute("style");
});
afterEach(() => vi.unstubAllGlobals());

/** The stylesheet this module publishes, as text. */
const sheet = () => document.getElementById("praxis-site-theme")?.textContent ?? "";

describe("applySiteTheme", () => {
  it("publishes BOTH halves, so the cascade decides the mode", () => {
    applySiteTheme(full());
    expect(sheet()).toContain(":root{");
    expect(sheet()).toContain('--background:#ffffff');
    expect(sheet()).toContain(':root.dark,:root[data-theme="dark"]{');
    expect(sheet()).toContain("--background:#0b0d11");
    expect(sheet()).toContain("--radius:10px");
  });

  /**
   * ── THE BUG THIS PINS, AND IT SHIPPED ─────────────────────────────────
   *
   * The first version painted ONE half — the visitor's current mode — as
   * inline properties on `:root`. Correct at boot, and wrong from the first
   * click of the theme toggle: `setMode` flips `.dark` and `data-theme`, and
   * nothing re-ran the painter. The light palette stayed inline on the root
   * element, where it outranks every rule in `index.css`.
   *
   * So a visitor who clicked "Dark theme" got the class, the attribute, the
   * stored preference — and a white page. For every tenant whose palette the
   * server derives, which is all of them.
   *
   * It hid because `index.css`'s own `.dark` block works perfectly when this
   * module has painted nothing — the state of a dev preview with no API and of
   * any tenant whose theme read fails. The bug needed the read to SUCCEED.
   *
   * The fix is structural rather than another call site: both halves go into a
   * stylesheet, so no future path that flips the class can forget to repaint.
   * These cases assert that property, not the mechanism.
   */
  it("writes no inline root properties at all", () => {
    applySiteTheme(full());
    // Not "the right one is inline" — NONE is. An inline token is a token
    // pinned to one theme.
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
    expect(document.documentElement.getAttribute("style")).toBeFalsy();
  });

  it("scopes dark more specifically than light, so the class wins", () => {
    applySiteTheme(full());
    const css = sheet();
    // `:root.dark` is (0,2,0) against `:root`'s (0,1,0), and the light rule is
    // written first. Either alone would be wrong.
    expect(css.indexOf(":root{")).toBeLessThan(css.indexOf(":root.dark"));
  });

  it("clears the inline value applyBrand left, so the website's colour wins", () => {
    // `applyBrand` sets --primary inline from the ERP's appearance row, and
    // inline beats a stylesheet at any specificity. While this module also
    // wrote inline it simply overwrote them; moving to a stylesheet inverted
    // the precedence `branding.tsx` documents.
    document.documentElement.style.setProperty("--background", "#c0ffee");
    applySiteTheme(full());
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });

  it("leaves alone an inline token the website theme does not publish", () => {
    // The ERP's appearance row is the FLOOR beneath the website's palette, not
    // something to wipe: a token this payload says nothing about keeps its
    // branding value.
    document.documentElement.style.setProperty("--accent", "#123456");
    applySiteTheme(full());
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#123456");
  });

  it("replaces its own stylesheet rather than stacking a second", () => {
    // The cached payload is applied, then the fetched one. Two elements would
    // leave the older underneath.
    applySiteTheme(full());
    applySiteTheme(full());
    expect(document.querySelectorAll("#praxis-site-theme")).toHaveLength(1);
  });

  it("clears the previous set, so no stale token survives a swap", () => {
    applySiteTheme({ ...full(), light: { "--only-in-first": "#111" } });
    expect(sheet()).toContain("--only-in-first:#111");
    applySiteTheme(full());
    expect(sheet()).not.toContain("--only-in-first");
  });

  /* ── a stylesheet is TEXT, so what goes into it is filtered ───────────── */

  it("drops a token whose value could break out of the rule", () => {
    applySiteTheme({
      ...full(),
      light: {
        "--background": "#ffffff",
        "--evil": "red}:root{--background:black",
        "--tag": "</style><script>x()</script>",
        "--semi": "red;color:blue",
      },
    });
    const css = sheet();
    expect(css).toContain("--background:#ffffff");
    expect(css).not.toContain("--evil");
    expect(css).not.toContain("--tag");
    expect(css).not.toContain("--semi");
    // And the element still holds exactly the two rules it should.
    expect(document.querySelectorAll("#praxis-site-theme")).toHaveLength(1);
  });

  it("drops a token whose NAME is not a custom property", () => {
    applySiteTheme({
      ...full(),
      light: { "--background": "#fff", "color:red;--x": "1", "": "2" },
    });
    expect(sheet()).not.toContain("color:red");
  });

  it("does nothing at all when handed a malformed payload", () => {

    // Each of these reached applySiteTheme in the failing version and threw.
    const bad = [
      null,
      undefined,
      {},
      { light: null, dark: null },
      { light: "not-an-object", dark: {} },
      { input: { primary: "#fff" } },
    ];
    for (const payload of bad) {
      expect(() =>
        applySiteTheme(payload as unknown as SiteThemePayload),
      ).not.toThrow();
    }
    expect(document.documentElement.getAttribute("style")).toBeFalsy();
  });
});

/**
 * ── THE TENANT'S CHOSEN FACES ─────────────────────────────────────────────
 *
 * `publicTheme()` has returned `fonts: { display, body, mono }` since PR 2 and
 * nothing in the browser read it. A tenant chose Inter, was told it was
 * accepted, and got Archivo — the whole path built except its last three lines,
 * the same shape as the theme toggle above.
 */
describe("the font stacks", () => {
  it("applies the faces the tenant chose", () => {
    applySiteTheme({ ...full(), fonts: { display: "inter", body: "ibm-plex-sans", mono: "jetbrains-mono" } });
    const css = sheet();
    /* Asserted as (token, family) pairs rather than as one embedded CSS
       fragment. `scripts/check-fonts.mjs` scans every file for
       `--font-…: <stack>` and a literal like `--font-display:"Inter Variable"')`
       in a test parses as the family `inter variable"')` — a name outside the
       library, reported against a file that names no font at all. */
    for (const [role, family] of [
      ["display", "Inter Variable"],
      ["body", "IBM Plex Sans Variable"],
      ["mono", "JetBrains Mono Variable"],
    ]) {
      expect(css).toContain(`--font-${role}:`);
      expect(css).toContain(family);
    }
  });

  it("names the metric-matched fallback in every stack", () => {
    // The middle entry is what makes `font-display: swap` cost no layout
    // shift (O-12). A stack that goes straight to `sans-serif` reflows.
    applySiteTheme(full());
    for (const family of [
      "Archivo Variable",
      "IBM Plex Sans Variable",
      "Inter Variable",
      "JetBrains Mono Variable",
    ]) {
      if (!sheet().includes(`"${family}"`)) continue;
      expect(sheet()).toContain(`"${family} Fallback"`);
    }
  });

  it("puts the faces in the light rule, not a per-theme one", () => {
    // A tenant chooses one set of faces, not one per mode.
    applySiteTheme(full());
    const css = sheet();
    const darkAt = css.indexOf(":root.dark");
    expect(css.indexOf("--font-display")).toBeLessThan(darkAt);
    expect(css.slice(darkAt)).not.toContain("--font-display");
  });

  it("ignores a face this app cannot render, rather than naming a dead family", () => {
    // F-11: a stack naming a family no @font-face declares falls silently
    // through to the generic, and looks fine to anyone who has it installed.
    applySiteTheme({ ...full(), fonts: { display: "montserrat", body: "inter", mono: "jetbrains-mono" } });
    expect(sheet()).not.toContain("Montserrat");
    expect(sheet()).not.toContain("--font-display");
    expect(sheet()).toContain("--font-body");
  });

  /**
   * ── WHY THE AUTHORITY IS NOT IMPORTED HERE ────────────────────────────
   *
   * `siteFontStack()` in `@praxis/shared/design/site-fonts` is the authority,
   * and this file does NOT import it. `public-web` does not depend on
   * `@praxis/shared` at all — D-1 spent real effort keeping it out of this
   * bundle, and `social-row.test.tsx` settled the same question the same way.
   *
   * The first draft imported it anyway. It passed locally, because the root
   * workspace hoists `@praxis/shared` into a `node_modules` this app can see,
   * and it failed in CI, where the public-web job installs only this app's own
   * dependencies. A test that resolves a package the app does not declare is
   * green by accident.
   *
   * So the halves are split where the resolution actually works:
   *   · HERE — the copy is pinned to literal strings, self-contained.
   *   · `tests/unit/font-fallback-metrics.test.js` — runs under jest at the
   *     repo root, where `@praxis/shared` genuinely resolves, and compares
   *     `siteFontStack()` against the text of THIS file. That is the half that
   *     catches drift on the shared side, which a literal here cannot.
   */
  it("pins the copy to the exact stacks the registry produces", () => {
    expect(__FONT_STACKS).toEqual({
      archivo: '"Archivo Variable", "Archivo Variable Fallback", sans-serif',
      "ibm-plex-sans":
        '"IBM Plex Sans Variable", "IBM Plex Sans Variable Fallback", sans-serif',
      inter: '"Inter Variable", "Inter Variable Fallback", sans-serif',
      "jetbrains-mono":
        '"JetBrains Mono Variable", "JetBrains Mono Variable Fallback", monospace',
    });
  });
});

describe("the cache", () => {
  it("round-trips a payload", () => {
    writeCachedSiteTheme(full());
    expect(readCachedSiteTheme()?.light["--background"]).toBe("#ffffff");
  });

  it("rejects a cache entry written by an older version", () => {
    // Same class of bug as above, arriving from localStorage instead of the
    // network — and the one a returning visitor would hit first, because the
    // cache is painted before the fetch resolves.
    localStorage.setItem("praxis.site-theme.v1", JSON.stringify({ primary: "#ff5a00" }));
    expect(readCachedSiteTheme()).toBeNull();
  });

  it("survives storage being unavailable", () => {
    // A private window, cleared site data, or a browser refusing storage.
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    expect(readCachedSiteTheme()).toBeNull();
    expect(() => writeCachedSiteTheme(full())).not.toThrow();
  });
});
