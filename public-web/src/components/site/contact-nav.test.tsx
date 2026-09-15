import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { en } from "@/lib/i18n-dict";

/**
 * Contact is a ROUTE, and the home page is not it.
 *
 * The nav entry pointed at `p("#contact")`, which broke in two ways at once —
 * and only one of them looked like a bug you could click on:
 *
 *   · `NavLink` decides "active" from the PATH and discards the fragment, so
 *     `/public#contact` is `/public`. Every visitor who landed on the home page
 *     was told, by `aria-current="page"` and the highlight that follows it, that
 *     they were on the contact page. Nothing throws; it just reads as wrong.
 *   · following it did nothing, for the reasons `quote-cta.test.tsx` sets out
 *     for the CTA that had the same shape.
 *
 * So both halves are asserted here: the href is a path, and the highlight lands
 * on the page that owns it rather than on the one that does not.
 */

const mount = async (node: React.ReactNode, at: string) => {
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
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "NOT_FOUND", message: "no" } }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

const contactLink = () =>
  screen.getAllByRole("link", { name: en.site.nav.contact })[0];

describe("the Contact nav entry", () => {
  it("is a path, not an in-page anchor", async () => {
    await mount(<SiteHeader />, "/public/track");
    expect(contactLink()).toHaveAttribute(
      "href",
      expect.stringContaining("/contact"),
    );
    expect(contactLink().getAttribute("href")).not.toContain("#");
  });

  it("is not marked as the current page while on the home page", async () => {
    // The defect, stated as the assertion: a reader who has navigated nowhere
    // must not be told they are somewhere.
    await mount(<SiteHeader />, "/public");
    expect(contactLink()).not.toHaveAttribute("aria-current");
  });

  it("is marked as the current page on the contact page", async () => {
    // The other half. A test that only checked the home page would pass on a
    // nav that highlights nothing anywhere.
    await mount(<SiteHeader />, "/public/contact");
    expect(contactLink()).toHaveAttribute("aria-current", "page");
  });
});

describe("the footer's Contact link", () => {
  it("points at the route too", async () => {
    // Two places linking to the same desk is two places to get it wrong.
    await mount(<SiteFooter />, "/public");
    const link = within(screen.getByRole("contentinfo")).getByRole("link", {
      name: en.site.footer.contact,
    });
    expect(link).toHaveAttribute("href", expect.stringContaining("/contact"));
    expect(link.getAttribute("href")).not.toContain("#");
  });
});
