import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { AppErrorBoundary } from "@/app/error-boundary";
import { en } from "@/lib/i18n-dict";

/**
 * The app on a host it OWNS — a domain the client brought, where the site is
 * served at the root and there is no prefix.
 *
 * ── WHY THIS IS A SEPARATE FILE ────────────────────────────────────────────
 *
 * `lib/base-path.ts` reads `<meta name="praxis:public-base">` ONCE, at module
 * load, before any component renders — deliberately, so no component has to
 * re-derive it and no render can see two different answers. That makes the base
 * un-mockable from inside a running suite: `app.test.tsx` has already imported
 * the router at `/public` by the time any test body runs. So the root case needs
 * its own file, which writes the tag and then `resetModules` + dynamic
 * `import()` so the router is evaluated against it.
 *
 * ── WHAT IT IS ACTUALLY GUARDING ───────────────────────────────────────────
 *
 * Every failure mode here is a redirect whose source and target became the same
 * string, and every one of them is invisible in the default configuration:
 *
 *   · `/` → `p()` is `/` → `/`. The browser reports "too many redirects" and
 *     names no file. The route table has to stop redirecting at the root.
 *   · `/track` → `p("/track")` is `/track`. Same loop, once per legacy alias,
 *     and a tracking link is the single most-followed URL this app serves.
 *   · `p("#quote")` at the root is `#quote` unless something makes it absolute,
 *     and react-router resolves a bare hash against the CURRENT path — so the
 *     header's Quote button on `/careers/abc` would scroll a page with no quote
 *     form on it rather than going home.
 *   · `LegacySplat` joining `"/"` with `"track"` gives `//track`, which a
 *     browser reads as the HOST `track` — the redirect leaves the site.
 *
 * None of those throw, so a suite that only asserts "the page rendered" would
 * pass on all four.
 */

const dict = (path: string): string => {
  const v = path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      en as unknown,
    );
  return typeof v === "string" ? v : "";
};

function Probe() {
  const loc = useLocation();
  return <span data-testid="loc">{`${loc.pathname}${loc.search}${loc.hash}`}</span>;
}

/** Load the router with the base tag set to `content`, from a clean registry. */
async function routerAt(content: string) {
  document.head.innerHTML = `<meta name="praxis:public-base" content="${content}" />`;
  vi.resetModules();
  return import("@/app/router");
}

async function mount(at: string, AppRouter: React.ComponentType) {
  const view = render(
    <AppErrorBoundary>
      <BrandingProvider>
        <MemoryRouter initialEntries={[at]}>
          <Probe />
          <AppRouter />
        </MemoryRouter>
      </BrandingProvider>
    </AppErrorBoundary>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

const CRASH = /something went wrong|erreur inattendue|Something broke/i;

/**
 * The home hero's heading, matched across the accent span.
 *
 * `site.hero.title` is ONE sentence in the dictionary and TWO nodes in the DOM:
 * `SectionHead` renders the accent word in its own `<span>`
 * (doc/UI_UPGRADE_PLAN.md §4 pattern 2). `findByText` on the sentence therefore
 * finds nothing — its default matcher reads a node's own text children, not its
 * subtree — even though the reader sees exactly that sentence. So match the
 * `h1` on its full `textContent`, which is what these cases are actually
 * asserting: the home page rendered rather than redirecting to itself.
 */
const heroTitle =
  () =>
  (_: string, el: Element | null): boolean =>
    el?.tagName === "H1" && el.textContent === dict("site.hero.title");

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "not_found", message: "Not found" } }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  vi.resetModules();
});

describe("the base the server declares", () => {
  it('reads "/" as the root mount, and builds absolute paths from it', async () => {
    document.head.innerHTML =
      '<meta name="praxis:public-base" content="/" />';
    vi.resetModules();
    const bp = await import("@/lib/base-path");
    expect(bp.BASE).toBe("");
    expect(bp.IS_ROOT).toBe(true);
    // The three shapes every call site uses. Each one is absolute — the whole
    // point of `p()` existing rather than a template literal.
    expect(bp.p()).toBe("/");
    expect(bp.p("/track")).toBe("/track");
    expect(bp.p("#quote")).toBe("/#quote");
  });

  it("still reads a prefix, and is not fooled into the root by a bad value", async () => {
    document.head.innerHTML =
      '<meta name="praxis:public-base" content="/site" />';
    vi.resetModules();
    const site = await import("@/lib/base-path");
    expect(site.BASE).toBe("/site");
    expect(site.IS_ROOT).toBe(false);
    expect(site.p("#quote")).toBe("/site#quote");

    // A value that could not be a path segment is a deployment fault. Falling
    // back to the ORIGINAL prefix keeps every printed link working; falling back
    // to the root would silently move the whole site.
    document.head.innerHTML =
      '<meta name="praxis:public-base" content="not a segment" />';
    vi.resetModules();
    const bad = await import("@/lib/base-path");
    expect(bad.BASE).toBe("/public");
    expect(bad.IS_ROOT).toBe(false);
  });
});

describe("routes on a host the site owns", () => {
  it("serves the home page AT the root instead of redirecting to itself", async () => {
    const { AppRouter } = await routerAt("/");
    const { getByTestId, findByText, queryByText } = await mount("/", AppRouter);
    // The assertion that matters is the location: a redirect loop leaves the
    // path unchanged too, so the copy is checked as well.
    await waitFor(() => expect(getByTestId("loc").textContent).toBe("/"));
    expect(await findByText(heroTitle())).toBeTruthy();
    expect(queryByText(CRASH)).toBeNull();
  });

  it("serves the tracking page at /track, with no redirect in the way", async () => {
    const { AppRouter } = await routerAt("/");
    const { getByTestId, findByRole } = await mount("/track?ref=ABC", AppRouter);
    await waitFor(() =>
      expect(getByTestId("loc").textContent).toBe("/track?ref=ABC"),
    );
    // By ROLE, not by text: the header's own "Track a shipment" link carries the
    // same sentence, so a bare text query matches two nodes and fails on the
    // duplicate rather than on anything real. The h1 is the page.
    expect(
      await findByRole("heading", { level: 1, name: dict("site.trackPage.title") }),
    ).toBeTruthy();
  });

  it("keeps every URL already printed under /public working", async () => {
    // The original prefix is claimed on the server whatever the host serves, so
    // this route can answer it. A client who prints cards, sends an email or
    // gets indexed under /public before bringing their domain must not lose it.
    const { AppRouter } = await routerAt("/");
    const { getByTestId } = await mount("/public/track?ref=ABC", AppRouter);
    await waitFor(() =>
      expect(getByTestId("loc").textContent).toBe("/track?ref=ABC"),
    );
  });

  it("does not emit a protocol-relative path when redirecting to the root", async () => {
    // `"/" + "/" + tail` is `//portfolio/a-client`, which a browser resolves as
    // the HOST "portfolio" — the redirect would leave the site entirely.
    const { AppRouter } = await routerAt("/");
    const { getByTestId } = await mount("/public/portfolio/a-client", AppRouter);
    await waitFor(() => {
      const at = getByTestId("loc").textContent || "";
      expect(at.startsWith("//")).toBe(false);
      expect(at).toBe("/portfolio/a-client");
    });
  });

  it("still corrects the spellings that are wrong on every host", async () => {
    const { AppRouter } = await routerAt("/");
    const { getByTestId } = await mount("/tracking?ref=Z", AppRouter);
    await waitFor(() =>
      expect(getByTestId("loc").textContent).toBe("/track?ref=Z"),
    );
  });

  it("leaves the portal where the invitation emails point", async () => {
    // `/portal` is fixed on every host and every base — see base-path.ts.
    const { AppRouter } = await routerAt("/");
    const { getByTestId } = await mount("/client-portal/shipments", AppRouter);
    await waitFor(() =>
      expect(getByTestId("loc").textContent).toBe("/portal/shipments"),
    );
  });
});

describe("routes on a renamed prefix", () => {
  it("serves the site under /site and redirects the original prefix to it", async () => {
    const { AppRouter } = await routerAt("/site");
    const { getByTestId, findByText } = await mount("/site", AppRouter);
    await waitFor(() => expect(getByTestId("loc").textContent).toBe("/site"));
    expect(await findByText(heroTitle())).toBeTruthy();

    const second = await mount("/public/track?ref=Q", AppRouter);
    await waitFor(() =>
      expect(second.getAllByTestId("loc")[1].textContent).toBe(
        "/site/track?ref=Q",
      ),
    );
  });
});
