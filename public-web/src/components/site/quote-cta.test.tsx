import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { en } from "@/lib/i18n-dict";

/**
 * The primary call to action goes to a ROUTE, not to a hash.
 *
 * This is a regression test for a button that did nothing. "Request a quote" in
 * the header pointed at `/public#quote`, which fails two different ways in a
 * single-page app and looks identical to a broken link in both:
 *
 *   · from another page, the router navigates to the home page and the browser
 *     tries to scroll to `#quote` before the lazily-loaded marketing chunk has
 *     rendered it — so the visitor lands at the top, having asked for a form;
 *   · from the home page, the hash changes and React Router re-renders what is
 *     already mounted. Nothing moves at all.
 *
 * An `href` ending in `#quote` is therefore the defect itself, which is what
 * these assert against. A future refactor that "tidies" the link back into an
 * in-page anchor re-introduces the bug silently, because nothing throws.
 */

const mount = async (node: React.ReactNode, at = "/public/track") => {
  const view = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "no" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the header CTA", () => {
  it("navigates to the quote page rather than scrolling to a hash", async () => {
    await mount(<SiteHeader />);
    const cta = screen.getAllByRole("link", { name: en.site.hero.cta })[0];
    expect(cta).toHaveAttribute("href", expect.stringContaining("/quote"));
    expect(cta.getAttribute("href")).not.toContain("#");
  });

  it("works the same from the home page, where a hash would do nothing", async () => {
    // The worse of the two failures: on the page that OWNS `#quote`, a hash
    // link changes the URL and moves nothing.
    await mount(<SiteHeader />, "/public");
    const cta = screen.getAllByRole("link", { name: en.site.hero.cta })[0];
    expect(cta.getAttribute("href")).not.toContain("#");
  });
});

describe("the footer CTA", () => {
  it("points at the route too", async () => {
    // Two places linking to a form is two places to get it wrong.
    await mount(<SiteFooter />);
    const link = within(screen.getByRole("contentinfo")).getByRole("link", {
      name: en.site.footer.quote,
    });
    expect(link.getAttribute("href")).not.toContain("#");
    expect(link).toHaveAttribute("href", expect.stringContaining("/quote"));
  });
});
