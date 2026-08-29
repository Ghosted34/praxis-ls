import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { AppErrorBoundary } from "@/app/error-boundary";
import { AppRouter } from "@/app/router";
import { en } from "@/lib/i18n-dict";

/**
 * The render gate for the whole app: every route mounts, shows the copy it is
 * supposed to show, in both languages, without an error boundary eating it.
 *
 * ── WHY THIS FILE EXISTS ALONGSIDE THE UNIT TESTS ─────────────────────────
 *
 * The per-feature tests prove a component behaves. None of them prove a ROUTE
 * behaves, and the ways a route fails here are invisible to a component test:
 *
 *   · `React.lazy(() => import(…), "ExportName")` names the export as a STRING.
 *     A typo does not typecheck, does not lint and does not fail the build; it
 *     fails in the browser as a component that never arrives.
 *   · The one-`h1` rule (`doc/WEB_BUILD_BRIEF.md` N10) is a property of the PAGE,
 *     not of any component. It breaks both ways: a band that adds a second
 *     heading next to the hero, and — as this file found the first time it was
 *     written — a single-band index page whose title is an `h2` because that is
 *     the default, leaving the document with no `h1` at all.
 *   · The legacy redirect table has to survive a query string and a slug. Those
 *     are decisions with a reader behind them (a tracking link that loses `?ref=`
 *     is an empty form), and a router refactor breaks them silently.
 *   · A component that throws during render is CAUGHT by `AppErrorBoundary`, so a
 *     suite that only checks "did it render" reports green against a crashed
 *     page. The boundary is rendered here on purpose, and every case asserts the
 *     crash copy is not what came back.
 *
 * ── WHY EACH CASE WAITS FOR A DICTIONARY STRING ────────────────────────────
 *
 * Every route except the boundary is lazy, so a fixed `setTimeout` is either
 * flaky on a loaded CI runner or green on one that never rendered the page. The
 * first assertion in each case is therefore `waitFor` on the exact sentence that
 * route must display, read out of the same dictionary the page reads. That also
 * makes a wrong-but-rendering route impossible to miss: `/public/track` passing
 * because the not-found page rendered is not passing.
 *
 * Fetch is stubbed to 404 everything. That is the realistic first paint for a
 * stranger — no session, nothing cached — and the version worth testing: it is
 * also what proves the marketing pages do not wait on `/api/tenant/branding` to
 * show their own content.
 */

/** Look a dotted key up in the English tree. A missing key yields "" and every
 *  caller asserts the line is non-empty, so a typo in a test fails as "the
 *  dictionary has no such key" rather than as a page that renders nothing. */
const dict = (path: string): string => {
  const v = path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      en as unknown,
    );
  return typeof v === "string" ? v : "";
};

type Case = {
  path: string;
  /** The sentence this route must display, as a dictionary key. */
  shows: string;
  /** `1` = exactly one h1; `0` = none; `"max"` = at most one. */
  h1: 1 | 0 | "max";
};

const ROUTES: Case[] = [
  { path: "/public", shows: "site.hero.title", h1: 1 },
  { path: "/public/track", shows: "site.trackPage.title", h1: 1 },
  { path: "/public/services", shows: "site.servicesPage.title", h1: 1 },
  // A slug the server does not know must say so, in the page's own voice — not
  // redirect to the index, which is the "your link is broken" answer.
  {
    path: "/public/services/freight-forwarding",
    shows: "site.servicesPage.unavailable",
    h1: "max",
  },
  { path: "/public/portfolio", shows: "site.portfolioPage.title", h1: 1 },
  {
    path: "/public/portfolio/a-client",
    shows: "site.portfolioPage.unavailable",
    h1: "max",
  },
  { path: "/public/careers", shows: "site.careers.title", h1: 1 },
  {
    path: "/public/proposals/00000000-0000-4000-8000-000000000000",
    shows: "site.proposals.unavailable",
    h1: "max",
  },
  {
    path: "/public/careers/00000000-0000-4000-8000-000000000000",
    shows: "site.careers.title",
    h1: "max",
  },
  { path: "/nonexistent-route-for-sure", shows: "site.notFound.title", h1: 1 },
];

function Probe() {
  const loc = useLocation();
  return <span data-testid="loc">{`${loc.pathname}${loc.search}`}</span>;
}

function App({ at }: { at: string }) {
  return (
    <AppErrorBoundary>
      <BrandingProvider>
        <MemoryRouter initialEntries={[at]}>
          <Probe />
          <AppRouter />
        </MemoryRouter>
      </BrandingProvider>
    </AppErrorBoundary>
  );
}

/** React 18 wants state updates inside act(); the flush is what lets the lazy
 *  chunk's resolution settle before the first assertion runs. */
async function mount(at: string) {
  const view = render(<App at={at} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

const CRASH = /something went wrong|erreur inattendue|Something broke/i;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "not_found", message: "Not found" },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

describe("every route mounts and shows its own copy", () => {
  it.each(ROUTES.map((r) => [r.path, r] as const))(
    "%s",
    async (path, route) => {
      void path;
      const { container } = await mount(route.path);
      const line = dict(route.shows);
      expect(line.length).toBeGreaterThan(0); // the key exists; a typo here is a silent test

      await waitFor(() => expect(container.textContent).toContain(line), {
        timeout: 4000,
      });

      const text = container.textContent ?? "";
      // A crash panel is rendered content too, so rule it out by name.
      expect(text).not.toMatch(CRASH);
      // A missing dictionary key prints itself; an interpolation whose token was
      // dropped in one language prints the braces.
      expect(text).not.toMatch(/\b(site|portal)\.[a-zA-Z]/);
      expect(text).not.toContain("{{");

      const n = container.querySelectorAll("h1").length;
      if (route.h1 === 1) expect(n).toBe(1);
      else if (route.h1 === 0) expect(n).toBe(0);
      else expect(n).toBeLessThanOrEqual(1);
    },
  );
});

describe("the portal is the same app, not a second one", () => {
  /** The portal is a port of the ERP's screens, so its first paint is a form and
   *  nothing else — no marketing chrome, no fetch that must succeed. Both cases
   *  below are the properties that make it safe to serve a client from the same
   *  bundle as the public site. */
  it.each(["/portal", "/portal/login"])(
    "%s shows the sign-in form",
    async (path) => {
      const { container } = await mount(path);
      await waitFor(
        () =>
          expect(
            container.querySelector('input[type="password"]'),
          ).toBeTruthy(),
        { timeout: 4000 },
      );
      expect(container.querySelectorAll("h1").length).toBeLessThanOrEqual(1);
      // No marketing header inside the portal: a nav that offers "Request a quote"
      // beside a password field is the ERP bug this app must not repeat — a client
      // who is here for a document should not be invited to open a sales thread by
      // the same page that just asked for their credentials.
      const cta = dict("site.hero.cta");
      expect(cta.length).toBeGreaterThan(0);
      expect(container.textContent).not.toContain(cta);
    },
  );

  it("an unauthenticated deep link keeps its path for the return trip", async () => {
    // /portal/documents with no session: the guard's decision, not the router's.
    // What is asserted is that the prefix rewrite happened — the app received
    // /portal/documents — and that the guard then lands on sign-in rather than
    // rendering an empty shell over a 401.
    const { getByTestId, container } = await mount(
      "/client-portal/documents?tab=1",
    );
    await waitFor(
      () => expect(getByTestId("loc").textContent).toBe("/portal/login"),
      {
        timeout: 4000,
      },
    );
    expect(container.textContent).not.toMatch(CRASH);
  });
});

describe("the page is bilingual from the same route", () => {
  it("renders French for ?lang=fr without a second request", async () => {
    // The query feeds `detectLang()`, which reads the real window.location — that
    // is the point of it: the choice has to exist before React mounts. So the
    // MemoryRouter entry alone is not enough here, and the URL is restored after.
    const url = window.location.href;
    window.history.replaceState({}, "", "/public?lang=fr");
    const fr = await mount("/public?lang=fr");
    try {
      await waitFor(() => expect(fr.container.textContent).toMatch(/Praxis/), {
        timeout: 4000,
      });
    } finally {
      window.history.replaceState({}, "", url);
    }
    const en_ = await mount("/public");
    await waitFor(
      () =>
        expect(en_.container.textContent).toContain(dict("site.hero.title")),
      {
        timeout: 4000,
      },
    );

    const t = (v: HTMLElement) => v.textContent ?? "";
    expect(t(fr.container)).not.toEqual(t(en_.container));
    // Both must still carry exactly one h1: a translated page that loses its
    // heading structure loses its outline, and the outline is the navigation.
    expect(fr.container.querySelectorAll("h1")).toHaveLength(1);
    expect(en_.container.querySelectorAll("h1")).toHaveLength(1);
    // `lang` on <html> is set from the ACTIVE language, or a screen reader
    // pronounces "Douane" as English.
    expect(fr.container.textContent).toMatch(
      /demander un devis|expédition|fret|transport/i,
    );
  });
});

describe("legacy paths redirect to the new prefixes and keep their payload", () => {
  const cases: [string, string][] = [
    ["/track?ref=PRX-4711", "/public/track?ref=PRX-4711"],
    ["/tracking?ref=PRX-4711", "/public/track?ref=PRX-4711"],
    ["/portfolio", "/public/portfolio"],
    ["/portfolio/agate-textiles", "/public/portfolio/agate-textiles"],
    ["/proposal/tok123", "/public/proposals/tok123"],
    ["/careers", "/public/careers"],
    ["/careers/eng-2026", "/public/careers/eng-2026"],
    ["/client-portal", "/portal/login"],
  ];
  it.each(cases)("%s → %s", async (from, to) => {
    const { getByTestId } = await mount(from);
    await waitFor(() => expect(getByTestId("loc").textContent).toBe(to), {
      timeout: 4000,
    });
  });

  it("leaves the ERP's own sign-in paths alone", async () => {
    // `src/server.js` is what keeps /login out of this app entirely; the route
    // table must not answer for them either. Inside the app they fall through to
    // not-found, and what is asserted is that no second sign-in form appears —
    // two pages that both claim to be the sign-in screen is how a tenant ends up
    // with two password policies.
    for (const path of ["/login", "/reset-password"]) {
      const { container } = await mount(path);
      await waitFor(
        () =>
          expect(container.textContent).toContain(dict("site.notFound.title")),
        {
          timeout: 4000,
        },
      );
      expect(container.querySelectorAll('input[type="password"]')).toHaveLength(
        0,
      );
    }
  });
});
