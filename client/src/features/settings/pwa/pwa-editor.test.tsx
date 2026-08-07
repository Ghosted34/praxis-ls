/**
 * The App & PWA editor — the parts of it that are claims rather than markup.
 *
 * WHAT IS ACTUALLY AT RISK HERE. Not "does the form render" — the axe/screen
 * gates cover that shape of defect elsewhere. What this screen can get wrong,
 * silently and only on a real phone, is:
 *
 *   1. **Showing a preview that isn't what ships.** The whole screen is an
 *      argument that "this is what your icon will look like". The preview draws
 *      from `iconLayout()`; the server composites from the same function
 *      (proven against real pixels in tests/unit/pwa-design.test.js). What is
 *      left to prove on this side is that the preview element is positioned
 *      from that function and not from a hand-written approximation.
 *   2. **Turning "inherit" into a saved value.** Every field is nullable and
 *      null means "follow the brand". A form that seeds its inputs with the
 *      resolved defaults and then posts all of them would freeze today's brand
 *      colour into the PWA config, and nobody would notice until the brand
 *      changed and the app icon didn't.
 *   3. **A safe-zone warning that is decorative.** It has to fire on the case
 *      it exists for — a mark zoomed past the crop — and stay quiet otherwise,
 *      or it trains people to ignore it.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";

import { applyPwaDocument, effectivePwa, EMPTY_PWA_CONFIG, iconLayout, type PwaConfig } from "@/lib/pwa-config";
import { escapesSafeZone, iconWarnings, splashWarnings, manifestWarnings } from "./validation";
import { AppIcon } from "./previews";

const BRAND = { name: "Acme Freight", primary: "#1188ff", logoUrl: "/media/tenant_acme/branding/logo.png", theme: "dark" as const };

/* ── the preview draws from the shared resolver ───────────────────────────── */

describe("AppIcon — positioned by the same function the server composites with", () => {
  it("places the artwork at iconLayout's fractions, not at an approximation", () => {
    const cfg = effectivePwa({ iconPadding: 20, iconZoom: 100 }, BRAND);
    const { container } = render(<AppIcon cfg={cfg} size={100} />);
    const img = container.querySelector("img")!;
    const { size, left, top } = iconLayout(cfg, false);

    expect(img.style.left).toBe(`${left * 100}%`);
    expect(img.style.top).toBe(`${top * 100}%`);
    expect(img.style.width).toBe(`${size * 100}%`);
    // `contain` into a square box is the CSS equivalent of sharp's
    // `fit: "contain"`. If this changes, the preview stops matching the PNG.
    expect(img.style.objectFit).toBe("contain");
  });

  it("uses the safe-zone padding for the maskable variant", () => {
    const cfg = effectivePwa(null, BRAND);
    const { container } = render(<AppIcon cfg={cfg} maskable size={100} />);
    const img = container.querySelector("img")!;
    expect(img.style.left).toBe(`${iconLayout(cfg, true).left * 100}%`);
    expect(img.style.left).not.toBe(`${iconLayout(cfg, false).left * 100}%`);
  });

  it("renders the monogram fallback when there is no artwork, like the server does", () => {
    const cfg = effectivePwa(null, { name: "Zenith Cargo", primary: "#1188ff" });
    const { container } = render(<AppIcon cfg={cfg} size={64} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("Z");
  });

  it("never rounds the maskable variant — the launcher supplies the shape", () => {
    const cfg = effectivePwa({ iconRadius: 40 }, BRAND);
    const { container } = render(<AppIcon cfg={cfg} maskable size={64} />);
    expect((container.firstChild as HTMLElement).style.borderRadius).toBe("0%");
  });
});

/* ── the title bar ────────────────────────────────────────────────────────── */

/**
 * REGRESSION GUARD FOR A SHIPPED BUG. index.html carries a static
 * `<meta name="theme-color" content="#f4f7fb">`, and an installed PWA paints its
 * window title bar from THAT tag, not from the manifest — the meta overrides
 * `theme_color` as soon as the page loads. So every tenant's installed app wore
 * the same off-white bar regardless of what they configured, and the manifest
 * being correct was no help at all. The failure is invisible in a browser tab:
 * you only see it in an installed window.
 */
describe("applyPwaDocument — the title bar is a meta tag, not the manifest", () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#f4f7fb">' +
      '<meta name="apple-mobile-web-app-title" content="Praxis LS">';
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("style");
  });

  const themeColor = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content;
  const iosTitle = () =>
    document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')!.content;
  const cssVar = (n: string) => document.documentElement.style.getPropertyValue(n);

  it("replaces the static placeholder with the resolved title bar colour", () => {
    expect(themeColor()).toBe("#f4f7fb"); // the bug, before
    applyPwaDocument(effectivePwa(null, BRAND));
    expect(themeColor()).toBe("#ffffff"); // light surface, not the brand accent
  });

  /**
   * The colour is per THEME, and this is the assertion that matters most: a
   * single value cannot serve both, and the failure it prevents — a white bar
   * welded to the top of a dark app — is the one a tenant would report.
   */
  it("follows the live theme rather than a single stored colour", () => {
    const cfg = effectivePwa(null, BRAND);
    applyPwaDocument(cfg);
    expect(themeColor()).toBe("#ffffff");

    document.documentElement.classList.add("dark");
    applyPwaDocument(cfg);
    expect(themeColor()).toBe("#12161e");
  });

  /**
   * The frame colour the NEXT load starts from. The browser reads the manifest
   * before any of this runs, so the only way its `theme_color` can match a
   * per-user light/dark choice is for the page to say which one it is.
   */
  it("points the manifest at the live theme", () => {
    document.head.insertAdjacentHTML("beforeend", '<link rel="manifest" href="/manifest.webmanifest">');
    const href = () => document.querySelector('link[rel="manifest"]')!.getAttribute("href");

    applyPwaDocument(effectivePwa(null, BRAND));
    expect(href()).toBe("/manifest.webmanifest?theme=light");

    document.documentElement.classList.add("dark");
    applyPwaDocument(effectivePwa(null, BRAND));
    expect(href()).toBe("/manifest.webmanifest?theme=dark");
  });

  it("uses the brand accent only when the tenant asks for it", () => {
    applyPwaDocument(effectivePwa({ titlebarMode: "brand" }, BRAND));
    expect(themeColor()).toBe(BRAND.primary);
  });

  it("uses explicit custom colours, one per theme", () => {
    const cfg = effectivePwa({ titlebarMode: "custom", titlebarLight: "#eeeeee", titlebarDark: "#101010" }, BRAND);
    applyPwaDocument(cfg);
    expect(themeColor()).toBe("#eeeeee");
    document.documentElement.classList.add("dark");
    applyPwaDocument(cfg);
    expect(themeColor()).toBe("#101010");
  });

  it("publishes the same colour to CSS as to the meta tag — a mismatch is a visible seam", () => {
    // The page paints `--titlebar-bg`; the OS paints the meta colour behind the
    // caption buttons. They meet a few hundred pixels from the window's right
    // edge, so any disagreement shows up as a line there.
    applyPwaDocument(effectivePwa(null, BRAND));
    expect(cssVar("--titlebar-bg")).toBe(themeColor());
  });

  it("publishes the artwork layer as CSS custom properties", () => {
    applyPwaDocument(
      effectivePwa({ titlebarImageUrl: "/media/tenant_acme/branding/bar.png", titlebarImageOpacity: 25, titlebarBlur: 4 }, BRAND),
    );
    expect(cssVar("--titlebar-image")).toBe('url("/media/tenant_acme/branding/bar.png")');
    expect(cssVar("--titlebar-image-opacity")).toBe("0.25");
    expect(cssVar("--titlebar-image-blur")).toBe("4px");
  });

  it("escapes a quote in the image URL rather than letting it close the declaration", () => {
    // The field accepts a PASTED url, so the value is not necessarily one this
    // app minted. An unescaped `")` would terminate the url() and let whatever
    // follows be parsed as further declarations.
    //
    // The check is that the quote is ESCAPED, not that the payload is absent:
    // `\"` inside a CSS string is a literal quote, so hostile text survives as
    // inert characters inside a single url() token — which is the correct
    // outcome. Asserting `not.toContain("--evil")` would be asserting the wrong
    // thing and would pass just as well on a value that had been silently
    // truncated.
    applyPwaDocument(effectivePwa({ titlebarImageUrl: '/x.png") ;--evil:1;background:url("y' }, BRAND));
    const value = cssVar("--titlebar-image");

    expect(value.startsWith('url("')).toBe(true);
    expect(value.endsWith('")')).toBe(true);
    // No bare quote between the wrapping pair — every one is backslash-escaped,
    // so nothing can close the string early.
    const inner = value.slice('url("'.length, -'")'.length);
    expect(inner.replace(/\\"/g, "")).not.toContain('"');
  });

  it("clears the artwork when no image is set, rather than leaving the last one", () => {
    applyPwaDocument(effectivePwa({ titlebarImageUrl: "/a.png" }, BRAND));
    applyPwaDocument(effectivePwa(null, BRAND));
    expect(cssVar("--titlebar-image")).toBe("none");
    expect(cssVar("--titlebar-image-opacity")).toBe("0");
  });

  it("captions the iOS home-screen icon with the tenant, not the vendor", () => {
    expect(iosTitle()).toBe("Praxis LS"); // also hardcoded, also wrong per tenant
    applyPwaDocument(effectivePwa({ shortName: "Acme Go" }, BRAND));
    expect(iosTitle()).toBe("Acme Go");
  });

  it("creates the meta tag if the document has none, rather than silently doing nothing", () => {
    document.head.innerHTML = "";
    applyPwaDocument(effectivePwa(null, BRAND));
    expect(themeColor()).toBe("#ffffff");
  });

  it("repaints on every call, and never stacks a second meta tag", () => {
    applyPwaDocument(effectivePwa({ titlebarMode: "custom", titlebarLight: "#111111" }, BRAND));
    applyPwaDocument(effectivePwa({ titlebarMode: "custom", titlebarLight: "#222222" }, BRAND));
    expect(themeColor()).toBe("#222222");
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });
});

/**
 * THE REFRESH BUG. An installed window's frame — the rounded top corners and
 * the band behind the minimise/maximise/close buttons — is painted from the
 * manifest's `theme_color`, and the page's `<meta name="theme-color">` only
 * overrides it on a change the browser sees AFTER the document has loaded.
 * Everything written before then (the pre-paint script, and this module's first
 * call while the bundle boots) is folded into the initial load and loses, so on
 * every refresh a dark-mode user got the manifest's colour back — resolved
 * against the tenant-wide `brand_theme`, which is light for most workspaces.
 * Toggling light → dark fixed it precisely because that IS a post-load change.
 *
 * So the module makes that change itself, once per document, by detaching and
 * re-inserting the tag. This asserts the re-insertion actually happens — the
 * value alone is not enough, and was already correct while the bug was live.
 */
describe("applyPwaDocument — making the first write survive a refresh", () => {
  /** Record removals/insertions of the theme-color tag while `run` executes.
   *  `nodeName` rather than an instanceof check on purpose: a ReferenceError
   *  inside a MutationObserver callback is swallowed, and the test would then
   *  pass or fail for a reason that has nothing to do with the code. */
  async function recordHeadChanges(run: () => void): Promise<string[]> {
    const seen: string[] = [];
    const hit = (list: NodeList) =>
      Array.from(list).some((n) => n.nodeName === "META" && (n as Element).getAttribute("name") === "theme-color");
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (hit(r.removedNodes)) seen.push("removed");
        if (hit(r.addedNodes)) seen.push("added");
      }
    });
    observer.observe(document.head, { childList: true });
    run();
    await new Promise((r) => setTimeout(r, 0));
    observer.disconnect();
    return seen;
  }

  beforeEach(() => {
    // A brand-new tag, which is what a reload gives the module: the poke is
    // once per tag, so replacing it is what makes the next one observable.
    document.head.innerHTML = '<meta name="theme-color" content="#f4f7fb">';
    document.documentElement.classList.remove("dark");
  });

  it("re-inserts the theme-color tag once after load, so the window frame repaints", async () => {
    document.documentElement.classList.add("dark");

    const seen = await recordHeadChanges(() => applyPwaDocument(effectivePwa(null, BRAND)));

    // Removal then insertion — a real transition, not a repeat of a value the
    // browser has already dismissed.
    expect(seen).toEqual(["removed", "added"]);
    // And it ends up back in the document, carrying the dark surface.
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe("#12161e");
  });

  it("does it once, not on every branding tick — a repaint per keystroke is a flicker", async () => {
    const first = await recordHeadChanges(() => applyPwaDocument(effectivePwa(null, BRAND)));
    expect(first).toEqual(["removed", "added"]); // the poke this test is about NOT repeating

    const seen = await recordHeadChanges(() => {
      applyPwaDocument(effectivePwa({ titlebarMode: "custom", titlebarLight: "#333333" }, BRAND));
      applyPwaDocument(effectivePwa({ titlebarMode: "custom", titlebarLight: "#444444" }, BRAND));
    });

    expect(seen).toEqual([]);
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe("#444444");
  });
});

/* ── the safe-zone check ──────────────────────────────────────────────────── */

describe("escapesSafeZone", () => {
  it("is quiet at the default framing, which fits inside the crop", () => {
    expect(escapesSafeZone(effectivePwa(null, BRAND))).toBe(false);
  });

  it("fires when zoom pushes the artwork past the circle", () => {
    expect(escapesSafeZone(effectivePwa({ iconZoom: 180 }, BRAND))).toBe(true);
  });

  it("fires when a nudge walks it off centre", () => {
    expect(escapesSafeZone(effectivePwa({ iconOffsetX: 25 }, BRAND))).toBe(true);
  });

  it("is quiet again once the padding is raised to compensate", () => {
    expect(escapesSafeZone(effectivePwa({ iconZoom: 130, maskablePadding: 35 }, BRAND))).toBe(false);
  });
});

describe("warnings — each one has to be actionable", () => {
  it("reports the actual pixel dimensions of a non-square source", () => {
    const w = iconWarnings(effectivePwa(null, BRAND), { width: 400, height: 120 });
    const notSquare = w.find((x) => x.id === "not-square")!;
    expect(notSquare.tone).toBe("warn");
    expect(notSquare.detail).toContain("400×120");
  });

  it("flags a source too small for the install prompt", () => {
    const w = iconWarnings(effectivePwa(null, BRAND), { width: 256, height: 256 });
    expect(w.map((x) => x.id)).toContain("too-small");
  });

  it("says nothing alarming when there is simply no icon yet", () => {
    const w = iconWarnings(effectivePwa(null, { name: "Acme" }), null);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ id: "no-icon", tone: "info" });
  });

  it("warns when the brand colour disappears into the splash background", () => {
    const w = splashWarnings(effectivePwa({ splashBackground: "#1188ff" }, BRAND));
    expect(w.map((x) => x.id)).toContain("splash-accent");
  });

  it("warns that browser display mode is not installable", () => {
    const w = manifestWarnings(effectivePwa({ display: "browser" }, BRAND));
    expect(w.map((x) => x.id)).toContain("display-browser");
  });

  it("stays quiet on a well-formed configuration", () => {
    const cfg = effectivePwa({ splashBackground: "#0b0f10", splashDuration: 600 }, BRAND);
    expect(splashWarnings(cfg)).toHaveLength(0);
    expect(manifestWarnings(cfg)).toHaveLength(0);
  });
});

/* ── the page itself ──────────────────────────────────────────────────────── */

const saveSpy = vi.fn(async (patch: Partial<PwaConfig>) => ({ ...EMPTY_PWA_CONFIG, ...patch }));

vi.mock("@/lib/pwa-config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pwa-config")>("@/lib/pwa-config");
  return {
    ...actual,
    fetchPwaConfig: vi.fn(async () => actual.EMPTY_PWA_CONFIG),
    savePwaConfig: (patch: Partial<PwaConfig>) => saveSpy(patch),
    uploadAppIcon: vi.fn(async () => ({ iconUrl: "/media/tenant_acme/branding/appicon_x.png" })),
  };
});

vi.mock("@/app/branding/branding-context", async () => {
  const { effectivePwa: resolve, EMPTY_PWA_CONFIG: empty } =
    await vi.importActual<typeof import("@/lib/pwa-config")>("@/lib/pwa-config");
  return {
    useBranding: () => ({
      branding: BRAND,
      setBranding: vi.fn(),
      ready: true,
      pwa: resolve(empty, BRAND),
      pwaConfig: empty,
      setPwaConfig: vi.fn(),
    }),
    BrandingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { PwaPage } from "../pwa-page";

const renderPage = () =>
  render(
    <MemoryRouter>
      <PwaPage />
    </MemoryRouter>,
  );

describe("PwaPage", () => {
  it("shows what each field inherits as a placeholder, not as a value", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Identity" }));

    const appName = await screen.findByLabelText("App name");
    // Empty, but the brand name is visible — "unset" reads as "same as the
    // brand", which is what makes this screen safe to open and close.
    expect(appName).toHaveValue("");
    expect(appName).toHaveAttribute("placeholder", "Acme Freight");
  });

  it("does not save inherited values just because they were displayed", async () => {
    const user = userEvent.setup();
    saveSpy.mockClear();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "Identity" }));
    await user.type(await screen.findByLabelText("App name"), "Acme Go");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const patch = saveSpy.mock.calls[0][0];
    expect(patch.appName).toBe("Acme Go");
    // The brand colour was shown on the colour input and never touched — it
    // must not have been frozen into the PWA config by being rendered.
    expect(patch.themeColor).toBeNull();
    expect(patch.iconUrl).toBeNull();
    expect(patch.splashPreset).toBeNull();
  });

  it("clearing a field posts null, which is how a tenant goes back to inheriting", async () => {
    const user = userEvent.setup();
    saveSpy.mockClear();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "Identity" }));
    const appName = await screen.findByLabelText("App name");
    await user.type(appName, "Temp");
    await user.clear(appName);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(saveSpy.mock.calls[0][0].appName).toBeNull();
  });

  it("surfaces the safe-zone warning next to the preview that shows it", async () => {
    renderPage();
    // Default framing is clean, so the warning must not be shown by default.
    expect(screen.queryByText(/outside the maskable safe zone/i)).not.toBeInTheDocument();

    const zoom = screen.getByLabelText("Zoom");
    // fireEvent-style set: a range input is dragged, not typed into.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(zoom, "190");
    zoom.dispatchEvent(new Event("input", { bubbles: true }));

    expect(await screen.findByText(/outside the maskable safe zone/i)).toBeInTheDocument();
  });

  it("is free of accessibility violations on every tab", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    for (const tab of ["Icon", "Identity", "Splash", "Install", "Offline"]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      expect(await axe(container)).toHaveNoViolations();
    }
  }, 30_000);
});
