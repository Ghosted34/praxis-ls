import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { SiteHeader } from "@/components/site/site-header";
import { __resetServiceCache } from "@/lib/use-services";
import { en } from "@/lib/i18n-dict";
import type { ServiceCard } from "@/lib/services-api";

/**
 * The header as an object — the four properties that make it one, and that
 * would each revert in silence.
 *
 * None of this is "does it look good". Every assertion below is a decision that
 * cost something to reach and that nothing else in the tree protects:
 *
 *   · The condense is DIRECTION-AWARE. A future refactor to a plain positional
 *     scrub is a two-line simplification that looks tidier and quietly makes
 *     the language switcher and the portal link unreachable for the whole
 *     length of every long page. That is the regression this file exists for.
 *   · Reduced motion pins the composition rather than speeding it up — the one
 *     rule in this app with no exception (guide §1.2) — while the progress rail
 *     keeps tracking, because it is information and not decoration. Both halves
 *     matter and they pull in opposite directions, which is exactly how one of
 *     them gets lost.
 *   · The nav has ONE highlight. The moment somebody adds a `:hover`
 *     background back onto `.navlink` there are two, and the travel stops being
 *     visible against the thing it travels over.
 *   · The services panel is ABSENT, chevron and all, for a tenant with nothing
 *     published. Same rule as the announcements band. A disclosure that opens
 *     onto an empty grid on somebody's own homepage is the white-label failure
 *     N12 is about.
 *
 * ── WHAT JSDOM CANNOT SAY ─────────────────────────────────────────────────
 *
 * `getBoundingClientRect` answers zeroes here, so the pill's MEASUREMENTS are
 * not assertable and are not asserted. What is assertable is the mechanism:
 * which element exists, whether it is switched on, and when it is told to move.
 * A test that faked the rects would be asserting the fake.
 */

const CARD = (over: Partial<ServiceCard> = {}): ServiceCard =>
  ({
    service_type_id: "st-1",
    slug_fr: "fret-maritime",
    slug_en: "sea-freight",
    name_fr: "Fret maritime",
    name_en: "Sea freight",
    mode: "SEA",
    enquiry_shape: "ROUTE",
    short_description_fr: null,
    short_description_en: null,
    claim_fr: null,
    claim_en: null,
    accent: null,
    cover_url: null,
    icon_url: null,
    has_video: false,
    sort_order: 1,
    published_month: null,
    ...over,
  }) as unknown as ServiceCard;

/** Route the stub on URL: `BrandingProvider` fetches too, and a single Response
 *  instance is consumed by whichever request reads it first. */
function stubServices(services: ServiceCard[] | null) {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/public/services")) {
      if (services === null) {
        return new Response(
          JSON.stringify({ error: { code: "FEATURE_DISABLED", message: "off" } }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            groups: [
              {
                key: "freight",
                name_fr: "Transport",
                name_en: "Freight",
                icon: "ship",
                services,
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

/** `prefers-reduced-motion` is read through `matchMedia`, and jsdom has no
 *  implementation at all — so every hook in `lib/motion.ts` treats an unstubbed
 *  environment as "no preference". Stated explicitly per test rather than left
 *  to that default, because the default is the thing under test in half of
 *  them. */
function stubMedia({ reduced }: { reduced: boolean }) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: q.includes("prefers-reduced-motion") ? reduced : true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  );
}

const mount = async (at = "/public/track") => {
  const view = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={[at]}>
        <SiteHeader />
      </MemoryRouter>
    </BrandingProvider>,
  );
  /* Three settles, not one. The services read resolves first, which is what
     decides whether a chevron exists at all; only then does `React.lazy` begin
     fetching the panel module, and Suspense renders nothing until it lands.
     A single tick sees the chevron and an empty host, which is a real state the
     app passes through and a useless one to assert on. */
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return view;
};

const header = () => document.querySelector("header") as HTMLElement;
/** Numbers, not strings. The loop writes `toFixed(4)`, so a resting value is
 *  the string "0.0000" and asserting on the text would be asserting on the
 *  formatter. */
const prop = (el: Element, name: string) =>
  Number((el as HTMLElement).style.getPropertyValue(name));

/**
 * THE FRAME LOOP IS DRIVEN BY HAND HERE, AND IT HAS TO BE.
 *
 * jsdom implements `requestAnimationFrame` on a real 16ms timer. The smoothing
 * needs about 35 frames to converge, so a test that scrolls and then awaits a
 * fixed number of macrotasks is asserting on how much wall-clock time happened
 * to pass — it passes on a fast machine, fails on a loaded CI runner, and is
 * re-run until it goes green. Owning the clock is the only version of this that
 * means anything.
 */
const frames: FrameRequestCallback[] = [];

function stubFrames() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  // The loop re-checks its own state on every frame and only re-schedules while
  // it still has somewhere to go, so a cancel that does not dequeue costs at
  // most one extra no-op call.
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

/** Run the queue until it stops refilling, or until the cap — which is a bug,
 *  not a timeout: a loop that never parks is exactly what this asserts against. */
async function flushFrames(cap = 200) {
  for (let i = 0; i < cap; i += 1) {
    if (frames.length === 0) return;
    const due = frames.splice(0, frames.length);
    for (const cb of due) cb(i * 16);
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("the header's frame loop never parked");
}

async function scrollTo(y: number) {
  await act(async () => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    await flushFrames();
  });
}

/**
 * Warm the panel module before anything asserts on it.
 *
 * The header loads it with `React.lazy`, so the FIRST test that needs a panel
 * pays for a real dynamic import while every later one resolves from the module
 * registry. Without this, one test in the file fails and the rest pass — and it
 * is whichever test happens to run first, which is the worst possible shape for
 * a failure to have. Warming it here makes the lazy boundary resolve on the
 * same tick for all of them; the boundary itself is still exercised, since the
 * header still goes through Suspense to reach it.
 */
beforeAll(async () => {
  await import("./nav-services-panel");
});

beforeEach(() => {
  __resetServiceCache();
  frames.length = 0;
  stubFrames();
  stubMedia({ reduced: false });
  vi.stubGlobal("fetch", stubServices([]));
  // A document with room to scroll, so `--read` has a denominator. jsdom
  // reports 0 for both by default, which is the "page shorter than the
  // viewport" case the rail is explicitly written to survive.
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 3000,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 1000,
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetServiceCache();
});

describe("the header's condense", () => {
  it("is a function of one property, published on the header itself", async () => {
    await mount();
    // Both resting values are written by the effect, not left to a `var(…, 0)`
    // fallback scattered through the stylesheet.
    expect(prop(header(), "--hdr")).toBe(0);
    expect(prop(header(), "--read")).toBe(0);
  });

  it("condenses on the way down", async () => {
    await mount();
    await scrollTo(600);
    expect(prop(header(), "--hdr")).toBeGreaterThan(0.9);
  });

  it("comes back on the way UP, at any depth — not only at the top", async () => {
    await mount();
    await scrollTo(1200);
    expect(prop(header(), "--hdr")).toBeGreaterThan(0.9);

    // Still deep in the page. A positional scrub would keep the bar condensed
    // here, which is the whole reason this is not one: the utility strip holds
    // the portal link and the language switcher, and a reader scrolling back is
    // a reader looking for something.
    await scrollTo(900);
    expect(prop(header(), "--hdr")).toBeLessThan(0.1);
  });

  it("ignores an upward twitch too small to be a decision", async () => {
    await mount();
    await scrollTo(1200);
    // Under the reverse threshold: a trackpad wobble, not a change of mind. A
    // bar that re-expands on 8px of overscroll flickers for the whole page.
    await scrollTo(1192);
    expect(prop(header(), "--hdr")).toBeGreaterThan(0.9);
  });

  it("does not pretend to be at the top when a reload restores a deep scroll", async () => {
    Object.defineProperty(window, "scrollY", { value: 2000, configurable: true });
    await mount();
    await act(async () => {
      await flushFrames();
    });
    expect(prop(header(), "--hdr")).toBeGreaterThan(0.9);
  });
});

describe("reduced motion", () => {
  it("pins the composition rather than condensing it faster", async () => {
    stubMedia({ reduced: true });
    await mount();
    await scrollTo(1500);
    expect(prop(header(), "--hdr")).toBe(0);
  });

  it("still tracks the reading position, because a rail is information", async () => {
    stubMedia({ reduced: true });
    await mount();
    await scrollTo(1000);
    // 1000 of 2000 scrollable.
    expect(prop(header(), "--read")).toBeCloseTo(0.5, 2);
  });

  it("reports zero progress on a page with nothing to scroll", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 900,
      configurable: true,
    });
    await mount();
    await scrollTo(0);
    // Not NaN and not 1: dividing by a scrollable distance of zero is how a
    // rail ends up painted full, telling a reader they have finished a page
    // they have not started.
    expect(prop(header(), "--read")).toBe(0);
  });
});

describe("the nav's travelling ink", () => {
  it("is ONE highlight for the row, not one per item", async () => {
    await mount();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.querySelectorAll(".navpill")).toHaveLength(1);
    expect(nav.querySelectorAll(".navrail")).toHaveLength(1);
  });

  it("rests on the current page when nothing is pointed at", async () => {
    await mount("/public/track");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.style.getPropertyValue("--pill-on")).toBe("1");
    expect(
      within(nav).getByRole("link", { name: en.site.nav.track }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("is ABSENT on a route no nav entry owns, rather than parked on the first", async () => {
    // /quote has a CTA, not a nav entry. A highlight sitting on About here
    // would state that About is the page you are on.
    await mount("/public/quote");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.style.getPropertyValue("--pill-on")).toBe("0");
  });

  it("does not animate its first placement", async () => {
    await mount();
    const nav = screen.getByRole("navigation", { name: "Main" });
    // The transitions are gated on this attribute. It is set two frames after
    // placement, so the pill takes its position without travelling to it from
    // the left edge on every page load.
    expect(nav.dataset.ready).toBe("false");
    await act(async () => {
      await flushFrames();
    });
    expect(nav.dataset.ready).toBe("true");
  });

  it("hands the ink back to the current page when the pointer leaves the row", async () => {
    await mount("/public/track");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const about = within(nav).getByRole("link", { name: en.site.nav.about });
    fireEvent.pointerEnter(about);
    fireEvent.pointerLeave(nav);
    expect(nav.style.getPropertyValue("--pill-on")).toBe("1");
  });
});

describe("the services panel", () => {
  it("is absent — chevron and all — for a tenant who has published nothing", async () => {
    vi.stubGlobal("fetch", stubServices([]));
    await mount();
    expect(
      screen.queryByRole("button", { name: en.site.nav.servicesToggle }),
    ).toBeNull();
    expect(document.querySelector(".nav-panel")).toBeNull();
  });

  it("is absent when the website package is off, which is configuration and not an outage", async () => {
    vi.stubGlobal("fetch", stubServices(null));
    await mount();
    expect(
      screen.queryByRole("button", { name: en.site.nav.servicesToggle }),
    ).toBeNull();
  });

  it("is absent for a single published service, which is a link and not a menu", async () => {
    vi.stubGlobal("fetch", stubServices([CARD()]));
    await mount();
    expect(
      screen.queryByRole("button", { name: en.site.nav.servicesToggle }),
    ).toBeNull();
  });

  it("opens from the chevron, so it is reachable without a pointer", async () => {
    vi.stubGlobal(
      "fetch",
      stubServices([CARD(), CARD({ service_type_id: "st-2", mode: "AIR" })]),
    );
    await mount();
    const chevron = screen.getByRole("button", {
      name: en.site.nav.servicesToggle,
    });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      fireEvent.click(chevron);
    });
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".nav-panel")).toHaveAttribute(
      "data-open",
      "true",
    );
  });

  it("leaves the Services label a link to the services page", async () => {
    vi.stubGlobal(
      "fetch",
      stubServices([CARD(), CARD({ service_type_id: "st-2", mode: "AIR" })]),
    );
    await mount();
    const nav = screen.getByRole("navigation", { name: "Main" });
    // The disclosure must not have eaten the navigation. A nav item that only
    // opens a panel is a nav item that no longer goes anywhere.
    expect(
      within(nav).getByRole("link", { name: en.site.nav.services }),
    ).toHaveAttribute("href", expect.stringContaining("/services"));
  });

  it("closes on Escape and gives focus back to the control that opened it", async () => {
    vi.stubGlobal(
      "fetch",
      stubServices([CARD(), CARD({ service_type_id: "st-2", mode: "AIR" })]),
    );
    await mount();
    const chevron = screen.getByRole("button", {
      name: en.site.nav.servicesToggle,
    });
    await act(async () => {
      fireEvent.click(chevron);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    // Otherwise focus is stranded on a link inside a panel that is no longer
    // visible, and the next Tab comes from nowhere.
    expect(document.activeElement).toBe(chevron);
  });

  it("is rendered but inert while closed, because it animates closed too", async () => {
    vi.stubGlobal(
      "fetch",
      stubServices([CARD(), CARD({ service_type_id: "st-2", mode: "AIR" })]),
    );
    await mount();
    const panel = document.querySelector(".nav-panel");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("data-open", "false");
    // An unmounted element has nothing to animate; `aria-hidden` plus the
    // stylesheet's `visibility` is what keeps a closed panel out of the tab
    // order and off the accessibility tree.
    expect(panel).toHaveAttribute("aria-hidden", "true");
  });

  it("paints a lane colour on the glyph and never on the label", async () => {
    vi.stubGlobal(
      "fetch",
      stubServices([CARD(), CARD({ service_type_id: "st-2", mode: "AIR" })]),
    );
    await mount();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: en.site.nav.servicesToggle }),
      );
    });
    const link = document.querySelector(
      '.nav-panel-link[data-toned="true"]',
    ) as HTMLElement;
    expect(link).not.toBeNull();
    // Colour on this site means transport mode. A service NAME in road-orange
    // would be stating a leg rather than labelling a link.
    expect(link.querySelector(".nav-panel-glyph")).not.toBeNull();
    expect(link.querySelector(".nav-panel-label")?.getAttribute("style")).toBeNull();
  });

  it("does not tone the modes that do not move", async () => {
    // CUSTOMS and WAREHOUSE are real modes with no lane colour: the four hues
    // are the four ways cargo MOVES, and a customs file does not move.
    vi.stubGlobal(
      "fetch",
      stubServices([
        CARD({ mode: "CUSTOMS" }),
        CARD({ service_type_id: "st-2", mode: "WAREHOUSE" }),
      ]),
    );
    await mount();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: en.site.nav.servicesToggle }),
      );
    });
    expect(
      document.querySelectorAll('.nav-panel-link[data-toned="true"]'),
    ).toHaveLength(0);
  });

  it("does not block the page it hangs over while it is closed", () => {
    /* THE REGRESSION, AND WHY IT IS ASSERTED AGAINST THE STYLESHEET.
 
       `.nav-panel-host` is a positioning box with no paint of its own, and it
       is sized by the panel inside it — which is never unmounted (it animates
       closed as well as open) and is `visibility: hidden` when closed, a state
       that hides an element and KEEPS its layout box. Without
       `pointer-events: none` the wrapper is therefore a full-width,
       menu-height, completely invisible hit target sitting at z-index 3 inside
       the header's z-index-40 stacking context — above every page's content,
       on every page, because the header is in `PageShell`.
 
       Measured in Chromium before the fix, 4 groups of 9 services: a dead band
       at y=108..448 on the home, contact and track pages; `elementFromPoint`
       inside it returned `div.nav-panel-host`; an input scrolled into it could
       not be focused; text under it showed the default arrow instead of an
       I-beam. Its height is the tenant's service list — 194px at 4 services,
       340px at 36 — so the taller the catalogue, the more of the page it eats.
 
       jsdom has no compositor and no hit-testing, so the failure cannot be
       reproduced here: `fireEvent.click` dispatches straight at a node and
       passes either way. The stylesheet is what can be protected, and it is
       the right thing to protect — the fix IS one declaration, and the way it
       comes back is somebody deleting a line that looks like it does nothing.
 
       BOTH HALVES MATTER, so both are asserted. The wrapper must be
       transparent; the panel must go interactive when open, or the menu itself
       would be dead and the "fix" would have traded one bug for a worse one.
       This wrapper has already broken the top of every page once before, by a
       different property — see the note on `.nav-panel-host` in index.css. */
    /* COMMENTS STRIPPED FIRST, and that is not tidiness.
 
       The note beside the real declaration discusses `pointer-events: none` in
       prose several times over. Matching the raw file therefore passes with the
       declaration DELETED — which is precisely the state this test exists to
       catch, and it is how the first draft of this test passed against a
       stylesheet it was supposed to fail. Verified both ways after the fix:
       green with the line, red without it. */
    const css = readFileSync(
      join(__dirname, "..", "..", "index.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    const host = css.match(/\.nav-panel-host\s*\{[\s\S]*?\}/);
    expect(host).not.toBeNull();
    expect(host![0]).toMatch(/pointer-events:\s*none/);

    // …and the open panel is what turns interaction back on.
    const open = css.match(/\.nav-panel\[data-open="true"\]\s*\{[\s\S]*?\}/);
    expect(open).not.toBeNull();
    expect(open![0]).toMatch(/pointer-events:\s*auto/);
  });
});

describe("the bar over the band", () => {
  it("is off by default, so eleven other routes did not quietly change", async () => {
    // `PageShell` opts in per page and only the homepage does. A default-on
    // overlay would pull `<main>` up under the header on every route in the
    // app — including the ones whose first band is page-coloured, where the
    // bar would wear hero colours over it.
    await mount();
    expect(header()).toHaveAttribute("data-overlay", "false");
  });

  it("takes the hero's colour family rather than cross-fading to the page's", () => {
    /* THE HOLE THIS CLOSES, AND WHY IT IS ASSERTED AGAINST THE STYLESHEET.
 
       The obvious overlay keeps the bar's labels at `--foreground` and fades
       its fill in from `--background` as `--hdr` rises. `--foreground` follows
       the PAGE; the band underneath is `--hero`, which is carbon in BOTH
       themes and deliberately never follows it. In the light theme that is
       dark ink on carbon — an invisible nav, not a dim one.
 
       It is unreachable today only because `FORCE_DARK` pins this app to dark,
       and that lock is one line in `lib/theme-mode.ts` whose own header
       explains how to flip it. `check:contrast` cannot catch it either: it
       measures the tokens a rule NAMES, and the failing rule would name
       `--foreground` on `--background`, which passes.
 
       So the assertion is that the overlay re-points the subtree to the hero
       family, which makes the pair constant at every scroll position and the
       one the contrast gate already measures at 17:1.
 
       Comments are stripped first — the note beside the rule discusses
       `--foreground` and `--hero-foreground` in prose several times over, so
       matching the raw file would pass with the declarations deleted. That is
       the failure mode the sibling `.nav-panel-host` test in this file records
       having hit for real. */
    const css = readFileSync(
      join(__dirname, "..", "..", "index.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    const rule = css.match(
      /\.site-shell\[data-overlay="true"\]\s+\.site-header\s*\{[\s\S]*?\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/--foreground:\s*var\(--hero-foreground\)/);
    expect(rule![0]).toMatch(/--border:\s*var\(--hero-line\)/);
    // The fill is the hero's ground scaled by --hdr, never the page's.
    expect(rule![0]).toMatch(/background:[^;]*var\(--hero\)/);
    expect(rule![0]).not.toMatch(/background:[^;]*var\(--background\)/);
  });

  it("pulls main up by the SAME property the header publishes", () => {
    /* The pull-up and the hero's own padding must read one number or the
       composition moves. `--site-header-h` is measured and republished through
       the whole condense, so a hardcoded offset in either place would be
       correct at exactly one scroll position — and 6rem, the number that used
       to be hardcoded around this app, is SHORTER than the bar really is,
       which is the bug that sliced pinned headings in half. */
    const css = readFileSync(
      join(__dirname, "..", "..", "index.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = css.match(/\.main-under-header\s*\{[\s\S]*?\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/var\(--site-header-h/);

    const hero = readFileSync(
      join(__dirname, "hero.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const band = hero.match(/\.hero-band\s*\{[\s\S]*?\}/);
    expect(band).not.toBeNull();
    expect(band![0]).toMatch(/padding-top:\s*var\(--site-header-h/);
  });
});

describe("the chrome that is decoration", () => {
  it("is hidden from assistive technology, all of it", async () => {
    await mount();
    for (const sel of [".hdr-embers", ".hdr-lit", ".hdr-sheen", ".hdr-rail", ".navpill", ".navrail"]) {
      const el = document.querySelector(sel);
      expect(el, `${sel} should be rendered`).not.toBeNull();
      expect(el, `${sel} should be aria-hidden`).toHaveAttribute("aria-hidden");
    }
  });

  it("keeps the ember count in step with the grid the stylesheet divides by", async () => {
    await mount();
    // `.hdr-ember`'s `left` is `(var(--i) + 0.5) * (100% / 18)`. The two numbers
    // have to agree or the particles bunch at one end of a row they are
    // supposed to span.
    const embers = document.querySelectorAll(".hdr-ember");
    expect(embers).toHaveLength(18);
    expect((embers[17] as HTMLElement).style.getPropertyValue("--i")).toBe("17");
  });
});
